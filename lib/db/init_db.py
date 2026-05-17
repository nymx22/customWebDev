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


INDEX_FRAME_CELL_1_HTML = """<section class="projects">
        <p class="office-tomato-heading">Office Tomato</p>
        <div class="project-list">
          <p class="project">A Missing Tile</p>
          <p class="project">Case</p>
          <p class="project">Delicious</p>
          <p class="project">Silver Hair Song</p>
          <p class="project">Slow Boat</p>
          <p class="project"><a class="project-link" href="pages/farewell-mr-fuji.html">Farewell, Mr. Fuji</a></p>
        </div>
      </section>"""

INDEX_FRAME_CELL_5_HTML = """<p class="photographer"><a class="photographer-link" href="pages/contact.html">calvin van</a></p>"""


def _seed_frames(con: sqlite3.Connection) -> None:
    """One 2×4 frame for the index page (row-major cell indices matching column-layout slots)."""
    row = con.execute("SELECT id FROM page WHERE name = ?", ("index",)).fetchone()
    if not row:
        return
    pid = int(row[0])
    con.execute(
        "INSERT INTO frame (page_id, column_count, row_count, label, grid_gap, notes, default_text_font_family, default_text_font_size) VALUES (?, 4, 2, 'home', '', '', '', 16)",
        (pid,),
    )
    fr = con.execute("SELECT id FROM frame WHERE page_id = ?", (pid,)).fetchone()
    if not fr:
        return
    fid = int(fr[0])
    specs = [
        (0, "empty", ""),
        (1, "html", INDEX_FRAME_CELL_1_HTML),
        (2, "empty", ""),
        (3, "empty", ""),
        (4, "empty", ""),
        (5, "html", INDEX_FRAME_CELL_5_HTML),
        (6, "empty", ""),
        (7, "empty", ""),
    ]
    for idx, ctype, body in specs:
        con.execute(
            "INSERT INTO frame_cell (frame_id, cell_index, content_type, body) VALUES (?, ?, ?, ?)",
            (fid, idx, ctype, body),
        )
    con.execute(
        "UPDATE frame_cell SET cell_role = ? WHERE frame_id = ? AND cell_index = ?",
        ("projects", fid, 1),
    )
    con.execute(
        "UPDATE frame_cell SET cell_role = ? WHERE frame_id = ? AND cell_index = ?",
        ("credits", fid, 5),
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
    _seed_frames(con)
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
