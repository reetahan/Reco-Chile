"""Wish-list normalization, equivalence counting, and strict-order preparation.

These are the pure functions the whole equivalence-class pipeline rests on
(CONTRIBUTING.md, "Equivalence-class pipeline"), so they are tested directly rather
than only through the golden fixtures. Real program labels are used, because the
display label is the join key into the program mapping.
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

import pandas as pd  # noqa: E402
import pytest  # noqa: E402

from sae_app.constants import EQUIV_GROUP, LOTTERY, PRIORITIES, PROGRAM, SAFETY, WISH_RANK  # noqa: E402
from sae_app.wish_list import (  # noqa: E402
    clean_wish_rows,
    count_equivalence_orders,
    iter_equivalence_orders,
    make_builder_wish_row,
    non_empty_wish_rows,
    normalize_builder_wishes,
    prepare_ordered_wishes,
)


@pytest.fixture(scope="module")
def labels(program_mapping) -> list[str]:
    """A handful of real program labels, in mapping order."""
    return list(program_mapping)[:8]


def builder_frame(rows: list[tuple[str, int]]) -> pd.DataFrame:
    """Build a raw builder frame from ``(program_label, preference_group)`` pairs."""
    return pd.DataFrame([
        make_builder_wish_row(label, position, group)
        for position, (label, group) in enumerate(rows, start=1)
    ])


# ---------------------------------------------------------------------------
# normalize_builder_wishes
# ---------------------------------------------------------------------------

def test_normalize_builder_wishes_compacts_group_numbers(labels) -> None:
    """1, 1, 5 must behave like 1, 1, 2 for downstream weighting."""
    frame = builder_frame([(labels[0], 1), (labels[1], 1), (labels[2], 5)])

    out = non_empty_wish_rows(normalize_builder_wishes(frame, use_equivalence_classes=True))

    assert out[EQUIV_GROUP].tolist() == [1, 1, 2]
    assert out[WISH_RANK].tolist() == [1, 2, 3]
    assert out[PROGRAM].tolist() == [labels[0], labels[1], labels[2]]


def test_normalize_builder_wishes_orders_by_group_then_card_order(labels) -> None:
    frame = builder_frame([(labels[0], 3), (labels[1], 1), (labels[2], 3), (labels[3], 1)])

    out = non_empty_wish_rows(normalize_builder_wishes(frame, use_equivalence_classes=True))

    assert out[PROGRAM].tolist() == [labels[1], labels[3], labels[0], labels[2]]
    assert out[EQUIV_GROUP].tolist() == [1, 1, 2, 2]
    assert out[WISH_RANK].tolist() == [1, 2, 3, 4]


def test_normalize_builder_wishes_strict_mode_ignores_group_numbers(labels) -> None:
    """In strict mode the card order is the ranking and groups mirror it."""
    frame = builder_frame([(labels[0], 7), (labels[1], 7), (labels[2], 2)])

    out = non_empty_wish_rows(normalize_builder_wishes(frame, use_equivalence_classes=False))

    assert out[PROGRAM].tolist() == [labels[0], labels[1], labels[2]]
    assert out[WISH_RANK].tolist() == [1, 2, 3]
    assert out[EQUIV_GROUP].tolist() == [1, 2, 3]


def test_normalize_builder_wishes_drops_duplicates_and_blanks(labels) -> None:
    frame = builder_frame([(labels[0], 1), (labels[0], 2), ("", 3), (labels[1], 4)])

    out = non_empty_wish_rows(normalize_builder_wishes(frame, use_equivalence_classes=False))

    assert out[PROGRAM].tolist() == [labels[0], labels[1]]


def test_clean_wish_rows_pads_to_three_rows(labels) -> None:
    out = clean_wish_rows(builder_frame([(labels[0], 1)]))

    assert len(out) == 3
    assert out[PROGRAM].tolist() == [labels[0], "", ""]
    assert out[LOTTERY].tolist() == [1, 1, 1]
    for column in list(PRIORITIES) + [SAFETY]:
        assert out[column].tolist() == [False, False, False]


# ---------------------------------------------------------------------------
# count_equivalence_orders
# ---------------------------------------------------------------------------

GROUP_PATTERNS = [
    [1],
    [1, 2, 3],
    [1, 1, 2],
    [1, 1, 1, 2],
    [1, 1, 1, 2, 2, 2],
    [1, 1, 1, 1, 2],
    [1, 1, 2, 2, 3, 3],
    [1] * 8,
]


@pytest.mark.parametrize("groups", GROUP_PATTERNS, ids=[str(g) for g in GROUP_PATTERNS])
def test_count_equivalence_orders_is_the_product_of_group_factorials(groups, labels) -> None:
    frame = builder_frame([(labels[index], group) for index, group in enumerate(groups)])

    sizes: dict[int, int] = {}
    for group in groups:
        sizes[group] = sizes.get(group, 0) + 1
    expected = math.prod(math.factorial(size) for size in sizes.values())

    assert count_equivalence_orders(frame) == expected


def test_count_equivalence_orders_ignores_gaps_in_group_numbers(labels) -> None:
    """Compaction means 1, 1, 5 and 1, 1, 2 generate the same orders."""
    gapped = builder_frame([(labels[0], 1), (labels[1], 1), (labels[2], 5)])
    compact = builder_frame([(labels[0], 1), (labels[1], 1), (labels[2], 2)])

    assert count_equivalence_orders(gapped) == count_equivalence_orders(compact) == 2


def test_count_equivalence_orders_of_an_empty_list_is_zero() -> None:
    assert count_equivalence_orders(builder_frame([])) == 0


def test_iter_equivalence_orders_yields_exactly_the_counted_orders(labels) -> None:
    frame = builder_frame([
        (labels[0], 1),
        (labels[1], 1),
        (labels[2], 1),
        (labels[3], 2),
        (labels[4], 2),
    ])

    orders = list(iter_equivalence_orders(frame))
    program_orders = [tuple(order[PROGRAM].tolist()) for order in orders]

    assert len(orders) == count_equivalence_orders(frame) == math.factorial(3) * math.factorial(2)
    assert len(set(program_orders)) == len(program_orders)
    for order in orders:
        assert order[WISH_RANK].tolist() == [1, 2, 3, 4, 5]
        # The fixed tail never moves into the tied group's positions.
        assert set(order[PROGRAM].tolist()[:3]) == set(labels[:3])


# ---------------------------------------------------------------------------
# prepare_ordered_wishes
# ---------------------------------------------------------------------------

def test_prepare_ordered_wishes_strict_uses_wish_rank_and_singleton_groups(labels) -> None:
    frame = builder_frame([(labels[0], 2), (labels[1], 1), (labels[2], 1)])

    out = prepare_ordered_wishes(frame, use_equivalence_classes=False)

    assert out[PROGRAM].tolist() == [labels[0], labels[1], labels[2]]
    assert out[WISH_RANK].tolist() == [1, 2, 3]
    assert out[EQUIV_GROUP].tolist() == [1, 2, 3]


def test_prepare_ordered_wishes_equivalence_sorts_by_group_and_compacts(labels) -> None:
    frame = builder_frame([(labels[0], 2), (labels[1], 1), (labels[2], 9)])

    out = prepare_ordered_wishes(frame, use_equivalence_classes=True)

    assert out[PROGRAM].tolist() == [labels[1], labels[0], labels[2]]
    assert out[WISH_RANK].tolist() == [1, 2, 3]
    assert out[EQUIV_GROUP].tolist() == [1, 2, 3]


def test_prepare_ordered_wishes_keeps_row_order_inside_a_tied_group(labels) -> None:
    frame = builder_frame([(labels[0], 1), (labels[1], 1), (labels[2], 1)])

    out = prepare_ordered_wishes(frame, use_equivalence_classes=True)

    assert out[PROGRAM].tolist() == labels[:3]
    assert out[EQUIV_GROUP].tolist() == [1, 1, 1]


def test_prepare_ordered_wishes_drops_empty_rows(labels) -> None:
    frame = builder_frame([(labels[0], 1), ("", 2), (labels[1], 3)])

    out = prepare_ordered_wishes(frame, use_equivalence_classes=False)

    assert out[PROGRAM].tolist() == [labels[0], labels[1]]


def test_prepare_ordered_wishes_of_an_empty_list_is_empty() -> None:
    assert prepare_ordered_wishes(builder_frame([]), use_equivalence_classes=True).empty
