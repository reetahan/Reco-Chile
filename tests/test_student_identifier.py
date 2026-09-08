"""RUN/IPE normalization: the five golden cases plus the awkward edges.

``normalize_student_identifier`` is the gate in front of the MTB hash, so its
accept/reject behaviour is part of the frozen baseline. The five fixture cases
are re-checked here directly (not only through ``test_engine_golden``), and the
extra cases below cover input shapes families really type: a ``K`` check digit,
stray whitespace, and a lowercase ``k`` — plus the non-ASCII digit forms
that must be refused so the client-side mirror in
``web/lib/validation/student-id.ts`` cannot disagree with the engine.

Privacy note: every identifier in this file is synthetic. Only the normalized
string is asserted; the SHA-256 hash input never leaves ``mtb_engine``.
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

from sae_app.errors import InvalidStudentIdentifier  # noqa: E402
from sae_app.mtb_engine import (  # noqa: E402
    _run_check_digit,
    normalize_ipe,
    normalize_run,
    normalize_student_identifier,
)

from golden_runner import GOLDEN_DIR, identifier_expectation  # noqa: E402

IDENTIFIER_FIXTURES = sorted(GOLDEN_DIR.glob("identifier_*.json"))


@pytest.mark.parametrize(
    "fixture_path", IDENTIFIER_FIXTURES, ids=[path.stem for path in IDENTIFIER_FIXTURES]
)
def test_identifier_fixture_reproduces(fixture_path: Path) -> None:
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    assert identifier_expectation(fixture["inputs"]["raw_identifier"]) == fixture["expected"]


def test_five_identifier_cases_are_present() -> None:
    assert len(IDENTIFIER_FIXTURES) == 5


# ---------------------------------------------------------------------------
# Extra edge cases beyond the fixtures
# ---------------------------------------------------------------------------

def test_check_digit_k_is_accepted_uppercase() -> None:
    body = "9"
    while _run_check_digit(body) != "K":
        body = str(int(body) + 1)
    assert normalize_student_identifier(f"{body}-K") == f"{int(body)}-K"


def test_check_digit_k_is_accepted_lowercase() -> None:
    body = "9"
    while _run_check_digit(body) != "K":
        body = str(int(body) + 1)
    assert normalize_student_identifier(f"{body}-k") == f"{int(body)}-K"


def test_surrounding_and_inner_whitespace_is_ignored() -> None:
    expected = f"12345678-{_run_check_digit('12345678')}"
    assert normalize_student_identifier(f"  12.345.678 - {_run_check_digit('12345678')} ") == expected
    assert normalize_student_identifier(f"\t12345678{_run_check_digit('12345678')}\n") == expected


def test_hyphen_is_optional() -> None:
    check_digit = _run_check_digit("12345678")
    assert normalize_run(f"12345678{check_digit}") == f"12345678-{check_digit}"


def test_leading_zeros_are_dropped_from_the_body() -> None:
    check_digit = _run_check_digit("1234567")
    assert normalize_run(f"01234567-{check_digit}") == f"1234567-{check_digit}"


def test_empty_identifier_is_rejected() -> None:
    with pytest.raises(InvalidStudentIdentifier):
        normalize_student_identifier("   ")


def test_all_zero_body_is_rejected() -> None:
    with pytest.raises(InvalidStudentIdentifier):
        normalize_student_identifier(f"0-{_run_check_digit('0')}")


def test_ten_digit_input_is_parsed_as_an_ipe() -> None:
    """Ten compact digits route to the IPE parser, not the RUN parser."""
    assert normalize_student_identifier("100200300-4") == "100200300-4"
    assert normalize_student_identifier("1002003004") == "100200300-4"
    assert normalize_ipe("100.200.300-4") == "100200300-4"


def test_ipe_with_a_letter_verifier_is_rejected() -> None:
    with pytest.raises(InvalidStudentIdentifier):
        normalize_student_identifier("100200300-K")


def test_wrong_check_digit_reports_the_check_digit_message() -> None:
    wrong = "0" if _run_check_digit("12345678") != "0" else "1"
    with pytest.raises(InvalidStudentIdentifier) as excinfo:
        normalize_student_identifier(f"12345678-{wrong}")
    assert excinfo.value.message_key == "The RUN check digit is invalid."


def test_garbage_reports_the_format_message() -> None:
    with pytest.raises(InvalidStudentIdentifier) as excinfo:
        normalize_student_identifier("not-an-identifier")
    assert excinfo.value.message_key.startswith("Invalid RUN format.")


# ---------------------------------------------------------------------------
# ASCII-only digits (parity with the TypeScript mirror)
# ---------------------------------------------------------------------------

def test_non_ascii_digits_are_rejected() -> None:
    """``\\d`` used to accept Arabic-Indic digits; ``[0-9]`` does not.

    ``٤٥٦-1`` is the sharp case: Python's ``\\d`` matched the body, ``int()``
    parsed it as 456, and the modulo-11 verifier of 456 really is ``1`` — so the
    engine accepted it and normalized it to ``456-1``, while the client-side
    mirror in ``web/lib/validation/student-id.ts`` (JavaScript ``\\d`` is
    ASCII-only) rejected it as a format error. The two must agree.
    """
    with pytest.raises(InvalidStudentIdentifier) as excinfo:
        normalize_student_identifier("٤٥٦-1")
    assert excinfo.value.message_key.startswith("Invalid RUN format.")

    with pytest.raises(InvalidStudentIdentifier):
        normalize_run("٤٥٦-1")


def test_fullwidth_digits_are_rejected() -> None:
    """Fullwidth forms are the other family Python's ``\\d`` used to admit."""
    with pytest.raises(InvalidStudentIdentifier):
        normalize_student_identifier("１２３４５６７８-5")


def test_non_ascii_digits_are_rejected_for_an_ipe() -> None:
    """Ten compact characters still route to the IPE parser, which also refuses."""
    with pytest.raises(InvalidStudentIdentifier) as excinfo:
        normalize_student_identifier("١٠٠٢٠٠٣٠٠-4")
    assert excinfo.value.message_key.startswith("Invalid IPE format.")

    with pytest.raises(InvalidStudentIdentifier):
        normalize_ipe("100200300-٤")
