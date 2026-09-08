"""Reproduce every committed golden fixture with the current engine.

They freeze the engine's numerical output so any refactor of the engine, and
the API on top of it, can be proven to compute exactly the same thing.

Comparison rules:

* floats  — absolute tolerance 1e-12
* ints, bools, strings, ``null`` — exact
* structure (keys, list lengths, ordering) — exact

Fixtures are regenerated with ``.venv/bin/python tests/generate_golden.py``;
see ``tests/fixtures/golden/README.md`` before doing that.
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

import pytest  # noqa: E402

from sae_app.constants import MAX_EXACT_EQUIV_PERMUTATIONS  # noqa: E402
from sae_app.wish_list import count_equivalence_orders, prepare_ordered_wishes  # noqa: E402

from golden_runner import (  # noqa: E402
    GOLDEN_DIR,
    build_edited_wishes,
    identifier_expectation,
    run_equivalence_simulation,
    run_recommendations,
    run_strict_simulation,
    to_jsonable,
    wish_specs_from_fixture,
)

FLOAT_TOLERANCE = 1e-12

# Files starting with "_" are provenance metadata, not scenarios.
FIXTURE_PATHS = sorted(
    path for path in GOLDEN_DIR.glob("*.json") if not path.name.startswith("_")
)
FIXTURE_IDS = [path.stem for path in FIXTURE_PATHS]

EXPECTED_SCENARIO_COUNTS = {
    "strict": 6,
    "equivalence": 4,
    "recommendation": 3,
    "identifier": 5,
}


def load_fixture(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def assert_values_match(expected, actual, path: str) -> None:
    """Compare a recomputed value against a stored one, element by element."""
    if expected is None:
        assert actual is None, f"{path}: expected null, got {actual!r}"
        return

    if isinstance(expected, bool):
        assert isinstance(actual, bool), f"{path}: expected a bool, got {type(actual).__name__}"
        assert actual == expected, f"{path}: expected {expected}, got {actual}"
        return

    if isinstance(expected, int):
        assert isinstance(actual, int) and not isinstance(actual, bool), (
            f"{path}: expected an int, got {type(actual).__name__} ({actual!r})"
        )
        assert actual == expected, f"{path}: expected {expected}, got {actual}"
        return

    if isinstance(expected, float):
        assert isinstance(actual, (int, float)) and not isinstance(actual, bool), (
            f"{path}: expected a number, got {type(actual).__name__} ({actual!r})"
        )
        assert abs(float(actual) - expected) <= FLOAT_TOLERANCE, (
            f"{path}: expected {expected!r}, got {actual!r} "
            f"(difference {abs(float(actual) - expected):.3e} > {FLOAT_TOLERANCE:g})"
        )
        return

    if isinstance(expected, str):
        assert actual == expected, f"{path}: expected {expected!r}, got {actual!r}"
        return

    if isinstance(expected, list):
        assert isinstance(actual, list), f"{path}: expected a list, got {type(actual).__name__}"
        assert len(actual) == len(expected), (
            f"{path}: expected {len(expected)} item(s), got {len(actual)}"
        )
        for index, (expected_item, actual_item) in enumerate(zip(expected, actual)):
            assert_values_match(expected_item, actual_item, f"{path}[{index}]")
        return

    if isinstance(expected, dict):
        assert isinstance(actual, dict), f"{path}: expected a mapping, got {type(actual).__name__}"
        assert sorted(actual) == sorted(expected), (
            f"{path}: key mismatch. "
            f"Missing: {sorted(set(expected) - set(actual))}; "
            f"unexpected: {sorted(set(actual) - set(expected))}"
        )
        for key in expected:
            assert_values_match(expected[key], actual[key], f"{path}.{key}")
        return

    raise AssertionError(f"{path}: unsupported fixture value type {type(expected).__name__}")


def recompute(fixture: dict, program_mapping, label_to_id) -> dict:
    """Rerun the engine for one fixture and return JSON-comparable output."""
    kind = fixture["kind"]
    inputs = fixture["inputs"]

    if kind == "identifier":
        return to_jsonable(identifier_expectation(inputs["raw_identifier"]))

    for wish in inputs["wishes"]:
        assert wish["program_label"] in program_mapping, (
            f"Program {wish['program_label']!r} ({wish['program_id']}) is no longer "
            "in the calibration data; the golden fixtures are stale."
        )

    use_equivalence_classes = bool(inputs["use_equivalence_classes"])
    edited = build_edited_wishes(wish_specs_from_fixture(inputs), use_equivalence_classes)

    if kind == "strict":
        result = run_strict_simulation(edited, program_mapping, inputs["student_id"], label_to_id)
    elif kind == "equivalence":
        result = run_equivalence_simulation(
            edited, program_mapping, inputs["student_id"], label_to_id
        )
    elif kind == "recommendation":
        result = run_recommendations(
            edited,
            program_mapping,
            inputs["student_id"],
            label_to_id,
            max_recommendations=inputs["max_recommendations"],
            home_geo_reference=inputs["home_geo_reference"],
        )
    else:
        raise AssertionError(f"Unknown fixture kind: {kind}")

    return to_jsonable(result)


def test_golden_fixtures_exist() -> None:
    assert FIXTURE_PATHS, (
        "No golden fixtures found. Run: .venv/bin/python tests/generate_golden.py"
    )


def test_scenario_inventory_is_complete() -> None:
    """A regeneration must not silently drop a scenario family."""
    counts: dict[str, int] = {}
    for path in FIXTURE_PATHS:
        kind = load_fixture(path)["kind"]
        counts[kind] = counts.get(kind, 0) + 1
    assert counts == EXPECTED_SCENARIO_COUNTS


@pytest.mark.parametrize("fixture_path", FIXTURE_PATHS, ids=FIXTURE_IDS)
def test_golden_fixture_reproduces(fixture_path: Path, program_mapping, id_maps) -> None:
    _id_to_label, label_to_id = id_maps
    fixture = load_fixture(fixture_path)
    actual = recompute(fixture, program_mapping, label_to_id)
    assert_values_match(fixture["expected"], actual, fixture["name"])


def test_over_cap_equivalence_scenario_is_rejected(program_mapping) -> None:
    """The over-cap list must still be refused, with the same order count."""
    over_cap_fixtures = [
        load_fixture(path)
        for path in FIXTURE_PATHS
        if load_fixture(path).get("expected", {}).get("rejected_over_cap")
    ]
    assert over_cap_fixtures, "No over-cap equivalence fixture found"

    for fixture in over_cap_fixtures:
        inputs = fixture["inputs"]
        edited = build_edited_wishes(wish_specs_from_fixture(inputs), True)
        reference_order = prepare_ordered_wishes(edited, use_equivalence_classes=True)
        total_orders = count_equivalence_orders(reference_order)

        assert total_orders == fixture["expected"]["total_orders"]
        assert total_orders > MAX_EXACT_EQUIV_PERMUTATIONS
        assert fixture["expected"]["variants"] == []
        assert fixture["expected"]["reference_choices"] is None
