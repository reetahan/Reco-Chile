"""API contract v1 tests.

Every number the HTTP layer returns is compared against the committed golden
fixtures — the same files ``test_engine_golden.py`` replays through the engine
directly. If these two suites disagree, the adapter, not the engine, is wrong.

Nothing here touches the network: ``/geocode`` is exercised with a
monkeypatched ``api.geocode_chilean_address``, and the recommendation fixtures
carry a fixed home coordinate that was never geocoded.
"""

from __future__ import annotations

import json
import logging
import sys
import threading
import time
from contextlib import contextmanager
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
REPO_ROOT = TESTS_DIR.parent
for _path in (str(REPO_ROOT), str(TESTS_DIR)):
    if _path not in sys.path:
        sys.path.insert(0, _path)

import httpx  # noqa: E402
import pytest  # noqa: E402
import uvicorn  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import api  # noqa: E402
from sae_app.constants import (  # noqa: E402
    MAX_WISHES,
    MAX_EXACT_EQUIV_PERMUTATIONS,
    PAYMENT_FILTER_OPTIONS,
    PIE_FILTER_OPTIONS,
)

from golden_runner import GOLDEN_DIR  # noqa: E402

FLOAT_TOLERANCE = 1e-12

FIXTURE_PATHS = sorted(
    path for path in GOLDEN_DIR.glob("*.json") if not path.name.startswith("_")
)


def _fixtures(kind: str) -> list[dict]:
    out = []
    for path in FIXTURE_PATHS:
        fixture = json.loads(path.read_text(encoding="utf-8"))
        if fixture.get("kind") == kind:
            out.append(fixture)
    return out


STRICT_FIXTURES = _fixtures("strict")
EQUIVALENCE_FIXTURES = _fixtures("equivalence")
RECOMMENDATION_FIXTURES = _fixtures("recommendation")


def _ids(fixtures: list[dict]) -> list[str]:
    return [fixture["name"] for fixture in fixtures]


@pytest.fixture(scope="module")
def client():
    """A TestClient entered as a context manager, so ``lifespan`` really runs.

    Without the ``with`` block FastAPI never populates ``api.STATE`` and every
    endpoint would fail on a KeyError instead of on its own logic.
    """
    with TestClient(api.app) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def _reset_geocode_rate_limiter():
    """Each test starts with the full per-IP geocoding budget."""
    api._GEOCODE_RATE_LIMITER.reset()
    yield
    api._GEOCODE_RATE_LIMITER.reset()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _wire_wishes(fixture: dict, *, explicit_groups: bool) -> list[dict]:
    """Fixture wishes as the request body of /simulate and /recommend.

    ``explicit_groups`` distinguishes the two modes the contract collapses into
    one pipeline: a strict list omits ``equivalence_group`` entirely, a tied
    list sends the fixture's ``preference_group``.
    """
    wishes = []
    for wish in fixture["inputs"]["wishes"]:
        item = {
            "program_id": wish["program_id"],
            "priority_sibling": wish["priority_sibling"],
            "priority_student": wish["priority_student"],
            "priority_parent_civil_servant": wish["priority_parent_civil_servant"],
            "priority_ex_student": wish["priority_ex_student"],
            "priority_already_registered": wish["priority_already_registered"],
        }
        if explicit_groups:
            item["equivalence_group"] = wish["preference_group"]
        wishes.append(item)
    return wishes


def _assert_close(actual, expected, label: str) -> None:
    if expected is None:
        assert actual is None, f"{label}: expected null, got {actual!r}"
        return
    assert actual is not None, f"{label}: expected {expected!r}, got null"
    assert abs(float(actual) - float(expected)) <= FLOAT_TOLERANCE, (
        f"{label}: {actual!r} != {expected!r}"
    )


def _assert_choices_match(wishes: list[dict], expected_choices: list[dict]) -> None:
    """Per-wish probabilities and identity, in order."""
    assert len(wishes) == len(expected_choices)
    for wish, expected in zip(wishes, expected_choices):
        label = f"wish {expected['wish_rank']} ({expected['program_id']})"
        assert wish["program_id"] == expected["program_id"], label
        assert wish["program_label"] == expected["program"], label
        assert wish["wish_rank"] == expected["wish_rank"], label
        assert wish["priority_tier"] == expected["priority_tier"], label
        assert wish["lottery_number"] == expected["lottery_number"], label
        assert wish["lottery_population_used"] == expected["lottery_population_used"], label
        assert wish["capacity"] == expected["capacity"], label
        assert (
            wish["true_applicants_last_year"] == expected["true_applicants_last_year"]
        ), label
        assert wish["calibration_imputed"] == expected["calibration_2024_imputed"], label
        _assert_close(
            wish["availability_probability"],
            expected["availability_probability"],
            f"{label}.availability_probability",
        )
        _assert_close(
            wish["cumulative_unavailable_before_choice"],
            expected["cumulative_unavailable_before_choice"],
            f"{label}.cumulative_unavailable_before_choice",
        )
        _assert_close(
            wish["choice_assignment_probability"],
            expected["choice_assignment_probability"],
            f"{label}.choice_assignment_probability",
        )


def _assert_outcomes_consistent(payload: dict, expected_choices: list[dict]) -> None:
    """Outcomes mirror ordered_estimated_outcomes: positive programs + Unmatched."""
    outcomes = payload["outcomes"]
    unmatched = [item for item in outcomes if item["program_id"] is None]
    assert len(unmatched) == 1
    assert unmatched[0]["label"] == "Unmatched"
    _assert_close(
        unmatched[0]["probability"],
        payload["unmatched_risk"],
        "outcomes.Unmatched.probability",
    )

    expected_positive = {
        choice["program_id"]: choice["choice_assignment_probability"]
        for choice in expected_choices
        if choice["choice_assignment_probability"] > 0
    }
    actual_positive = {
        item["program_id"]: item["probability"]
        for item in outcomes
        if item["program_id"] is not None
    }
    assert set(actual_positive) == set(expected_positive)
    for program_id, probability in expected_positive.items():
        _assert_close(actual_positive[program_id], probability, f"outcomes[{program_id}]")

    probabilities = [item["probability"] for item in outcomes]
    assert probabilities == sorted(probabilities, reverse=True)


