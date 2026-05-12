#!/usr/bin/env python3
"""Create or refresh lib/db/customdev.db from lib/db/schema.sql."""

from __future__ import annotations

import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SCHEMA = ROOT / "schema.sql"
DB_PATH = ROOT / "customdev.db"


PAGE_NAMES = (
    "index",
    "gallery",
    "contact",
    "farewell-mr-fuji",
    "mobile-view-index",
)


def _seed(con: sqlite3.Connection) -> None:
    for name in PAGE_NAMES:
        con.execute(
            "INSERT INTO page (name, header, footer) VALUES (?, 1, 1)",
            (name,),
        )
    for name in PAGE_NAMES:
        con.execute(
            """
            INSERT INTO gallery (
              page_id, gallery_key, thumbnail, zoom, zoom_style,
              column_count, row_count, gallery_style, thumbnail_style
            )
            SELECT id, 'default', 1, 1, '', 2, 1, '', '' FROM page WHERE name = ?
            """,
            (name,),
        )
    con.commit()


def main() -> None:
    sql = SCHEMA.read_text(encoding="utf-8")
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    if DB_PATH.exists():
        DB_PATH.unlink()
    con = sqlite3.connect(DB_PATH)
    try:
        con.executescript(sql)
        con.commit()
        _seed(con)
    finally:
        con.close()
    print(f"Wrote {DB_PATH}")


if __name__ == "__main__":
    main()
