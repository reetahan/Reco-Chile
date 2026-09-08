#!/usr/bin/env python
"""Export the FastAPI schema to web/lib/api/openapi.json.

The committed schema is the contract the TypeScript client is generated from
: ``openapi-typescript`` reads this file, so regenerating it
is a build step, never a manual edit. ``tests/test_api_contract.py`` fails when
the committed file drifts from what ``api.app`` actually serves.

Run with:

    .venv/bin/python scripts/export_openapi.py

Keys are sorted and the file ends with a newline so an unchanged API produces a
byte-identical file and ``git status`` stays clean.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from api import app  # noqa: E402

OUTPUT_PATH = REPO_ROOT / "web" / "lib" / "api" / "openapi.json"


def render_schema() -> str:
    """Return the schema exactly as it is written to disk."""
    return json.dumps(app.openapi(), indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def export(output_path: Path = OUTPUT_PATH) -> Path:
    """Write the schema, creating web/lib/api/ on the way."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(render_schema(), encoding="utf-8")
    return output_path


if __name__ == "__main__":
    written = export()
    print(f"Wrote {written.relative_to(REPO_ROOT)}")
