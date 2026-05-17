#!/usr/bin/env python3
"""
Idempotent schema fixes for lib/db/customdev.db (add missing frame / frame_cell columns,
rebuild frame_cell when CHECK still allows only empty|html|image).

Run after pulling:  python3 lib/db/migrate_schema.py
"""

from __future__ import annotations

import re
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DB_PATH = Path(
    sys.argv[1] if len(sys.argv) > 1 else (Path(__file__).resolve().parent / "customdev.db"),
)


def _columns(con: sqlite3.Connection, table: str) -> set[str]:
    cur = con.execute(f"PRAGMA table_info({table})")
    return {str(r[1]) for r in cur.fetchall()}


def _add_column(con: sqlite3.Connection, table: str, name: str, decl: str) -> bool:
    cols = _columns(con, table)
    if name in cols:
        return False
    con.execute(f"ALTER TABLE {table} ADD COLUMN {name} {decl}")
    return True


def _frame_cell_create_sql(con: sqlite3.Connection) -> str:
    row = con.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='frame_cell'",
    ).fetchone()
    return str(row[0]) if row and row[0] else ""


def _needs_frame_cell_rebuild(sql: str) -> bool:
    """Rebuild when CHECK omits 'table' or 'text' (sqlite_master keeps original CREATE)."""
    if not sql:
        return False
    if re.search(r"IN\s*\(\s*'empty'\s*,\s*'html'\s*,\s*'image'\s*\)", sql):
        return True
    if "CHECK (content_type IN" in sql and "'text'" not in sql:
        return True
    return False


def migrate(con: sqlite3.Connection) -> list[str]:
    msgs: list[str] = []
    for name, decl in (
        ("label", "TEXT NOT NULL DEFAULT ''"),
        ("grid_gap", "TEXT NOT NULL DEFAULT ''"),
        ("notes", "TEXT NOT NULL DEFAULT ''"),
        ("default_text_font_family", "TEXT NOT NULL DEFAULT ''"),
        ("default_text_font_size", "INTEGER NOT NULL DEFAULT 16"),
    ):
        if _add_column(con, "frame", name, decl):
            msgs.append(f"frame: added column {name}")

    for name, decl in (
        ("css_class", "TEXT NOT NULL DEFAULT ''"),
        ("aria_label", "TEXT NOT NULL DEFAULT ''"),
        ("cell_role", "TEXT NOT NULL DEFAULT ''"),
        ("cell_padding", "TEXT NOT NULL DEFAULT ''"),
    ):
        if _add_column(con, "frame_cell", name, decl):
            msgs.append(f"frame_cell: added column {name}")

    sql = _frame_cell_create_sql(con)
    if sql and _needs_frame_cell_rebuild(sql):
        con.execute("PRAGMA foreign_keys=OFF")
        con.execute(
            """
            CREATE TABLE frame_cell__migrated (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              frame_id INTEGER NOT NULL REFERENCES frame (id) ON DELETE CASCADE,
              cell_index INTEGER NOT NULL CHECK (cell_index >= 0),
              content_type TEXT NOT NULL DEFAULT 'empty'
                CHECK (content_type IN ('empty', 'html', 'image', 'table', 'text')),
              body TEXT NOT NULL DEFAULT '',
              css_class TEXT NOT NULL DEFAULT '',
              aria_label TEXT NOT NULL DEFAULT '',
              cell_role TEXT NOT NULL DEFAULT '',
              UNIQUE (frame_id, cell_index)
            )
            """
        )
        con.execute(
            f"""
            INSERT INTO frame_cell__migrated
              (id, frame_id, cell_index, content_type, body, css_class, aria_label, cell_role)
            SELECT
              id, frame_id, cell_index, content_type, body,
              COALESCE(css_class, ''),
              COALESCE(aria_label, ''),
              COALESCE(cell_role, '')
            FROM frame_cell
            """
        )
        con.execute("DROP TABLE frame_cell")
        con.execute("ALTER TABLE frame_cell__migrated RENAME TO frame_cell")
        con.execute("CREATE INDEX IF NOT EXISTS idx_frame_cell_frame ON frame_cell (frame_id)")
        con.execute("PRAGMA foreign_keys=ON")
        msgs.append("frame_cell: rebuilt table (content_type CHECK now includes 'table')")

    if not con.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='frame_cell_text'",
    ).fetchone():
        con.execute(
            """
            CREATE TABLE frame_cell_text (
              frame_cell_id INTEGER PRIMARY KEY REFERENCES frame_cell (id) ON DELETE CASCADE,
              font_family TEXT NOT NULL DEFAULT '',
              font_size INTEGER NOT NULL DEFAULT 16 CHECK (font_size >= 8 AND font_size <= 288),
              line_height_pct INTEGER NOT NULL DEFAULT 100 CHECK (line_height_pct >= 50 AND line_height_pct <= 250),
              padding TEXT NOT NULL DEFAULT '',
              nav_url TEXT NOT NULL DEFAULT '',
              nav_label TEXT NOT NULL DEFAULT '',
              body_blocks TEXT NOT NULL DEFAULT ''
            )
            """
        )
        msgs.append("frame_cell_text: created table")

    if _add_column(con, "frame_cell_text", "line_height_pct", "INTEGER NOT NULL DEFAULT 100"):
        msgs.append("frame_cell_text: added column line_height_pct")

    if _add_column(con, "frame_cell_text", "body_blocks", "TEXT NOT NULL DEFAULT ''"):
        msgs.append("frame_cell_text: added column body_blocks")

    if _add_column(con, "frame_cell_text", "link_style", "TEXT NOT NULL DEFAULT ''"):
        msgs.append("frame_cell_text: added column link_style")

    if not con.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='frame_cell_image'",
    ).fetchone():
        con.execute(
            """
            CREATE TABLE frame_cell_image (
              frame_cell_id INTEGER PRIMARY KEY REFERENCES frame_cell (id) ON DELETE CASCADE,
              object_fit TEXT NOT NULL DEFAULT 'contain'
                CHECK (object_fit IN ('contain', 'cover', 'fill', 'scale-down', 'none')),
              object_align TEXT NOT NULL DEFAULT 'center'
                CHECK (
                  object_align IN (
                    'center',
                    'top',
                    'bottom',
                    'left',
                    'right',
                    'top-left',
                    'top-right',
                    'bottom-left',
                    'bottom-right'
                  )
                ),
              max_width TEXT NOT NULL DEFAULT '',
              scale_pct INTEGER NOT NULL DEFAULT 100
            )
            """
        )
        msgs.append("frame_cell_image: created table")

    if _add_column(con, "frame_cell_image", "scale_pct", "INTEGER NOT NULL DEFAULT 100"):
        msgs.append("frame_cell_image: added column scale_pct")

    if _add_column(con, "frame_cell_image", "link_href", "TEXT NOT NULL DEFAULT ''"):
        msgs.append("frame_cell_image: added column link_href")

    con.commit()
    return msgs


def main() -> None:
    if not DB_PATH.is_file():
        print(f"No database at {DB_PATH}", file=sys.stderr)
        sys.exit(1)
    con = sqlite3.connect(str(DB_PATH))
    try:
        con.execute("PRAGMA foreign_keys=ON")
        msgs = migrate(con)
        if not msgs:
            print(f"OK {DB_PATH} (no changes needed)")
        else:
            print(f"OK {DB_PATH}")
            for m in msgs:
                print(" ", m)
    finally:
        con.close()


if __name__ == "__main__":
    main()