def _attention_level_for(unmatched_risk: float, thresholds: dict) -> str:
    if unmatched_risk >= thresholds["hard"]:
        return "high"
    if thresholds["soft"] <= unmatched_risk < thresholds["hard"]:
        return "moderate"
    return "low"


# ---------------------------------------------------------------------------
# /health, /meta, /regions
# ---------------------------------------------------------------------------

def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_meta_shape(client):
    meta = client.get("/meta").json()

    assert meta["api_version"] == api.API_VERSION
    assert meta["hard_unmatched_threshold"] == pytest.approx(0.027)
    assert meta["soft_unmatched_threshold"] == pytest.approx(0.004)
    assert meta["equiv_probability_change_warning_threshold"] == pytest.approx(0.005)
    assert meta["max_exact_equiv_permutations"] == MAX_EXACT_EQUIV_PERMUTATIONS
    assert meta["recommendation_max_home_distance_km"] == pytest.approx(100.0)
    assert meta["max_wishes"] == MAX_WISHES

    assert meta["regions"] == client.get("/regions").json()
    assert meta["regions"], "at least one region must be exposed"

    # A stable short digest, so the frontend can tell a data refresh happened.
    assert len(meta["data_fingerprint"]) == 16
    assert set(meta["data_fingerprint"]) <= set("0123456789abcdef")
    assert meta["data_fingerprint"] == client.get("/meta").json()["data_fingerprint"]

    filter_options = meta["filter_options"]
    assert set(filter_options) == {
        "tracks",
        "specialty_sectors",
        "genders",
        "school_days",
        "rurality",
        "pie",
        "pace",
        "enrollment_fee",
        "monthly_fee",
        "religious_orientation",
    }
    assert filter_options["tracks"] == ["General", "Specialized"]
    assert filter_options["pie"] == PIE_FILTER_OPTIONS
    assert filter_options["enrollment_fee"] == filter_options["monthly_fee"]
    for key, values in filter_options.items():
        assert values, f"filter option list {key} must not be empty"


# ---------------------------------------------------------------------------
# /programs
# ---------------------------------------------------------------------------

def test_programs_default_page(client):
    payload = client.get("/programs", params={"limit": 5}).json()

    assert len(payload["items"]) == 5
    assert payload["offset"] == 0
    assert payload["limit"] == 5
    assert payload["total_matched"] > 5
    assert payload["truncated"] is True

    item = payload["items"][0]
    assert set(item) == {
        "program_id",
        "program_label",
        "school_name",
        "school_commune",
        "region",
        "program_display_name",
        "program_track",
        "program_specialty_sector",
        "program_gender",
        "program_school_day",
        "program_rurality",
        "program_pie",
        "program_pace",
        "program_enrollment_fee",
        "program_monthly_fee",
        "program_religious_orientation",
        "capacity",
        "true_applicants_last_year",
        "calibration_imputed",
    }
    assert isinstance(item["calibration_imputed"], bool)


def test_programs_filter_by_pie(client):
    payload = client.get(
        "/programs", params={"pie": "With PIE", "limit": 1000}
    ).json()

    assert payload["total_matched"] > 0
    assert payload["total_matched"] < client.get("/programs").json()["total_matched"] + 1
    assert {item["program_pie"] for item in payload["items"]} == {"With PIE"}

    # The two PIE values partition the catalogue.
    without = client.get("/programs", params={"pie": "Without PIE", "limit": 1}).json()
    everything = client.get("/programs", params={"limit": 1}).json()
    assert payload["total_matched"] + without["total_matched"] == everything["total_matched"]


def test_programs_repeatable_filters_are_a_union(client):
    boys = client.get("/programs", params={"gender": "Boys", "limit": 1}).json()
    girls = client.get("/programs", params={"gender": "Girls", "limit": 1}).json()
    both = client.get(
        "/programs", params=[("gender", "Boys"), ("gender", "Girls"), ("limit", 1)]
    ).json()

    assert both["total_matched"] == boys["total_matched"] + girls["total_matched"]


def test_programs_region_and_query_filters(client):
    region = client.get("/regions").json()[0]
    payload = client.get("/programs", params={"region": region, "limit": 1000}).json()

    assert payload["total_matched"] > 0
    assert {item["region"] for item in payload["items"]} == {region}

    needle = payload["items"][0]["school_commune"].lower()
    searched = client.get(
        "/programs", params={"region": region, "q": needle, "limit": 1000}
    ).json()
    assert searched["total_matched"] > 0
    assert searched["total_matched"] <= payload["total_matched"]


def test_programs_offset_pagination_is_consistent(client):
    everything = client.get("/programs", params={"limit": 1000, "offset": 0}).json()
    total = everything["total_matched"]

    first = client.get("/programs", params={"limit": 10, "offset": 0}).json()
    second = client.get("/programs", params={"limit": 10, "offset": 10}).json()

    assert first["total_matched"] == second["total_matched"] == total
    assert first["offset"] == 0 and second["offset"] == 10
    assert [item["program_id"] for item in first["items"]] == [
        item["program_id"] for item in everything["items"][:10]
    ]
    assert [item["program_id"] for item in second["items"]] == [
        item["program_id"] for item in everything["items"][10:20]
    ]

    # Ordering is the mapping order, so pages never overlap or skip a program.
    assert not set(item["program_id"] for item in first["items"]) & set(
        item["program_id"] for item in second["items"]
    )

    last = client.get("/programs", params={"limit": 10, "offset": total - 3}).json()
    assert len(last["items"]) == 3
    assert last["truncated"] is False

    beyond = client.get("/programs", params={"limit": 10, "offset": total}).json()
    assert beyond["items"] == []
    assert beyond["total_matched"] == total
    assert beyond["truncated"] is False


