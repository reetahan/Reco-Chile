"""Generate the frozen numerical baseline for the engine.

Run from the repository root::

    .venv/bin/python tests/generate_golden.py

The script writes one JSON file per scenario into ``tests/fixtures/golden/``.
Those files are committed artifacts: the migrated engine must reproduce them.
Regenerating them is a deliberate decision that has to be justified in the
commit message — see ``tests/fixtures/golden/README.md``.

Determinism
-----------
Nothing here is random and nothing touches the network:

* programs are selected from the real calibration data by stable rules
  (see ``select_programs``), never by index into an unsorted structure;
* the student RUN/IPE are hard-coded, and the RUN check digit is verified with
  ``sae_app.mtb_engine._run_check_digit``;
* the "home" location for the recommendation scenarios is a fixed coordinate
  pair passed straight into ``recommend_similar_programs`` as a dict, so
  ``geocode_chilean_address`` (the only outbound call in the app) is never used.

Rerunning the script on the same data and the same library versions rewrites
byte-identical files.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
REPO_ROOT = TESTS_DIR.parent
for _path in (str(REPO_ROOT), str(TESTS_DIR)):
    if _path not in sys.path:
        sys.path.insert(0, _path)

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import scipy  # noqa: E402

from sae_app.constants import (  # noqa: E402
    CAPACITIES_PATH,
    CAPACITY,
    HARD_UNMATCHED_THRESHOLD,
    HASH_PCT,
    IMPUTED,
    EQUIV_PROBABILITY_CHANGE_WARNING_THRESHOLD,
    LOTTERY,
    NO_PRIORITY,
    POP,
    PRIORITIES,
    PROGRAM,
    REGION,
    SAFETY,
    TRUE_APP,
    WISH_RANK,
)
from sae_app.data_loading import load_calibration  # noqa: E402
from sae_app.mtb_engine import (  # noqa: E402
    _run_check_digit,
    availability,
    mtb_hash,
    normalize_student_identifier,
    pct_to_rank,
)
from sae_app.program_options import build_program_mapping  # noqa: E402
from sae_app.text_utils import as_bool, as_float  # noqa: E402

from golden_runner import (  # noqa: E402
    GOLDEN_DIR,
    build_edited_wishes,
    build_id_maps,
    identifier_expectation,
    run_equivalence_simulation,
    run_recommendations,
    run_strict_simulation,
    to_jsonable,
    wish_rows_for_fixture,
)

# ---------------------------------------------------------------------------
# Fixed identifiers
# ---------------------------------------------------------------------------
# A RUN body that is not a real person's identifier; the check digit is derived
# from the modulo-11 rule and asserted below, so the constant can never drift.
RUN_BODY = "12345678"
STUDENT_RUN = f"{RUN_BODY}-{_run_check_digit(RUN_BODY)}"
# An IPE: nine-digit body from the 100-million series plus a numeric verifier.
STUDENT_IPE = "100200300-4"

# Hanga Roa, Rapa Nui (Easter Island): the fake geocoder output for the
# recommendation scenarios. Never obtained over the network.
#
# Why not a mainland city: the hard distance filter
# (RECOMMENDATION_MAX_HOME_DISTANCE_KM = 100 km) only applies when the home
# geocoding precision is reliable, and near any mainland centroid there are far
# more than MAX_RECOMMENDATIONS schools within 100 km, so the filter excludes
# nothing and an implementation that ignored ``precision`` entirely would
# reproduce both recommendation fixtures. From Rapa Nui the mainland candidates
# sit ~3,500 km away: at "address" precision they are dropped, at "city"
# precision they are only penalized by the proximity score. ``main`` asserts
# that the two runs really differ, so a data refresh cannot quietly restore the
# vacuous case.
HOME_LAT = -27.1127
HOME_LON = -109.3497

MAX_RECOMMENDATIONS = 5

PRIORITY_SIBLING = "priority_sibling"
PRIORITY_STUDENT = "priority_student"
PRIORITY_PARENT_CIVIL_SERVANT = "priority_parent_civil_servant"
PRIORITY_EX_STUDENT = "priority_ex_student"

# The order the four priority wishes appear in ``strict_03``. It is not the
# PRIORITIES order: priority_student is placed last because every program where
# the quota rule really grants that tier is undersubscribed (availability 1),
# and a wish with availability 1 zeroes the cumulative chain of everything after
# it.
PRIORITY_SCENARIO_ORDER = (
    PRIORITY_SIBLING,
    PRIORITY_PARENT_CIVIL_SERVANT,
    PRIORITY_EX_STUDENT,
    PRIORITY_STUDENT,
)

SANTIAGO_REGION = "Región Metropolitana de Santiago"


# ---------------------------------------------------------------------------
# Stable program selection from the real data
# ---------------------------------------------------------------------------

def _sort_key(row: pd.Series) -> tuple[int, int]:
    return (int(str(row["rbd"]).strip()), int(str(row["program_code"]).strip()))


def _capacity(row: pd.Series) -> int:
    return max(round(as_float(row[CAPACITY])), 0)


def _applicants_per_seat(row: pd.Series) -> float:
    capacity = _capacity(row)
    if capacity <= 0:
        return float("inf")
    return max(round(as_float(row[TRUE_APP])), 0) / capacity


def probe_wish(label: str, row: pd.Series, flags: dict, student_id: str) -> pd.Series:
    """One wish exactly as ``attach_mtb_hashes`` would hand it to the engine.

    Availability depends only on the program and the student's flags, never on
    the position in the list (CONTRIBUTING.md, "Equivalence-class pipeline"), so a
    one-wish probe answers "what would this program do in any list?".
    """
    population = max(round(as_float(row[POP])), 1)
    lottery_percentile = mtb_hash(student_id, row["rbd"])
    probe = {
        WISH_RANK: 1,
        PROGRAM: label,
        HASH_PCT: lottery_percentile,
        LOTTERY: pct_to_rank(lottery_percentile, population),
    }
    for column in list(PRIORITIES) + [SAFETY]:
        probe[column] = bool(flags.get(column, False))
    return pd.Series(probe)


def probe_availability(label: str, row: pd.Series, flags: dict, student_id: str) -> dict:
    return availability(probe_wish(label, row, flags, student_id), row)


def select_priority_tier_programs(
    eligible: list[tuple[str, pd.Series]],
    student_id: str,
) -> dict[str, str]:
    """One program per SAE priority tier, where that tier is really reached.

    Setting a flag does not guarantee the tier: ``resolve_priority_tier`` grants
    ``priority_student`` only while the student's lottery rank fits inside the
    program's ``priority_student_seats`` quota, and a program whose
    ``priority_share_<tier>_2024`` is 0 leaves the effective rank untouched, so
    the flag is inert there. Both cases silently reduced the baseline to two of
    the four tiers before, which is why the selection now *verifies* the tier
    per candidate instead of assuming it:

    1. keep programs where the flag alone resolves to that tier **and** moves
       the priority-effective rank (the flag is not inert);
    2. prefer, among those, the programs where it also moves the availability
       probability into ``(0, 1)`` — so a tier regression changes a probability,
       not only a label;
    3. order by applicants-per-seat closest to 10 (oversubscribed enough for the
       priority to matter), with the ``(rbd, program_code)`` tie-break;
    4. never reuse a program across tiers, walking the tiers in ``PRIORITIES``
       order, so the result is a total, reproducible assignment.
    """
    chosen: dict[str, str] = {}
    used: set[str] = set()

    for tier in PRIORITIES:
        moves_probability: list[tuple[str, pd.Series]] = []
        moves_rank_only: list[tuple[str, pd.Series]] = []

        for label, row in eligible:
            if label in used:
                continue
            base = probe_availability(label, row, {}, student_id)
            flagged = probe_availability(label, row, {tier: True}, student_id)
            if flagged["priority_tier"] != tier:
                continue
            if flagged["priority_effective_rank"] == base["priority_effective_rank"]:
                continue
            moves_rank_only.append((label, row))
            probability_moved = (
                abs(
                    flagged["availability_probability"]
                    - base["availability_probability"]
                )
                > 1e-9
            )
            if probability_moved and 0.0 < flagged["availability_probability"] < 1.0:
                moves_probability.append((label, row))

        pool = moves_probability or moves_rank_only
        if not pool:
            raise SystemExit(
                f"No program in the calibration data reaches the {tier!r} tier for "
                f"student {student_id}; the priority baseline cannot be generated."
            )
        label = sorted(
            pool,
            key=lambda item: (abs(_applicants_per_seat(item[1]) - 10.0), _sort_key(item[1])),
        )[0][0]
        chosen[tier] = label
        used.add(label)

    return chosen


def select_programs(program_mapping: dict[str, pd.Series], student_id: str) -> dict:
    """Pick the scenario programs by rules that survive a data reload.

    * ``balanced``  — ordinary programs whose applicants-per-seat ratio is
      closest to 2, i.e. lists whose per-wish availabilities vary but rarely
      collapse to 0 or 1.
    * ``scarce``    — ratio closest to 10, so the list carries a real unmatched
      risk and the hard attention threshold is actually crossed.
    * ``santiago``  — the ``scarce``-style rule restricted to the Santiago
      region.
    * ``priority_tiers`` — one program per SAE priority tier, verified against
      the engine (see ``select_priority_tier_programs``).
    * ``long_shot`` / ``near_certain`` — programs whose availability for this
      student is close to 0.1 resp. 0.99 without any flag. Combining them gives
      an equivalence list whose unmatched risk is neither 0 nor above the hard
      threshold, and whose predicted outcome is the same school in every
      compatible strict order.
    * ``imputed`` / ``zero_capacity`` / ``large_population`` — the first program
      in ``(rbd, program_code)`` order with that property.

    Every ordering ends with the ``(rbd, program_code)`` tie-break, so the
    selection is total and reproducible.
    """
    items = sorted(program_mapping.items(), key=lambda item: _sort_key(item[1]))

    eligible = [
        (label, row)
        for label, row in items
        if _capacity(row) > 0 and not as_bool(row.get(IMPUTED, False))
    ]

    def by_target_ratio(pool, target: float) -> list[str]:
        return [
            label
            for label, _row in sorted(
                pool,
                key=lambda item: (abs(_applicants_per_seat(item[1]) - target), _sort_key(item[1])),
            )
        ]

    santiago = [
        (label, row)
        for label, row in eligible
        if str(row[REGION]).strip() == SANTIAGO_REGION
    ]

    imputed = [label for label, row in items if as_bool(row.get(IMPUTED, False))]
    zero_capacity = [label for label, row in items if _capacity(row) == 0]
    large_population = sorted(
        items,
        key=lambda item: (-as_float(item[1][POP]), _sort_key(item[1])),
    )[0][0]

    plain_availability = {
        label: probe_availability(label, row, {}, student_id)["availability_probability"]
        for label, row in eligible
    }

    def by_target_availability(low: float, high: float, target: float) -> list[str]:
        return [
            label
            for label, _row in sorted(
                (
                    (label, row)
                    for label, row in eligible
                    if low <= plain_availability[label] <= high
                ),
                key=lambda item: (
                    abs(plain_availability[item[0]] - target),
                    _sort_key(item[1]),
                ),
            )
        ]

    return {
        "balanced": by_target_ratio(eligible, 2.0),
        "scarce": by_target_ratio(eligible, 10.0),
        "santiago": by_target_ratio(santiago, 5.0),
        "priority_tiers": select_priority_tier_programs(eligible, student_id),
        "long_shot": by_target_availability(0.001, 0.25, 0.1),
        "near_certain": by_target_availability(0.95, 0.999999, 0.99),
        "imputed": imputed[0] if imputed else None,
        "zero_capacity": zero_capacity[0] if zero_capacity else None,
        "large_population": large_population,
    }


def wish(program_label: str, *, group: int | None = None, **flags) -> dict:
    """One scenario wish: a program plus optional group number and flags."""
    spec = {"program_label": program_label}
    if group is not None:
        spec["preference_group"] = group
    spec.update({key: bool(value) for key, value in flags.items()})
    return spec


# ---------------------------------------------------------------------------
# Scenario definitions
# ---------------------------------------------------------------------------

def build_scenarios(pools: dict) -> list[dict]:
    balanced = pools["balanced"]
    scarce = pools["scarce"]
    santiago = pools["santiago"]

    scenarios: list[dict] = []

    # -- 6 strict lists ----------------------------------------------------
    scenarios.append({
        "name": "strict_01_single_wish",
        "kind": "strict",
        "description": "One wish, no priority flags; identified by IPE instead of RUN.",
        "student_id": STUDENT_IPE,
        "wishes": [wish(balanced[0])],
    })
    scenarios.append({
        "name": "strict_02_three_wishes",
        "kind": "strict",
        "description": "Three wishes, no priority flags.",
        "student_id": STUDENT_RUN,
        "wishes": [wish(label) for label in balanced[:3]],
    })
    scenarios.append({
        "name": "strict_03_four_wishes_priority_tiers",
        "kind": "strict",
        "description": (
            "One wish per SAE priority criterion, each flag set in isolation on "
            "a program where the engine really grants that tier, so all four "
            "tiers plus their improved effective ranks are frozen. Combining "
            "two flags on one wish would hide the lower-precedence tier "
            "(resolve_priority_tier returns the first match), and a flag on a "
            "program with a zero priority share leaves the effective rank "
            "untouched — the two ways the earlier baseline lost "
            "priority_student and priority_ex_student."
        ),
        "student_id": STUDENT_RUN,
        "wishes": [
            wish(pools["priority_tiers"][tier], **{tier: True})
            for tier in PRIORITY_SCENARIO_ORDER
        ],
    })
    scenarios.append({
        "name": "strict_04_eight_wishes_scarce",
        "kind": "strict",
        "description": (
            "Eight oversubscribed wishes and no priority flag: a partial "
            "unmatched risk (strictly between 0 and 1) that is above the hard "
            "attention threshold, so the predicted outcome is 'Unmatched'. Any "
            "priority flag on these programs would push availability to 1 and "
            "flatten the case, which is why the flags live in the scenarios "
            "above."
        ),
        "student_id": STUDENT_RUN,
        "wishes": [wish(label) for label in scarce[:8]],
    })
    scenarios.append({
        "name": "strict_05_twelve_wishes_already_registered",
        "kind": "strict",
        "description": (
            "Twelve wishes ending with the largest lottery population, flagged "
            "as already enrolled (the safety flag forces availability 1)."
        ),
        "student_id": STUDENT_RUN,
        "wishes": [
            *[wish(label) for label in scarce[:11]],
            wish(pools["large_population"], **{SAFETY: True}),
        ],
    })

    imputed_zero_wishes = []
    if pools["imputed"]:
        imputed_zero_wishes.append(wish(pools["imputed"]))
    if pools["zero_capacity"]:
        imputed_zero_wishes.append(wish(pools["zero_capacity"]))
    imputed_zero_wishes.append(wish(balanced[0]))
    scenarios.append({
        "name": "strict_06_imputed_and_zero_capacity",
        "kind": "strict",
        "description": (
            "A program with imputed 2024 calibration, a program with zero "
            "admission seats, and an ordinary program."
        ),
        "student_id": STUDENT_RUN,
        "notes": {
            "imputed_program_available": bool(pools["imputed"]),
            "zero_capacity_program_available": bool(pools["zero_capacity"]),
        },
        "wishes": imputed_zero_wishes,
    })

    # -- 4 equivalence lists ----------------------------------------------
    scenarios.append({
        "name": "equiv_01_two_tied_stable_outcome",
        "kind": "equivalence",
        "description": (
            "Two tied long shots followed by one near-certain fixed program (2 "
            "orders). This is the 'stable' sensitivity case: the predicted "
            "outcome is the fixed program under both orders and its final "
            "chance is identical, because the fixed program sits behind the "
            "whole tied group. The unmatched risk is a real number strictly "
            "between 0 and the hard attention threshold, unlike the tied lists "
            "below where it collapses to 0. Note that the risk is invariant "
            "across the orders of one equivalence class by construction — it is "
            "the product of (1 - availability) over the same set of wishes, up "
            "to floating-point reassociation — so no fixture can show it "
            "moving meaningfully; what the sensitivity block is about is the "
            "predicted outcome and its final chance."
        ),
        "student_id": STUDENT_RUN,
        "wishes": [
            wish(pools["long_shot"][0], group=1),
            wish(pools["long_shot"][1], group=1),
            wish(pools["near_certain"][0], group=2),
        ],
    })
    scenarios.append({
        "name": "equiv_02_two_groups_of_three",
        "kind": "equivalence",
        "description": "Two equivalence groups of three programs (3! * 3! = 36 orders).",
        "student_id": STUDENT_RUN,
        "wishes": [
            wish(balanced[0], group=1),
            wish(balanced[1], group=1),
            wish(balanced[2], group=1),
            wish(balanced[3], group=2),
            wish(balanced[4], group=2),
            wish(balanced[5], group=2),
        ],
    })
    scenarios.append({
        "name": "equiv_03_group_of_four_probability_shift",
        "kind": "equivalence",
        "description": (
            "One equivalence group of four plus a fixed tail (4! = 24 orders). "
            "The group ties one near-certain program to three long shots, which "
            "is the third sensitivity case: every order predicts the same "
            "school, but its final assignment probability moves far more than "
            "EQUIV_PROBABILITY_CHANGE_WARNING_THRESHOLD depending on where the "
            "near-certain program sits inside the group. Together with "
            "equiv_01 (same outcome, same chance) and equiv_02 (the outcome "
            "itself changes), all three equivalence verdicts are frozen."
        ),
        "student_id": STUDENT_RUN,
        "wishes": [
            wish(pools["near_certain"][0], group=1),
            wish(pools["long_shot"][0], group=1),
            wish(pools["long_shot"][1], group=1),
            wish(pools["long_shot"][2], group=1),
            wish(balanced[0], group=2),
        ],
    })
    scenarios.append({
        "name": "equiv_04_over_cap",
        "kind": "equivalence",
        "description": (
            "Eight tied programs: 8! = 40,320 compatible strict orders, above "
            "MAX_EXACT_EQUIV_PERMUTATIONS, so the app refuses to evaluate them."
        ),
        "student_id": STUDENT_RUN,
        "wishes": [wish(label, group=1) for label in balanced[:8]],
    })

    # -- 3 recommendation scenarios ---------------------------------------
    recommendation_wishes = [wish(label) for label in santiago[:3]]
    scenarios.append({
        "name": "recommend_01_no_home",
        "kind": "recommendation",
        "description": (
            "Recommendations without a home location (distance measured from "
            "the list, no distance filter at all)."
        ),
        "student_id": STUDENT_RUN,
        "wishes": recommendation_wishes,
        "max_recommendations": MAX_RECOMMENDATIONS,
        "home_geo_reference": None,
    })
    scenarios.append({
        "name": "recommend_02_home_address_precision",
        "kind": "recommendation",
        "description": (
            "Same list with a fixed Rapa Nui home at address precision: the "
            "100 km hard distance filter applies and drops every mainland "
            "candidate, leaving only the schools on the island."
        ),
        "student_id": STUDENT_RUN,
        "wishes": recommendation_wishes,
        "max_recommendations": MAX_RECOMMENDATIONS,
        "home_geo_reference": {
            "lat": HOME_LAT,
            "lon": HOME_LON,
            "precision": "address",
            "display_name": "Fixed test coordinates (never geocoded)",
        },
    })
    scenarios.append({
        "name": "recommend_03_home_city_precision",
        "kind": "recommendation",
        "description": (
            "Same coordinates at city precision: no hard cutoff is applied, so "
            "the mainland candidates the address run dropped come back, "
            "penalized only by the proximity score. Comparing this fixture with "
            "recommend_02 is what proves the precision branch is honoured."
        ),
        "student_id": STUDENT_RUN,
        "wishes": recommendation_wishes,
        "max_recommendations": MAX_RECOMMENDATIONS,
        "home_geo_reference": {
            "lat": HOME_LAT,
            "lon": HOME_LON,
            "precision": "city",
            "display_name": "Fixed test coordinates (never geocoded)",
        },
    })

    # -- 5 identifier cases ------------------------------------------------
    scenarios.extend([
        {
            "name": "identifier_01_valid_run",
            "kind": "identifier",
            "description": "Canonical RUN with a correct modulo-11 check digit.",
            "raw_identifier": STUDENT_RUN,
        },
        {
            "name": "identifier_02_dotted_run",
            "kind": "identifier",
            "description": "The same RUN written with dots and a hyphen.",
            "raw_identifier": f"{RUN_BODY[:2]}.{RUN_BODY[2:5]}.{RUN_BODY[5:]}-{_run_check_digit(RUN_BODY)}",
        },
        {
            "name": "identifier_03_invalid_check_digit",
            "kind": "identifier",
            "description": "A RUN whose check digit does not match the modulo-11 rule.",
            "raw_identifier": f"{RUN_BODY}-{'0' if _run_check_digit(RUN_BODY) != '0' else '1'}",
        },
        {
            "name": "identifier_04_valid_ipe",
            "kind": "identifier",
            "description": "Nine-digit IPE plus its numeric verifier digit.",
            "raw_identifier": STUDENT_IPE,
        },
        {
            "name": "identifier_05_garbage",
            "kind": "identifier",
            "description": "Free text that is neither a RUN nor an IPE.",
            "raw_identifier": "not-an-identifier",
        },
    ])

    return scenarios


# ---------------------------------------------------------------------------
# Fixture building
# ---------------------------------------------------------------------------

def build_fixture(
    scenario: dict,
    program_mapping: dict[str, pd.Series],
    label_to_id: dict[str, str],
) -> dict:
    kind = scenario["kind"]

    if kind == "identifier":
        return {
            "name": scenario["name"],
            "kind": kind,
            "description": scenario["description"],
            "inputs": {"raw_identifier": scenario["raw_identifier"]},
            "expected": identifier_expectation(scenario["raw_identifier"]),
        }

    use_equivalence_classes = kind == "equivalence"
    edited = build_edited_wishes(scenario["wishes"], use_equivalence_classes)

    inputs = {
        "student_id": scenario["student_id"],
        "use_equivalence_classes": use_equivalence_classes,
        "wishes": wish_rows_for_fixture(edited, label_to_id),
    }

    if kind == "strict":
        expected = run_strict_simulation(
            edited, program_mapping, scenario["student_id"], label_to_id
        )
    elif kind == "equivalence":
        expected = run_equivalence_simulation(
            edited, program_mapping, scenario["student_id"], label_to_id
        )
    elif kind == "recommendation":
        inputs["max_recommendations"] = scenario["max_recommendations"]
        inputs["home_geo_reference"] = scenario["home_geo_reference"]
        expected = run_recommendations(
            edited,
            program_mapping,
            scenario["student_id"],
            label_to_id,
            max_recommendations=scenario["max_recommendations"],
            home_geo_reference=scenario["home_geo_reference"],
        )
    else:
        raise ValueError(f"Unknown scenario kind: {kind}")

    fixture = {
        "name": scenario["name"],
        "kind": kind,
        "description": scenario["description"],
        "inputs": inputs,
        "expected": expected,
    }
    if "notes" in scenario:
        fixture["notes"] = scenario["notes"]
    return fixture


def verify_coverage(fixtures: list[dict]) -> None:
    """Refuse to write a baseline that lost a case it is supposed to freeze.

    Every check here corresponds to a scenario the fixtures are meant to cover and
    that a plausible data refresh could silently flatten. Failing loudly beats
    committing fixtures that a broken implementation would still reproduce.
    """
    by_name = {fixture["name"]: fixture for fixture in fixtures}

    # 1. All four SAE priority tiers plus the no-priority tier are frozen.
    tiers_seen: set[str] = set()
    for fixture in fixtures:
        expected = fixture.get("expected") or {}
        rows = list(expected.get("choices") or [])
        rows += list(expected.get("reference_choices") or [])
        for row in rows:
            tiers_seen.add(str(row.get("priority_tier", "")))
    missing = [tier for tier in list(PRIORITIES) + [NO_PRIORITY] if tier not in tiers_seen]
    if missing:
        raise SystemExit(
            "The generated fixtures never reach these priority tiers: "
            f"{', '.join(missing)}. A regression in their resolution would "
            "reproduce the whole baseline, so the fixtures are not written."
        )

    # 2. One equivalence fixture is the 'stable' verdict on a non-zero risk.
    stable = by_name["equiv_01_two_tied_stable_outcome"]["expected"]
    outcomes = {variant["predicted_outcome"] for variant in stable["variants"]}
    chances = [variant["predicted_outcome_final_chance"] for variant in stable["variants"]]
    risks = [variant["unmatched_risk"] for variant in stable["variants"]]
    chance_range = max(chances) - min(chances)
    if (
        len(outcomes) != 1
        or outcomes == {"Unmatched"}
        or chance_range >= EQUIV_PROBABILITY_CHANGE_WARNING_THRESHOLD
        or not 0.0 < min(risks) == max(risks) < HARD_UNMATCHED_THRESHOLD
    ):
        raise SystemExit(
            "equiv_01 no longer freezes the 'stable' sensitivity verdict on a "
            f"non-zero unmatched risk (outcomes={sorted(outcomes)}, "
            f"chance range={chance_range!r}, risks={sorted(set(risks))!r})."
        )

    # 3. One equivalence fixture keeps the outcome but shifts its probability.
    shifting = by_name["equiv_03_group_of_four_probability_shift"]["expected"]
    outcomes = {variant["predicted_outcome"] for variant in shifting["variants"]}
    chances = [variant["predicted_outcome_final_chance"] for variant in shifting["variants"]]
    chance_range = max(chances) - min(chances)
    if (
        len(outcomes) != 1
        or outcomes == {"Unmatched"}
        or chance_range < EQUIV_PROBABILITY_CHANGE_WARNING_THRESHOLD
    ):
        raise SystemExit(
            "equiv_03 no longer freezes the 'same outcome, different chance' "
            f"sensitivity verdict (outcomes={sorted(outcomes)}, "
            f"chance range={chance_range!r})."
        )

    # 4. The two recommendation runs really disagree about the hard filter.
    address_run = by_name["recommend_02_home_address_precision"]["expected"]
    city_run = by_name["recommend_03_home_city_precision"]["expected"]
    address_ids = [row["program_id"] for row in address_run["recommendations"]]
    city_ids = [row["program_id"] for row in city_run["recommendations"]]
    if not address_run["home_supports_hard_distance_filter"]:
        raise SystemExit("recommend_02 no longer uses a hard-filter precision.")
    if city_run["home_supports_hard_distance_filter"]:
        raise SystemExit("recommend_03 no longer uses a soft-filter precision.")
    if address_ids == city_ids:
        raise SystemExit(
            "The address- and city-precision recommendation runs return the "
            f"same programs ({address_ids}), so the fixtures would not prove "
            "the hard distance filter is applied. Move HOME_LAT/HOME_LON to a "
            "location with fewer than MAX_RECOMMENDATIONS candidates inside "
            "RECOMMENDATION_MAX_HOME_DISTANCE_KM."
        )


def write_json(path: Path, payload: dict) -> None:
    text = json.dumps(to_jsonable(payload), indent=2, ensure_ascii=False, allow_nan=False)
    path.write_text(text + "\n", encoding="utf-8")


def main() -> int:
    # Fail loudly rather than freezing a baseline built on a bad identifier.
    if normalize_student_identifier(STUDENT_RUN) != STUDENT_RUN:
        raise SystemExit(f"STUDENT_RUN is not canonical: {STUDENT_RUN}")
    if normalize_student_identifier(STUDENT_IPE) != STUDENT_IPE:
        raise SystemExit(f"STUDENT_IPE is not canonical: {STUDENT_IPE}")

    calib = load_calibration(CAPACITIES_PATH.read_bytes())
    program_mapping = build_program_mapping(calib)
    _id_to_label, label_to_id = build_id_maps(program_mapping)

    pools = select_programs(program_mapping, STUDENT_RUN)
    scenarios = build_scenarios(pools)

    # Everything is computed before anything is written, so a coverage failure
    # leaves the committed baseline untouched.
    fixtures = [
        build_fixture(scenario, program_mapping, label_to_id) for scenario in scenarios
    ]
    verify_coverage(fixtures)

    GOLDEN_DIR.mkdir(parents=True, exist_ok=True)
    for stale in sorted(GOLDEN_DIR.glob("*.json")):
        stale.unlink()

    written: list[str] = []
    for fixture in fixtures:
        path = GOLDEN_DIR / f"{fixture['name']}.json"
        write_json(path, fixture)
        written.append(path.name)
        print(f"wrote {path.relative_to(REPO_ROOT)}")

    metadata = {
        "purpose": (
            "Provenance of the committed golden fixtures. Not compared by the "
            "tests: files whose name starts with '_' are skipped."
        ),
        "student_run": STUDENT_RUN,
        "student_ipe": STUDENT_IPE,
        "home_geo_reference": {"lat": HOME_LAT, "lon": HOME_LON},
        "max_recommendations": MAX_RECOMMENDATIONS,
        "library_versions": {
            "python": sys.version.split()[0],
            "pandas": pd.__version__,
            "numpy": np.__version__,
            "scipy": scipy.__version__,
        },
        "selected_programs": {
            "priority_tiers": {
                tier: {"program_id": label_to_id[label], "program_label": label}
                for tier, label in pools["priority_tiers"].items()
            },
            "long_shot_pool_head": [
                {"program_id": label_to_id[label], "program_label": label}
                for label in pools["long_shot"][:2]
            ],
            "near_certain_pool_head": [
                {"program_id": label_to_id[label], "program_label": label}
                for label in pools["near_certain"][:1]
            ],
            "balanced_pool_head": [
                {"program_id": label_to_id[label], "program_label": label}
                for label in pools["balanced"][:12]
            ],
            "scarce_pool_head": [
                {"program_id": label_to_id[label], "program_label": label}
                for label in pools["scarce"][:12]
            ],
            "santiago_pool_head": [
                {"program_id": label_to_id[label], "program_label": label}
                for label in pools["santiago"][:3]
            ],
            "imputed": (
                {"program_id": label_to_id[pools["imputed"]], "program_label": pools["imputed"]}
                if pools["imputed"] else None
            ),
            "zero_capacity": (
                {
                    "program_id": label_to_id[pools["zero_capacity"]],
                    "program_label": pools["zero_capacity"],
                }
                if pools["zero_capacity"] else None
            ),
            "large_population": {
                "program_id": label_to_id[pools["large_population"]],
                "program_label": pools["large_population"],
                "program_lottery_population_2024": as_float(
                    program_mapping[pools["large_population"]][POP]
                ),
            },
        },
        "program_count": len(program_mapping),
        "fixtures": written,
    }
    write_json(GOLDEN_DIR / "_generation_metadata.json", metadata)
    print(f"wrote {(GOLDEN_DIR / '_generation_metadata.json').relative_to(REPO_ROOT)}")

    if not pools["zero_capacity"]:
        print(
            "NOTE: no program with total_admission_seats == 0 exists in the "
            "current data; the zero-capacity wish was skipped."
        )
    if not pools["imputed"]:
        print(
            "NOTE: no program with calibration_2024_imputed == true exists in "
            "the current data; the imputed wish was skipped."
        )

    print(f"{len(written)} fixture(s) written to {GOLDEN_DIR.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
