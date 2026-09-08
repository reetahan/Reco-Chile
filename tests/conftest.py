"""Shared pytest fixtures for the engine golden tests.

The calibration data is large and identical for every test, so it is loaded once
per session.
"""

from __future__ import annotations

import sys
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
REPO_ROOT = TESTS_DIR.parent
for _path in (str(REPO_ROOT), str(TESTS_DIR)):
    if _path not in sys.path:
        sys.path.insert(0, _path)

import pandas as pd  # noqa: E402
import pytest  # noqa: E402


from sae_app.constants import CAPACITIES_PATH  # noqa: E402
from sae_app.data_loading import load_calibration  # noqa: E402
from sae_app.program_options import build_program_mapping  # noqa: E402

from golden_runner import GOLDEN_DIR, build_id_maps  # noqa: E402


@pytest.fixture(scope="session")
def calib() -> pd.DataFrame:
    """The merged calibration frame, loaded exactly as ``api.py`` loads it."""
    return load_calibration(CAPACITIES_PATH.read_bytes())


@pytest.fixture(scope="session")
def program_mapping(calib: pd.DataFrame) -> dict[str, pd.Series]:
    """Ordered ``display_label -> program row`` mapping (the wish-list join key)."""
    return build_program_mapping(calib)


@pytest.fixture(scope="session")
def id_maps(program_mapping: dict[str, pd.Series]) -> tuple[dict, dict]:
    """``(id_to_label, label_to_id)`` using ``program_id = f"{rbd}:{program_code}"``."""
    return build_id_maps(program_mapping)


@pytest.fixture(scope="session")
def golden_dir() -> Path:
    """Directory holding the committed golden fixtures."""
    return GOLDEN_DIR