def test_programs_negative_offset_is_rejected(client):
    response = client.get("/programs", params={"offset": -1})
    assert response.status_code == 422
    body = response.json()
    assert body["error_key"] == "validation_error"
    assert "errors" in body["params"]


def test_program_detail_and_404(client):
    listed = client.get("/programs", params={"limit": 1}).json()["items"][0]

    detail = client.get(f"/programs/{listed['program_id']}")
    assert detail.status_code == 200
    assert detail.json() == listed

    missing = client.get("/programs/0:0")
    assert missing.status_code == 404
    body = missing.json()
    assert set(body) == {"error_key", "message", "params"}
    assert body["error_key"] == "unknown_program_id"
    assert body["params"] == {"program_id": "0:0"}


# ---------------------------------------------------------------------------
# Error envelope
# ---------------------------------------------------------------------------

def test_error_envelope_is_bare_and_localized(client):
    """4xx bodies are the envelope itself, never nested under `detail`."""
    program_id = client.get("/programs", params={"limit": 1}).json()["items"][0][
        "program_id"
    ]
    body = {"student_id": "12345678-9", "wishes": [{"program_id": program_id}]}

    spanish = client.post("/simulate", params={"lang": "es"}, json=body)
    english = client.post("/simulate", params={"lang": "en"}, json=body)

    assert spanish.status_code == english.status_code == 422
    for response in (spanish, english):
        payload = response.json()
        assert set(payload) == {"error_key", "message", "params"}
        assert "detail" not in payload
        assert payload["error_key"] == "The RUN check digit is invalid."

    assert english.json()["message"] == "The RUN check digit is invalid."
    assert spanish.json()["message"] == "El dígito verificador del RUN es inválido."
    assert spanish.json()["message"] != english.json()["message"]


def test_language_falls_back_to_spanish(client):
    program_id = client.get("/programs", params={"limit": 1}).json()["items"][0][
        "program_id"
    ]
    body = {"student_id": "12345678-9", "wishes": [{"program_id": program_id}]}
    spanish_message = "El dígito verificador del RUN es inválido."

    assert client.post("/simulate", json=body).json()["message"] == spanish_message
    assert (
        client.post("/simulate", params={"lang": "de"}, json=body).json()["message"]
        == spanish_message
    )
    assert (
        client.post(
            "/simulate", json=body, headers={"Accept-Language": "de,en;q=0.8"}
        ).json()["message"]
        == "The RUN check digit is invalid."
    )
    # An explicit ?lang wins over the header.
    assert (
        client.post(
            "/simulate",
            params={"lang": "es"},
            json=body,
            headers={"Accept-Language": "en"},
        ).json()["message"]
        == spanish_message
    )


def test_unknown_and_duplicate_program_ids(client):
    program_id = client.get("/programs", params={"limit": 1}).json()["items"][0][
        "program_id"
    ]

    unknown = client.post(
        "/simulate",
        json={"student_id": "12345678-5", "wishes": [{"program_id": "0:0"}]},
    )
    assert unknown.status_code == 422
    assert unknown.json()["error_key"] == "unknown_program_id"
    assert unknown.json()["params"] == {"program_id": "0:0"}

    duplicate = client.post(
        "/simulate",
        json={
            "student_id": "12345678-5",
            "wishes": [{"program_id": program_id}, {"program_id": program_id}],
        },
    )
    assert duplicate.status_code == 422
    assert duplicate.json()["error_key"] == "duplicate_program_id"
    assert duplicate.json()["params"] == {"program_id": program_id}


def test_empty_wish_list_is_a_validation_error(client):
    response = client.post("/simulate", json={"student_id": "12345678-5", "wishes": []})
    assert response.status_code == 422
    assert response.json()["error_key"] == "validation_error"


