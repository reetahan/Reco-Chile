"""Drive the engine with the exact calling convention the fixtures were frozen at.

Both the fixture generator (``tests/generate_golden.py``) and the golden tests
(``tests/test_engine_golden.py``) import this module, so the "how the engine is
called" logic exists once.

This convention is the frozen *baseline*, not a mirror of any current caller.
`api.py` reproducing these numbers through a different code path is what keeps
the engine's arithmetic under contract. The sequences are:

* strict simulation      -> ``prepare_ordered_wishes`` / ``attach_mtb_hashes`` /
                            ``compute``
* equivalence simulation -> the equivalence branch
                            (``count_equivalence_orders`` cap check,
                            ``precompute_equivalence_availability`` once,
                            then ``iter_equivalence_orders`` +
                            ``compute_equivalence_order_from_precomputed``)
* recommendations        -> ``recommend_similar_programs`` with the frozen
                            constants and argument order

When the engine's calling convention changes, update this runner — never the
fixtures.

Cache note: ``recommend_similar_programs`` owns its candidate-risk cache. No
``candidate_cache`` is passed here, so every recommendation run builds a fresh
``CandidateRiskCache`` that lives only for that call — a scenario can never
inherit another scenario's cached candidate metrics.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
REPO_ROOT = TESTS_DIR.parent
for _path in (str(REPO_ROOT), str(TESTS_DIR)):
    if _path not in sys.path:
        sys.path.insert(0, _path)

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from sae_app.constants import (  # noqa: E402
    EQUIV_GROUP,
    HARD_UNMATCHED_THRESHOLD,
    MAX_EXACT_EQUIV_PERMUTATIONS,
    PRIORITIES,
    PROGRAM,
    SAFETY,
    SOFT_UNMATCHED_THRESHOLD,
    WISH_RANK,
)
from sae_app.errors import MtbEngineError  # noqa: E402
from sae_app.geo import home_geocoding_supports_hard_filter  # noqa: E402
from sae_app.mtb_engine import (  # noqa: E402
    attach_mtb_hashes,
    compute,
    compute_equivalence_order_from_precomputed,
    normalize_student_identifier,
    precompute_equivalence_availability,
)
from sae_app.recommendations import (  # noqa: E402
    RECOMMENDATION_COMPETITION_WEIGHT,
    RECOMMENDATION_DISTANCE_SCALE_KM,
    RECOMMENDATION_DIVERSIFY,
    RECOMMENDATION_DIVERSITY_STRENGTH,
    RECOMMENDATION_FAVOR_LESS_OVERSUBSCRIBED,
    RECOMMENDATION_HARD_CONSTRAINT_COLS,
    RECOMMENDATION_MAX_HOME_DISTANCE_KM,
    RECOMMENDATION_MIN_SIMILARITY_SCORE,
    RECOMMENDATION_PROXIMITY_WEIGHT,
    RECOMMENDATION_RISK_OPTIMIZATION_WEIGHT,
    recommend_similar_programs,
)
from sae_app.wish_list import (  # noqa: E402
    count_equivalence_orders,
    iter_equivalence_orders,
    make_builder_wish_row,
    normalize_builder_wishes,
    predicted_outcome_final_chance,
    predicted_outcome_from_choices,
    prepare_ordered_wishes,
)

GOLDEN_DIR = Path(__file__).resolve().parent / "fixtures" / "golden"

PRIORITY_FLAG_COLUMNS = list(PRIORITIES) + [SAFETY]


# ---------------------------------------------------------------------------
# Program identity
# ---------------------------------------------------------------------------

def program_id_for(row: pd.Series) -> str:
    """Stable public identifier, identical to the one ``api.py`` publishes."""
    return f"{str(row['rbd']).strip()}:{str(row['program_code']).strip()}"


def build_id_maps(program_mapping: dict[str, pd.Series]) -> tuple[dict, dict]:
    """Return ``(id_to_label, label_to_id)`` for the loaded program mapping."""
    id_to_label: dict[str, str] = {}
    label_to_id: dict[str, str] = {}
    for label, row in program_mapping.items():
        program_id = program_id_for(row)
        id_to_label[program_id] = label
        label_to_id[label] = program_id
    return id_to_label, label_to_id


# ---------------------------------------------------------------------------
# Wish-list construction
# ---------------------------------------------------------------------------

def build_edited_wishes(
    wish_specs: list[dict],
    use_equivalence_classes: bool,
) -> pd.DataFrame:
    """Return the ``edited`` DataFrame handed to the engine.

    The golden scenarios go through
    ``normalize_builder_wishes(rows, use_equivalence_classes)``.
    """
    rows = []
    for position, spec in enumerate(wish_specs, start=1):
        row = make_builder_wish_row(
            spec["program_label"],
            position,
            int(spec.get("preference_group", position)),
        )
        for column in PRIORITY_FLAG_COLUMNS:
            row[column] = bool(spec.get(column, False))
        rows.append(row)
    return normalize_builder_wishes(pd.DataFrame(rows), use_equivalence_classes)


def wish_specs_from_fixture(inputs: dict) -> list[dict]:
    """Rebuild the scenario's wish specs from a stored fixture."""
    specs = []
    for wish in inputs["wishes"]:
        spec = {
            "program_label": wish["program_label"],
            "preference_group": wish["preference_group"],
        }
        for column in PRIORITY_FLAG_COLUMNS:
            spec[column] = bool(wish[column])
        specs.append(spec)
    return specs


