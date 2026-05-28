#!/usr/bin/env python3
"""
Bootstrap lib/db/customdev.db from committed data/layout/ (local dev / staging only).

Run: npm run setup:layout

Git deploy truth: data/layout/*.json — not customdev.db.
"""

from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SCHEMA = REPO_ROOT / "lib" / "db" / "schema.sql"
DB_PATH = Path(os.environ.get("CUSTOMDEV_DB", str(REPO_ROOT / "lib" / "db" / "customdev.db")))
LAYOUT_DIR = REPO_ROOT / "data" / "layout"


def _create_db_from_schema() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(str(DB_PATH))
    try:
        con.executescript(SCHEMA.read_text(encoding="utf-8"))
        con.commit()
    finally:
        con.close()


def main() -> int:
    if not LAYOUT_DIR.is_dir():
        print(f"Missing layout dir: {LAYOUT_DIR}", file=sys.stderr)
        return 1

    created = False
    if not DB_PATH.is_file():
        _create_db_from_schema()
        created = True
        print(f"Created {DB_PATH} from schema.sql")

    migrate = REPO_ROOT / "lib" / "db" / "migrate_schema.py"
    proc = subprocess.run(
        [sys.executable, str(migrate), str(DB_PATH)],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        print(proc.stderr or proc.stdout or "migrate_schema failed", file=sys.stderr)
        return 1

    sys.path.insert(0, str(REPO_ROOT / "lib" / "db"))
    from import_layout_from_baked import import_all_layout  # noqa: E402

    try:
        summary = import_all_layout(LAYOUT_DIR)
    except (OSError, ValueError) as e:
        print(f"setup:layout import failed: {e}", file=sys.stderr)
        return 1

    print(
        f"OK setup:layout — "
        f"{'new DB; ' if created else ''}"
        f"imported {len(summary['frames'])} frame(s), {len(summary['galleries'])} gallery layout(s)",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