# ---------------------------------------------------------------------------
# /simulate — strict fixtures
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("fixture", STRICT_FIXTURES, ids=_ids(STRICT_FIXTURES))
def test_simulate_reproduces_strict_fixture(client, fixture):
    expected = fixture["expected"]

    response = client.post(
        "/simulate",
        json={
            "student_id": fixture["inputs"]["student_id"],
            "wishes": _wire_wishes(fixture, explicit_groups=False),
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()

    _assert_close(payload["unmatched_risk"], expected["unmatched_risk"], "unmatched_risk")
    assert payload["at_risk"] == expected["flagged_at_risk"]
    assert payload["predicted_outcome"] == expected["predicted_outcome"]
    assert (
        payload["predicted_outcome_program_id"]
        == expected["predicted_outcome_program_id"]
    )
    assert payload["thresholds"]["hard"] == pytest.approx(expected["hard_threshold"])
    assert payload["thresholds"]["soft"] == pytest.approx(expected["soft_threshold"])
    assert payload["attention_level"] == _attention_level_for(
        expected["unmatched_risk"], payload["thresholds"]
    )

    _assert_choices_match(payload["wishes"], expected["choices"])
    _assert_outcomes_consistent(payload, expected["choices"])

    # A strict list has exactly one compatible order, so there is nothing to
    # be sensitive to.
    assert payload["equivalence_sensitivity"] is None


# The three-level alert is a presentation boundary the frontend copies from
# /meta, so the boundaries themselves are pinned to literal levels here rather
# than recomputed from the thresholds the response just returned.
EXPECTED_ATTENTION_LEVELS = {
    "strict_01_single_wish": "high",
    "strict_02_three_wishes": "low",
    "strict_03_four_wishes_priority_tiers": "low",
    "strict_04_eight_wishes_scarce": "high",
    "strict_05_twelve_wishes_already_registered": "low",
    "strict_06_imputed_and_zero_capacity": "low",
    "equiv_01_two_tied_stable_outcome": "moderate",
    "equiv_02_two_groups_of_three": "low",
    "equiv_03_group_of_four_probability_shift": "low",
}


@pytest.mark.parametrize(
    ("fixture_name", "expected_level"), sorted(EXPECTED_ATTENTION_LEVELS.items())
)
def test_attention_levels_are_pinned(client, fixture_name, expected_level):
    fixture = next(
        item
        for item in STRICT_FIXTURES + EQUIVALENCE_FIXTURES
        if item["name"] == fixture_name
    )
    payload = client.post(
        "/simulate",
        json={
            "student_id": fixture["inputs"]["student_id"],
            "wishes": _wire_wishes(
                fixture, explicit_groups=fixture["kind"] == "equivalence"
            ),
        },
    ).json()

    assert payload["attention_level"] == expected_level


# ---------------------------------------------------------------------------
# /simulate — equivalence fixtures
# ---------------------------------------------------------------------------

ACCEPTED_EQUIVALENCE_FIXTURES = [
    fixture for fixture in EQUIVALENCE_FIXTURES if not fixture["expected"]["rejected_over_cap"]
]
REJECTED_EQUIVALENCE_FIXTURES = [
    fixture for fixture in EQUIVALENCE_FIXTURES if fixture["expected"]["rejected_over_cap"]
]


@pytest.mark.parametrize(
    "fixture",
    ACCEPTED_EQUIVALENCE_FIXTURES,
    ids=_ids(ACCEPTED_EQUIVALENCE_FIXTURES),
)
def test_simulate_reproduces_equivalence_fixture(client, fixture):
    expected = fixture["expected"]

    response = client.post(
        "/simulate",
        json={
            "student_id": fixture["inputs"]["student_id"],
            "wishes": _wire_wishes(fixture, explicit_groups=True),
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()

    assert payload["thresholds"]["hard"] == pytest.approx(0.027)
    assert payload["thresholds"]["soft"] == pytest.approx(0.004)
    assert payload["attention_level"] == _attention_level_for(
        expected["variants"][0]["unmatched_risk"], payload["thresholds"]
    )

    _assert_choices_match(payload["wishes"], expected["reference_choices"])
    _assert_outcomes_consistent(payload, expected["reference_choices"])

    sensitivity = payload["equivalence_sensitivity"]
    assert sensitivity is not None
    assert sensitivity["total_orders"] == expected["total_orders"]
    assert len(sensitivity["variants"]) == expected["total_orders"]
    assert sensitivity["distinct_outcome_count"] == len(expected["distinct_outcomes"])
    assert sensitivity["outcome_stable"] == (len(expected["distinct_outcomes"]) == 1)

    expected_variants = expected["variants"]
    for variant, expected_variant in zip(sensitivity["variants"], expected_variants):
        label = f"variant {expected_variant['strict_order_number']}"
        assert variant["order_index"] == expected_variant["strict_order_number"], label
        assert variant["program_order"] == expected_variant["order_program_ids"], label
        assert variant["predicted_outcome"] == expected_variant["predicted_outcome"], label
        assert (
            variant["predicted_outcome_program_id"]
            == expected_variant["predicted_outcome_program_id"]
        ), label
        assert variant["at_risk"] == expected_variant["flagged_at_risk"], label
        _assert_close(
            variant["unmatched_risk"],
            expected_variant["unmatched_risk"],
            f"{label}.unmatched_risk",
        )
        _assert_close(
            variant["predicted_outcome_final_chance"],
            expected_variant["predicted_outcome_final_chance"],
            f"{label}.predicted_outcome_final_chance",
        )

    chances = [
        variant["predicted_outcome_final_chance"]
        for variant in expected_variants
        if variant["predicted_outcome_final_chance"] is not None
    ]
    _assert_close(sensitivity["predicted_chance_min"], min(chances), "predicted_chance_min")
    _assert_close(sensitivity["predicted_chance_max"], max(chances), "predicted_chance_max")

    # The reference order is the first variant.
    first = expected_variants[0]
    _assert_close(payload["unmatched_risk"], first["unmatched_risk"], "unmatched_risk")
    assert payload["predicted_outcome"] == first["predicted_outcome"]
    assert payload["at_risk"] == first["flagged_at_risk"]


def test_tied_order_reports_only_genuinely_tied_groups(client):
    """`tied_order` is structured and lists genuinely tied groups only."""
    fixture = next(
        item for item in ACCEPTED_EQUIVALENCE_FIXTURES
        if item["name"] == "equiv_01_two_tied_stable_outcome"
    )
    payload = client.post(
        "/simulate",
        json={
            "student_id": fixture["inputs"]["student_id"],
            "wishes": _wire_wishes(fixture, explicit_groups=True),
        },
    ).json()

    tied_ids = {
        wish["program_id"]
        for wish in fixture["inputs"]["wishes"]
        if wish["preference_group"] == 1
    }
    assert len(tied_ids) == 2

    seen_orders = set()
    for variant in payload["equivalence_sensitivity"]["variants"]:
        # The lone fixed program forms a singleton group and is omitted.
        assert len(variant["tied_order"]) == 1
        group = variant["tied_order"][0]
        assert set(group) == tied_ids
        assert group == variant["program_order"][: len(group)]
        seen_orders.add(tuple(group))

    assert len(seen_orders) == 2, "both internal orders of the tied group appear"


@pytest.mark.parametrize(
    ("fixture_name", "expected_verdict"),
    [
        ("equiv_01_two_tied_stable_outcome", "stable"),
        ("equiv_02_two_groups_of_three", "outcome_changes"),
        ("equiv_03_group_of_four_probability_shift", "stable_probability_shift"),
    ],
)
def test_equivalence_verdicts(client, fixture_name, expected_verdict):
    fixture = next(item for item in EQUIVALENCE_FIXTURES if item["name"] == fixture_name)
    payload = client.post(
        "/simulate",
        json={
            "student_id": fixture["inputs"]["student_id"],
            "wishes": _wire_wishes(fixture, explicit_groups=True),
        },
    ).json()

    assert payload["equivalence_sensitivity"]["verdict"] == expected_verdict


@pytest.mark.parametrize(
    "fixture",
    REJECTED_EQUIVALENCE_FIXTURES,
    ids=_ids(REJECTED_EQUIVALENCE_FIXTURES),
)
def test_simulate_rejects_over_cap_equivalence_list(client, fixture):
    response = client.post(
        "/simulate",
        json={
            "student_id": fixture["inputs"]["student_id"],
            "wishes": _wire_wishes(fixture, explicit_groups=True),
        },
    )
    assert response.status_code == 422
    body = response.json()
    assert body["error_key"] == "too_many_equivalence_orders"
    assert body["params"]["n"] == fixture["expected"]["total_orders"] == 40320
    assert body["params"]["limit"] == MAX_EXACT_EQUIV_PERMUTATIONS
    assert str(MAX_EXACT_EQUIV_PERMUTATIONS) not in body["message"]  # thousands separator
    assert "40,320" in body["message"]


# ---------------------------------------------------------------------------
# /recommend
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "fixture", RECOMMENDATION_FIXTURES, ids=_ids(RECOMMENDATION_FIXTURES)
)
def test_recommend_reproduces_fixture(client, fixture):
    inputs = fixture["inputs"]
    expected = fixture["expected"]

    body = {
        "student_id": inputs["student_id"],
        "wishes": _wire_wishes(fixture, explicit_groups=False),
        "max_recommendations": inputs["max_recommendations"],
    }
    home = inputs["home_geo_reference"]
    if home:
        body["home"] = {
            "lat": home["lat"],
            "lon": home["lon"],
            "precision": home["precision"],
        }

    response = client.post("/recommend", json=body)
    assert response.status_code == 200, response.text
    payload = response.json()

    _assert_close(
        payload["current_unmatched_risk"],
        expected["current_unmatched_risk"],
        "current_unmatched_risk",
    )
    assert payload["distance_reference"] == ("home" if home else "list")
    assert (
        payload["hard_distance_filter_applied"]
        == expected["home_supports_hard_distance_filter"]
    )
    assert len(payload["items"]) == expected["recommendation_count"]
    # The fixtures send no sidebar filters, so nothing is ever cut.
    assert payload["limited_by_filters"] is False
    assert payload["diagnostics"]["failed_candidates"] == (
        expected["diagnostics"]["failed_candidates"]
    )
    assert payload["diagnostics"]["failed_candidate_examples"] == [
        list(example)
        for example in expected["diagnostics"]["failed_candidate_examples"]
    ]

    expected_rows = expected["recommendations"]
    assert [item["program_id"] for item in payload["items"]] == [
        row["program_id"] for row in expected_rows
    ]

    distance_column = (
        "Straight-line distance from home (km)"
        if home
        else "Straight-line distance from current list (km)"
    )
    fallback_expected = False
    for item, row in zip(payload["items"], expected_rows):
        label = f"{row['program_id']}"
        assert item["program_label"] == row["program_label"], label
        assert item["school_name"] == row["School"], label
        assert item["school_commune"] == row["Commune"], label
        assert item["region"] == row["Region"], label
        assert item["program_display_name"] == row["Program details"], label
        assert item["risk_level"] == row["_risk_color"], label
        # Raw engine numbers, never the formatted display strings.
        _assert_close(
            item["chance_if_considered"],
            row["_chance_if_considered_raw"],
            f"{label}.chance_if_considered",
        )
        _assert_close(
            item["projected_unmatched_risk"],
            row["_projected_unmatched_risk_raw"],
            f"{label}.projected_unmatched_risk",
        )
        _assert_close(item["score"], row["_recommendation_score_raw"], f"{label}.score")
        _assert_close(
            item["distance_km"],
            row[distance_column] if row[distance_column] != "" else None,
            f"{label}.distance_km",
        )
        _assert_close(item["capacity"], row["Capacity"], f"{label}.capacity")
        _assert_close(
            item["applicants_per_seat"],
            row["Applicants / seat"] if row["Applicants / seat"] != "" else None,
            f"{label}.applicants_per_seat",
        )
        assert item["estimated_mtb_rank"] == (
            row["Estimated MTB rank"] if row["Estimated MTB rank"] != "" else None
        ), label
        fallback_expected = fallback_expected or bool(row["_similarity_fallback_mode"])

    assert payload["similarity_fallback_mode"] == fallback_expected


@pytest.mark.parametrize(
    "fixture", RECOMMENDATION_FIXTURES, ids=_ids(RECOMMENDATION_FIXTURES)
)
def test_recommend_reports_the_chance_of_the_appended_wish(client, fixture):
    """`final_chance_if_appended` is the engine's own identity, on the wire.

    A candidate appended at the end is reached only if every current wish fell
    through, so its final assignment probability is
    ``current_unmatched_risk * chance_if_considered`` — the equality
    ``candidate_portfolio_metrics`` documents. It is exposed so ``web/`` can
    print the number without multiplying two probabilities itself, and
    ``appended_wish_rank`` names the position it assumes.
    """
    inputs = fixture["inputs"]
    body = {
        "student_id": inputs["student_id"],
        "wishes": _wire_wishes(fixture, explicit_groups=False),
        "max_recommendations": inputs["max_recommendations"],
    }
    home = inputs["home_geo_reference"]
    if home:
        body["home"] = {
            "lat": home["lat"],
            "lon": home["lon"],
            "precision": home["precision"],
        }

    payload = client.post("/recommend", json=body).json()

    assert payload["appended_wish_rank"] == len(body["wishes"]) + 1

    base = payload["current_unmatched_risk"]
    for item in payload["items"]:
        label = item["program_label"]
        final = item["final_chance_if_appended"]
        assert final is not None, label
        _assert_close(final, base * item["chance_if_considered"], f"{label}.final")
        # …and the same number seen from the other side: appending the
        # candidate removes exactly that much unmatched risk.
        _assert_close(
            final, base - item["projected_unmatched_risk"], f"{label}.marginal"
        )
        assert 0.0 <= final <= 1.0, label


def test_recommend_rejects_invalid_student_id(client):
    fixture = RECOMMENDATION_FIXTURES[0]
    response = client.post(
        "/recommend",
        params={"lang": "en"},
        json={
            "student_id": "12345678-9",
            "wishes": _wire_wishes(fixture, explicit_groups=False),
        },
    )
    assert response.status_code == 422
    assert response.json()["error_key"] == "The RUN check digit is invalid."


def test_recommend_filters_restrict_the_candidate_pool(client):
    """The step-2 sidebar filters, reused on step 4: recommendations are limited
    to the programs that match, and a short result says so."""
    fixture = RECOMMENDATION_FIXTURES[0]
    inputs = fixture["inputs"]
    base_body = {
        "student_id": inputs["student_id"],
        "wishes": _wire_wishes(fixture, explicit_groups=False),
        "max_recommendations": inputs["max_recommendations"],
    }

    unfiltered = client.post("/recommend", json=base_body).json()
    assert unfiltered["limited_by_filters"] is False
    assert len(unfiltered["items"]) >= 1

    # Confine the pool to one region: every recommendation moves there, and the
    # count never grows.
    regions = client.get("/meta").json()["regions"]
    other_region = next(
        region for region in regions if region != unfiltered["items"][0]["region"]
    )
    scoped = client.post(
        "/recommend", json={**base_body, "filters": {"region": other_region}}
    ).json()
    assert all(item["region"] == other_region for item in scoped["items"])
    assert len(scoped["items"]) <= len(unfiltered["items"])

    # The rarest enrollment-fee band nationally holds far fewer programs than the
    # requested five, so the result is short and the response says why.
    rare_band = PAYMENT_FILTER_OPTIONS[3]  # "$25,001–$50,000"
    limited = client.post(
        "/recommend", json={**base_body, "filters": {"enrollment_fee": [rare_band]}}
    ).json()
    assert len(limited["items"]) < base_body["max_recommendations"]
    assert limited["limited_by_filters"] is True


@pytest.mark.parametrize("count", [1, 11])
def test_recommend_rejects_out_of_range_counts(client, count):
    fixture = RECOMMENDATION_FIXTURES[0]
    response = client.post(
        "/recommend",
        json={
            "student_id": fixture["inputs"]["student_id"],
            "wishes": _wire_wishes(fixture, explicit_groups=False),
            "max_recommendations": count,
        },
    )
    assert response.status_code == 422
    assert response.json()["error_key"] == "validation_error"


# ---------------------------------------------------------------------------
# /geocode — never touches the network
# ---------------------------------------------------------------------------

FAKE_GEOCODE_OK = {
    "ok": True,
    "address": "Av. Siempre Viva 742, Santiago",
    "lat": -33.4489,
    "lon": -70.6693,
    "display_name": "Av. Siempre Viva 742, Santiago, Chile",
    "precision": "street",
    "house_number_requested": "742",
}

FAKE_GEOCODE_ERROR = {
    "ok": False,
    "address": "nowhere",
    "error_key": "No result found for this address in Chile.",
    "error_kwargs": {},
}


def test_geocode_ok_with_precision_warning(client, monkeypatch):
    calls: list[str] = []

    def fake_geocode(address: str) -> dict:
        calls.append(address)
        return dict(FAKE_GEOCODE_OK)

    monkeypatch.setattr(api, "geocode_chilean_address", fake_geocode)

    response = client.post(
        "/geocode",
        params={"lang": "en"},
        json={"address": "Av. Siempre Viva 742, Santiago"},
    )
    assert response.status_code == 200
    payload = response.json()

    assert calls == ["Av. Siempre Viva 742, Santiago"]
    assert payload["ok"] is True
    assert payload["lat"] == pytest.approx(-33.4489)
    assert payload["lon"] == pytest.approx(-70.6693)
    assert payload["precision"] == "street"
    assert payload["display_name"] == FAKE_GEOCODE_OK["display_name"]
    assert payload["error_key"] is None
    assert payload["params"] == {}
    assert payload["warning_key"].startswith("The geocoder found the street")
    assert payload["message"] == payload["warning_key"]

    spanish = client.post(
        "/geocode", json={"address": "Av. Siempre Viva 742, Santiago"}
    ).json()
    assert spanish["warning_key"] == payload["warning_key"]
    assert spanish["message"] != payload["message"]
    assert spanish["message"].startswith("El geocodificador")


def test_geocode_exact_address_has_no_warning(client, monkeypatch):
    monkeypatch.setattr(
        api,
        "geocode_chilean_address",
        lambda address: {**FAKE_GEOCODE_OK, "precision": "address"},
    )
    payload = client.post("/geocode", json={"address": "somewhere"}).json()

    assert payload["ok"] is True
    assert payload["warning_key"] is None
    assert payload["message"] == ""


def test_geocode_error_is_translated(client, monkeypatch):
    monkeypatch.setattr(
        api, "geocode_chilean_address", lambda address: dict(FAKE_GEOCODE_ERROR)
    )

    english = client.post(
        "/geocode", params={"lang": "en"}, json={"address": "nowhere"}
    ).json()
    spanish = client.post("/geocode", json={"address": "nowhere"}).json()

    # A geocoding failure is a 200 with ok=false, not an HTTP error: the
    # address itself was well-formed.
    assert english["ok"] is False
    assert english["lat"] is None and english["lon"] is None
    assert english["error_key"] == FAKE_GEOCODE_ERROR["error_key"]
    assert english["message"] == FAKE_GEOCODE_ERROR["error_key"]
    assert spanish["message"] != english["message"]


def test_geocode_error_params_are_returned(client, monkeypatch):
    monkeypatch.setattr(
        api,
        "geocode_chilean_address",
        lambda address: {
            "ok": False,
            "address": address,
            "error_key": "Geocoding service returned status {status}.",
            "error_kwargs": {"status": 503},
        },
    )
    payload = client.post(
        "/geocode", params={"lang": "en"}, json={"address": "x"}
    ).json()

    assert payload["params"] == {"status": 503}
    assert payload["message"] == "Geocoding service returned status 503."


def test_geocode_rate_limit(client, monkeypatch):
    monkeypatch.setattr(
        api, "geocode_chilean_address", lambda address: dict(FAKE_GEOCODE_OK)
    )

    for _ in range(api.GEOCODE_RATE_LIMIT_REQUESTS):
        assert client.post("/geocode", json={"address": "x"}).status_code == 200

    blocked = client.post("/geocode", params={"lang": "en"}, json={"address": "x"})
    assert blocked.status_code == 429
    body = blocked.json()
    assert set(body) == {"error_key", "message", "params"}
    assert body["error_key"] == "rate_limited"
    assert body["params"] == {
        "limit": api.GEOCODE_RATE_LIMIT_REQUESTS,
        "window_seconds": int(api.GEOCODE_RATE_LIMIT_WINDOW_SECONDS),
    }

    api._GEOCODE_RATE_LIMITER.reset()
    assert client.post("/geocode", json={"address": "x"}).status_code == 200


def _spend_geocode_budget(client, headers=None):
    """Use up one bucket's budget and return the response that goes over it."""
    for _ in range(api.GEOCODE_RATE_LIMIT_REQUESTS):
        response = client.post("/geocode", json={"address": "x"}, headers=headers)
        assert response.status_code == 200, response.text
    return client.post("/geocode", json={"address": "x"}, headers=headers)


def test_geocode_rate_limit_buckets_by_forwarded_client(client, monkeypatch):
    """Behind the Next.js proxy the budget is per browser, not per proxy.

    ``request.client.host`` is the proxy for every request, so without
    X-Forwarded-For one family would exhaust the limit for all of them.
    """
    monkeypatch.setattr(
        api, "geocode_chilean_address", lambda address: dict(FAKE_GEOCODE_OK)
    )
    # TestClient's peer is "testclient"; treat it as the trusted proxy.
    monkeypatch.setattr(api, "TRUSTED_PROXY_HOSTS", frozenset({"testclient"}))

    blocked = _spend_geocode_budget(client, {"x-forwarded-for": "203.0.113.7"})
    assert blocked.status_code == 429

    # A different browser behind the same proxy still has its full budget.
    other = client.post(
        "/geocode", json={"address": "x"}, headers={"x-forwarded-for": "203.0.113.8"}
    )
    assert other.status_code == 200

    # ...and the first one is still blocked.
    assert (
        client.post(
            "/geocode",
            json={"address": "x"},
            headers={"x-forwarded-for": "203.0.113.7"},
        ).status_code
        == 429
    )


def test_geocode_rate_limit_uses_the_rightmost_forwarded_entry(client, monkeypatch):
    """The trusted hop appends the address it saw; earlier entries are claims."""
    monkeypatch.setattr(
        api, "geocode_chilean_address", lambda address: dict(FAKE_GEOCODE_OK)
    )
    monkeypatch.setattr(api, "TRUSTED_PROXY_HOSTS", frozenset({"testclient"}))

    blocked = _spend_geocode_budget(
        client, {"x-forwarded-for": "198.51.100.1, 203.0.113.7"}
    )
    assert blocked.status_code == 429

    # Rewriting only the leftmost (client-supplied) entry buys nothing: the
    # rightmost entry is what identifies the caller.
    for spoofed in ("198.51.100.99", "203.0.113.8"):
        assert (
            client.post(
                "/geocode",
                json={"address": "x"},
                headers={"x-forwarded-for": f"{spoofed}, 203.0.113.7"},
            ).status_code
            == 429
        )


def test_geocode_rate_limit_ignores_forwarded_header_from_untrusted_peer(
    client, monkeypatch
):
    """A direct caller cannot mint a fresh budget by inventing the header."""
    monkeypatch.setattr(
        api, "geocode_chilean_address", lambda address: dict(FAKE_GEOCODE_OK)
    )
    # "testclient" is not a trusted proxy here — the default loopback set.
    monkeypatch.setattr(api, "TRUSTED_PROXY_HOSTS", api._parse_trusted_proxies(None))

    blocked = _spend_geocode_budget(client, {"x-forwarded-for": "203.0.113.7"})
    assert blocked.status_code == 429

    # Same socket peer, a new claimed address: still the same bucket.
    assert (
        client.post(
            "/geocode",
            json={"address": "x"},
            headers={"x-forwarded-for": "203.0.113.8"},
        ).status_code
        == 429
    )
    # And with no header at all.
    assert client.post("/geocode", json={"address": "x"}).status_code == 429


def test_trusted_proxies_default_and_env_parsing():
    assert api._parse_trusted_proxies(None) == frozenset({"127.0.0.1", "::1"})
    assert api._parse_trusted_proxies("   ") == frozenset({"127.0.0.1", "::1"})
    assert api._parse_trusted_proxies("10.0.0.1, 10.0.0.2 ,") == frozenset(
        {"10.0.0.1", "10.0.0.2"}
    )
    # Hosts are matched case-insensitively (IPv6 hex, hostnames).
    assert api._parse_trusted_proxies("::FFFF:127.0.0.1") == frozenset(
        {"::ffff:127.0.0.1"}
    )


# ---------------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------------

def _cors_probe(app: FastAPI) -> httpx.Response:
    """GET /health with an Origin, without running the lifespan.

    ``/health`` needs no calibration data, and a second lifespan would clear
    the module-level ``api.STATE`` the module-scoped ``client`` fixture is
    still using — so this deliberately does not enter the TestClient as a
    context manager.
    """
    return TestClient(app).get(
        "/health", headers={"origin": "https://sae.example.cl"}
    )


def test_no_cors_headers_by_default(client):
    """The Next.js proxy makes every browser call same-origin.

    With SAE_CORS_ORIGINS unset the middleware is not installed at all, so no
    response ever carries an Access-Control-Allow-Origin a foreign page could
    use to read a family's simulation.
    """
    assert api.cors_origins("") == []
    response = client.get("/health", headers={"origin": "https://evil.example"})
    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers

    # And the same for the app as it is actually built from the environment.
    assert _cors_probe(api.create_app()).headers.get(
        "access-control-allow-origin"
    ) is None


def test_cors_allows_only_the_configured_origins(monkeypatch):
    monkeypatch.setenv("SAE_CORS_ORIGINS", "https://sae.example.cl, https://b.example")
    assert api.cors_origins() == ["https://sae.example.cl", "https://b.example"]

    app = api.create_app()
    allowed = _cors_probe(app)
    assert allowed.status_code == 200
    assert allowed.headers["access-control-allow-origin"] == "https://sae.example.cl"

    denied = TestClient(app).get("/health", headers={"origin": "https://evil.example"})
    assert "access-control-allow-origin" not in denied.headers


def test_cors_origins_parsing(monkeypatch):
    monkeypatch.delenv("SAE_CORS_ORIGINS", raising=False)
    assert api.cors_origins() == []  # unset environment
    assert api.cors_origins("") == []
    assert api.cors_origins("   ") == []
    assert api.cors_origins(",  ,") == []
    assert api.cors_origins("https://a.example") == ["https://a.example"]
    assert api.cors_origins(" https://a.example , https://b.example ,") == [
        "https://a.example",
        "https://b.example",
    ]


# ---------------------------------------------------------------------------
# Access logging
# ---------------------------------------------------------------------------

@contextmanager
def _live_uvicorn_server(app):
    """Serve ``app`` on an ephemeral port with uvicorn's own access logging.

    TestClient bypasses the HTTP protocol layer, so it never writes an access
    line — the very thing under test. ``log_config=None`` leaves logging
    unconfigured, so ``uvicorn.access`` records propagate to the root logger
    where ``caplog`` can see them.

    The lifespan of this second server shares (and on shutdown clears) the
    module-level ``api.STATE``, so it is snapshotted and handed back.
    """
    saved_state = dict(api.STATE)
    # uvicorn only emits access lines when the logger has a handler; pytest's
    # capture handler sits on the root logger, but make it explicit so the test
    # does not depend on that.
    access_logger = logging.getLogger("uvicorn.access")
    guard = logging.NullHandler()
    access_logger.addHandler(guard)

    config = uvicorn.Config(
        app,
        host="127.0.0.1",
        port=0,
        log_config=None,
        access_log=True,
        lifespan="on",
    )
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    try:
        deadline = time.monotonic() + 60
        while not server.started:
            assert thread.is_alive(), "uvicorn died during startup"
            assert time.monotonic() < deadline, "uvicorn did not start in time"
            time.sleep(0.05)
        port = server.servers[0].sockets[0].getsockname()[1]
        yield f"http://127.0.0.1:{port}"
    finally:
        server.should_exit = True
        thread.join(timeout=60)
        access_logger.removeHandler(guard)
        api.STATE.clear()
        api.STATE.update(saved_state)
        api._GEOCODE_RATE_LIMITER.reset()


def test_access_log_never_carries_the_student_identifier(caplog):
    """The RUN reaches no log, uvicorn's access log included.

    Uvicorn logs ``client - "METHOD path HTTP/1.1" status`` — method, path and
    query string only. The RUN only ever travels in a POST body, so this holds
    as long as no endpoint moves an identifier into the URL.
    """
    fixture = STRICT_FIXTURES[0]
    run = fixture["inputs"]["student_id"]
    body = {
        "student_id": run,
        "wishes": _wire_wishes(fixture, explicit_groups=False),
    }
    digits = "".join(ch for ch in run if ch.isdigit())
    assert len(digits) >= 7, "fixture RUN is too short to make this test meaningful"

    with caplog.at_level(logging.DEBUG):
        with _live_uvicorn_server(api.app) as base_url:
            response = httpx.post(f"{base_url}/simulate?lang=es", json=body, timeout=120)

    assert response.status_code == 200, response.text

    access_lines = [
        record.getMessage()
        for record in caplog.records
        if record.name == "uvicorn.access"
    ]
    assert access_lines, "uvicorn wrote no access log record"
    assert any('"POST /simulate?lang=es HTTP/1.1" 200' in line for line in access_lines)

    # Neither the identifier nor any bare digit run of it appears anywhere in
    # what was logged — by uvicorn or by anything else in the process.
    for line in access_lines:
        assert run not in line
        assert digits not in line
    assert run not in caplog.text
    assert digits not in caplog.text


# ---------------------------------------------------------------------------
# OpenAPI export
# ---------------------------------------------------------------------------

def test_openapi_export_matches_committed_schema():
    """web/lib/api/openapi.json is a build artifact, kept in sync by the script."""
    import scripts.export_openapi as export_openapi

    committed = export_openapi.OUTPUT_PATH
    assert committed.exists(), (
        f"{committed} is missing — run .venv/bin/python scripts/export_openapi.py"
    )
    assert committed.read_text(encoding="utf-8") == export_openapi.render_schema(), (
        "openapi.json is stale — run .venv/bin/python scripts/export_openapi.py"
    )