def wish_rows_for_fixture(
    edited: pd.DataFrame,
    label_to_id: dict[str, str],
) -> list[dict]:
    """Serialize the normalized wish list stored under ``inputs.wishes``."""
    rows = []
    for _, wish in edited.iterrows():
        label = str(wish[PROGRAM]).strip()
        if not label:
            continue
        row = {
            "wish_rank": int(wish[WISH_RANK]),
            "preference_group": int(wish[EQUIV_GROUP]),
            "program_id": label_to_id[label],
            "program_label": label,
        }
        for column in PRIORITY_FLAG_COLUMNS:
            row[column] = bool(wish[column])
        rows.append(row)
    return rows


# ---------------------------------------------------------------------------
# Simulations
# ---------------------------------------------------------------------------

def choices_rows(choices: pd.DataFrame, label_to_id: dict[str, str]) -> list[dict]:
    """Every column of the computed choices table, plus the program id."""
    rows = []
    for _, choice in choices.iterrows():
        row = {column: choice[column] for column in choices.columns}
        row["program_id"] = label_to_id.get(str(choice[PROGRAM]).strip())
        rows.append(row)
    return rows


def run_strict_simulation(
    edited: pd.DataFrame,
    program_mapping: dict[str, pd.Series],
    student_id: str,
    label_to_id: dict[str, str],
) -> dict:
    """Strict-mode simulation."""
    strict_order = prepare_ordered_wishes(edited, use_equivalence_classes=False)
    wishes_for_compute = attach_mtb_hashes(strict_order, program_mapping, student_id)
    choices = compute(wishes_for_compute, program_mapping)

    outcome, unmatched_risk, at_risk = predicted_outcome_from_choices(
        choices, HARD_UNMATCHED_THRESHOLD
    )
    return {
        "mode": "strict",
        "hard_threshold": HARD_UNMATCHED_THRESHOLD,
        "soft_threshold": SOFT_UNMATCHED_THRESHOLD,
        "choices": choices_rows(choices, label_to_id),
        "unmatched_risk": unmatched_risk,
        "predicted_outcome": outcome,
        "predicted_outcome_program_id": label_to_id.get(outcome),
        "predicted_outcome_final_chance": predicted_outcome_final_chance(choices, outcome),
        "flagged_at_risk": at_risk,
    }


def strict_unmatched_risk(
    edited: pd.DataFrame,
    program_mapping: dict[str, pd.Series],
    student_id: str,
) -> float:
    """Current unmatched risk of a list."""
    strict_order = prepare_ordered_wishes(edited, use_equivalence_classes=False)
    choices = compute(
        attach_mtb_hashes(strict_order, program_mapping, student_id),
        program_mapping,
    )
    return float(choices["cumulative_unavailable_after_choice"].iloc[-1])


def run_equivalence_simulation(
    edited: pd.DataFrame,
    program_mapping: dict[str, pd.Series],
    student_id: str,
    label_to_id: dict[str, str],
) -> dict:
    """Equivalence-class simulation."""
    reference_order = prepare_ordered_wishes(edited, use_equivalence_classes=True)
    total_orders = count_equivalence_orders(reference_order)

    if total_orders > MAX_EXACT_EQUIV_PERMUTATIONS:
        # Stop here with the "too many strict orders" error; the availability
        # pipeline is never called.
        return {
            "mode": "equivalence",
            "total_orders": total_orders,
            "max_exact_equiv_permutations": MAX_EXACT_EQUIV_PERMUTATIONS,
            "rejected_over_cap": True,
            "reference_choices": None,
            "variants": [],
            "distinct_outcomes": [],
        }

    availability_lookup = precompute_equivalence_availability(
        reference_order,
        program_mapping,
        student_id,
    )

    variants = []
    reference_choices = None
    for index, strict_order in enumerate(iter_equivalence_orders(reference_order), start=1):
        choices = compute_equivalence_order_from_precomputed(strict_order, availability_lookup)
        outcome, unmatched_risk, at_risk = predicted_outcome_from_choices(
            choices, HARD_UNMATCHED_THRESHOLD
        )
        if index == 1:
            reference_choices = choices

        order_labels = [str(value).strip() for value in strict_order[PROGRAM].tolist()]
        variants.append({
            "strict_order_number": index,
            "order_program_ids": [label_to_id[label] for label in order_labels],
            "order_program_labels": order_labels,
            "predicted_outcome": outcome,
            "predicted_outcome_program_id": label_to_id.get(outcome),
            "predicted_outcome_final_chance": predicted_outcome_final_chance(choices, outcome),
            "unmatched_risk": unmatched_risk,
            "flagged_at_risk": at_risk,
        })

    return {
        "mode": "equivalence",
        "total_orders": total_orders,
        "max_exact_equiv_permutations": MAX_EXACT_EQUIV_PERMUTATIONS,
        "rejected_over_cap": False,
        "reference_choices": choices_rows(reference_choices, label_to_id),
        "variants": variants,
        "distinct_outcomes": sorted({variant["predicted_outcome"] for variant in variants}),
    }


# ---------------------------------------------------------------------------
# Recommendations
# ---------------------------------------------------------------------------

def run_recommendations(
    edited: pd.DataFrame,
    program_mapping: dict[str, pd.Series],
    student_id: str,
    label_to_id: dict[str, str],
    *,
    max_recommendations: int,
    home_geo_reference: dict | None,
) -> dict:
    """Recommendations with the frozen argument set.

    ``home_geo_reference`` is passed straight through as a dict; the geocoder is
    never called, so no test or fixture generation touches the network.
    """
    current_unmatched_risk = strict_unmatched_risk(edited, program_mapping, student_id)

    competition_weight = (
        RECOMMENDATION_COMPETITION_WEIGHT if RECOMMENDATION_FAVOR_LESS_OVERSUBSCRIBED else 0.0
    )
    diversity_strength = RECOMMENDATION_DIVERSITY_STRENGTH if RECOMMENDATION_DIVERSIFY else 0.0

    # No ``candidate_cache`` argument: the call creates and discards its own.
    recommendations, _profile_table = recommend_similar_programs(
        edited,
        program_mapping,
        student_id=student_id,
        current_unmatched_risk=current_unmatched_risk,
        max_recommendations=max_recommendations,
        rank_sensitive=True,
        competition_weight=competition_weight,
        hard_constraint_cols=RECOMMENDATION_HARD_CONSTRAINT_COLS,
        proximity_weight=RECOMMENDATION_PROXIMITY_WEIGHT,
        distance_scale_km=float(RECOMMENDATION_DISTANCE_SCALE_KM),
        home_geo_reference=home_geo_reference,
        max_home_distance_km=(
            RECOMMENDATION_MAX_HOME_DISTANCE_KM if home_geo_reference else None
        ),
        risk_optimization_weight=RECOMMENDATION_RISK_OPTIMIZATION_WEIGHT,
        min_similarity_score=RECOMMENDATION_MIN_SIMILARITY_SCORE,
        diversify=RECOMMENDATION_DIVERSIFY,
        diversity_strength=diversity_strength,
    )

    rows = []
    for _, recommendation in recommendations.iterrows():
        row = {column: recommendation[column] for column in recommendations.columns}
        row["program_id"] = label_to_id.get(str(recommendation[PROGRAM]).strip())
        row["program_label"] = str(recommendation[PROGRAM]).strip()
        rows.append(row)

    diagnostics = dict(recommendations.attrs.get("recommendation_diagnostics", {}))
    diagnostics["failed_candidate_examples"] = [
        list(example) for example in diagnostics.get("failed_candidate_examples", ())
    ]

    return {
        "current_unmatched_risk": current_unmatched_risk,
        # Whether the home precision allows a hard distance cutoff at all; the
        # engine additionally requires reliable program coordinates per
        # candidate (geo.home_distance_filter_is_reliable).
        "home_supports_hard_distance_filter": bool(
            home_geo_reference is not None
            and home_geocoding_supports_hard_filter(home_geo_reference)
        ),
        "recommendation_count": len(rows),
        "recommendations": rows,
        "diagnostics": diagnostics,
    }


# ---------------------------------------------------------------------------
# Student identifiers
# ---------------------------------------------------------------------------

def identifier_expectation(raw_identifier: str) -> dict:
    """Normalized identifier, or the error class plus its untranslated key.

    Engine errors carry a ``message_key`` and are never translated inside the
    engine (CONTRIBUTING.md, "Error handling"), so the key is what gets frozen.
    """
    try:
        return {
            "normalized": normalize_student_identifier(raw_identifier),
            "error_class": None,
            "message_key": None,
        }
    except MtbEngineError as exc:
        return {
            "normalized": None,
            "error_class": type(exc).__name__,
            "message_key": exc.message_key,
        }


# ---------------------------------------------------------------------------
# JSON serialization
# ---------------------------------------------------------------------------

def to_jsonable(value):
    """Convert engine output to JSON-safe values.

    Floats keep full ``repr`` precision (``json`` already round-trips them);
    every NaN/NA becomes ``null``; numpy scalars become Python scalars.
    """
    if value is None:
        return None
    if isinstance(value, (bool, np.bool_)):
        return bool(value)
    if isinstance(value, (int, np.integer)):
        return int(value)
    if isinstance(value, (float, np.floating)):
        as_float = float(value)
        if math.isnan(as_float):
            return None
        if math.isinf(as_float):
            raise ValueError("Infinite value cannot be stored in a golden fixture")
        return as_float
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        return {str(key): to_jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set, frozenset, np.ndarray)):
        return [to_jsonable(item) for item in value]
    if value is pd.NaT or (not isinstance(value, pd.Series) and pd.isna(value)):
        return None
    return str(value)
