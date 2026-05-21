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
    if "CHECK (content_type IN" in sql and "'shape'" not in sql:
        return True
    if "CHECK (content_type IN" in sql and "'stack'" not in sql:
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
                CHECK (content_type IN ('empty', 'html', 'image', 'table', 'text', 'shape', 'stack')),
              body TEXT NOT NULL DEFAULT '',
              css_class TEXT NOT NULL DEFAULT '',
              aria_label TEXT NOT NULL DEFAULT '',
              cell_role TEXT NOT NULL DEFAULT '',
              cell_padding TEXT NOT NULL DEFAULT '',
              UNIQUE (frame_id, cell_index)
            )
            """
        )
        has_pad = "cell_padding" in {r[1] for r in con.execute("PRAGMA table_info(frame_cell)")}
        pad_sel = "COALESCE(cell_padding, '')" if has_pad else "''"
        con.execute(
            f"""
            INSERT INTO frame_cell__migrated
              (id, frame_id, cell_index, content_type, body, css_class, aria_label, cell_role, cell_padding)
            SELECT
              id, frame_id, cell_index, content_type, body,
              COALESCE(css_class, ''),
              COALESCE(aria_label, ''),
              COALESCE(cell_role, ''),
              {pad_sel}
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

    for table in ("frame_cell_image", "frame_cell_shape"):
        if _add_column(con, table, "placement_left_pct", "REAL"):
            msgs.append(f"{table}: added column placement_left_pct")
        if _add_column(con, table, "placement_top_pct", "REAL"):
            msgs.append(f"{table}: added column placement_top_pct")

    shape_sql_row = con.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='frame_cell_shape'",
    ).fetchone()
    shape_sql = str(shape_sql_row[0] or "") if shape_sql_row else ""
    shape_sql_compact = shape_sql.replace(" ", "") if shape_sql else ""
    if shape_sql and "width_pct<=100" in shape_sql_compact and "width_pct<=250" not in shape_sql_compact:
        con.execute("PRAGMA foreign_keys=OFF")
        con.execute(
            """
            CREATE TABLE frame_cell_shape__size_mig (
              frame_cell_id INTEGER PRIMARY KEY REFERENCES frame_cell (id) ON DELETE CASCADE,
              shape_kind TEXT NOT NULL DEFAULT 'square'
                CHECK (shape_kind IN ('square', 'triangle', 'circle')),
              width_pct INTEGER NOT NULL DEFAULT 40 CHECK (width_pct >= 25 AND width_pct <= 250),
              height_pct INTEGER NOT NULL DEFAULT 40 CHECK (height_pct >= 25 AND height_pct <= 250),
              object_align TEXT NOT NULL DEFAULT 'center',
              rotation_deg INTEGER NOT NULL DEFAULT 0,
              corner_radius_pct INTEGER NOT NULL DEFAULT 0,
              fill_enabled INTEGER NOT NULL DEFAULT 1,
              fill_color TEXT NOT NULL DEFAULT '#000000',
              fill_opacity_pct INTEGER NOT NULL DEFAULT 100,
              stroke_enabled INTEGER NOT NULL DEFAULT 0,
              stroke_color TEXT NOT NULL DEFAULT '#000000',
              stroke_opacity_pct INTEGER NOT NULL DEFAULT 100,
              stroke_width_px INTEGER NOT NULL DEFAULT 2,
              link_href TEXT NOT NULL DEFAULT '',
              placement_left_pct REAL,
              placement_top_pct REAL
            )
            """
        )
        con.execute(
            """
            INSERT INTO frame_cell_shape__size_mig (
              frame_cell_id, shape_kind, width_pct, height_pct, object_align, rotation_deg,
              corner_radius_pct, fill_enabled, fill_color, fill_opacity_pct, stroke_enabled,
              stroke_color, stroke_opacity_pct, stroke_width_px, link_href,
              placement_left_pct, placement_top_pct
            )
            SELECT
              frame_cell_id, shape_kind,
              CASE
                WHEN width_pct < 25 THEN 25
                WHEN width_pct > 250 THEN 250
                ELSE width_pct
              END,
              CASE
                WHEN height_pct < 25 THEN 25
                WHEN height_pct > 250 THEN 250
                ELSE height_pct
              END,
              object_align, rotation_deg,
              corner_radius_pct, fill_enabled, fill_color, fill_opacity_pct, stroke_enabled,
              stroke_color, stroke_opacity_pct, stroke_width_px, link_href,
              placement_left_pct, placement_top_pct
            FROM frame_cell_shape
            """
        )
        con.execute("DROP TABLE frame_cell_shape")
        con.execute("ALTER TABLE frame_cell_shape__size_mig RENAME TO frame_cell_shape")
        con.execute("PRAGMA foreign_keys=ON")
        msgs.append("frame_cell_shape: widened width_pct/height_pct range to 25–250")

    img_sql_row = con.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='frame_cell_image'",
    ).fetchone()
    img_sql = str(img_sql_row[0] or "") if img_sql_row else ""
    img_sql_compact = img_sql.replace(" ", "") if img_sql else ""
    if img_sql and "scale_pct>=25" in img_sql_compact and "scale_pct>=5" not in img_sql_compact:
        con.execute("PRAGMA foreign_keys=OFF")
        con.execute(
            """
            CREATE TABLE frame_cell_image__scale5 (
              frame_cell_id INTEGER PRIMARY KEY REFERENCES frame_cell (id) ON DELETE CASCADE,
              object_fit TEXT NOT NULL DEFAULT 'contain',
              object_align TEXT NOT NULL DEFAULT 'center',
              max_width TEXT NOT NULL DEFAULT '',
              link_href TEXT NOT NULL DEFAULT '',
              scale_pct INTEGER NOT NULL DEFAULT 100 CHECK (scale_pct >= 5 AND scale_pct <= 250),
              placement_left_pct REAL,
              placement_top_pct REAL
            )
            """
        )
        con.execute(
            """
            INSERT INTO frame_cell_image__scale5 (
              frame_cell_id, object_fit, object_align, max_width, link_href, scale_pct,
              placement_left_pct, placement_top_pct
            )
            SELECT
              frame_cell_id, object_fit, object_align, max_width, link_href,
              CASE
                WHEN scale_pct < 5 THEN 5
                WHEN scale_pct > 250 THEN 250
                ELSE scale_pct
              END,
              placement_left_pct, placement_top_pct
            FROM frame_cell_image
            """
        )
        con.execute("DROP TABLE frame_cell_image")
        con.execute("ALTER TABLE frame_cell_image__scale5 RENAME TO frame_cell_image")
        con.execute("PRAGMA foreign_keys=ON")
        msgs.append("frame_cell_image: widened scale_pct range to 5–250")

    shape_sql_row2 = con.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='frame_cell_shape'",
    ).fetchone()
    shape_sql2 = str(shape_sql_row2[0] or "") if shape_sql_row2 else ""
    shape_sql2_compact = shape_sql2.replace(" ", "") if shape_sql2 else ""
    if shape_sql2 and "width_pct>=25" in shape_sql2_compact and "width_pct>=5" not in shape_sql2_compact:
        con.execute("PRAGMA foreign_keys=OFF")
        con.execute(
            """
            CREATE TABLE frame_cell_shape__scale5 (
              frame_cell_id INTEGER PRIMARY KEY REFERENCES frame_cell (id) ON DELETE CASCADE,
              shape_kind TEXT NOT NULL DEFAULT 'square'
                CHECK (shape_kind IN ('square', 'triangle', 'circle')),
              width_pct INTEGER NOT NULL DEFAULT 40 CHECK (width_pct >= 5 AND width_pct <= 250),
              height_pct INTEGER NOT NULL DEFAULT 40 CHECK (height_pct >= 5 AND height_pct <= 250),
              size_mode TEXT NOT NULL DEFAULT 'keep_ratio'
                CHECK (size_mode IN ('keep_ratio', 'stretch_grid')),
              object_align TEXT NOT NULL DEFAULT 'center',
              rotation_deg INTEGER NOT NULL DEFAULT 0,
              corner_radius_pct INTEGER NOT NULL DEFAULT 0,
              fill_enabled INTEGER NOT NULL DEFAULT 1,
              fill_color TEXT NOT NULL DEFAULT '#000000',
              fill_opacity_pct INTEGER NOT NULL DEFAULT 100,
              stroke_enabled INTEGER NOT NULL DEFAULT 0,
              stroke_color TEXT NOT NULL DEFAULT '#000000',
              stroke_opacity_pct INTEGER NOT NULL DEFAULT 100,
              stroke_width_px INTEGER NOT NULL DEFAULT 2,
              link_href TEXT NOT NULL DEFAULT '',
              placement_left_pct REAL,
              placement_top_pct REAL
            )
            """
        )
        con.execute(
            """
            INSERT INTO frame_cell_shape__scale5 (
              frame_cell_id, shape_kind, width_pct, height_pct, size_mode, object_align,
              rotation_deg, corner_radius_pct, fill_enabled, fill_color, fill_opacity_pct,
              stroke_enabled, stroke_color, stroke_opacity_pct, stroke_width_px, link_href,
              placement_left_pct, placement_top_pct
            )
            SELECT
              frame_cell_id, shape_kind,
              CASE
                WHEN max(width_pct, height_pct) < 5 THEN 5
                WHEN max(width_pct, height_pct) > 250 THEN 250
                ELSE max(width_pct, height_pct)
              END,
              CASE
                WHEN max(width_pct, height_pct) < 5 THEN 5
                WHEN max(width_pct, height_pct) > 250 THEN 250
                ELSE max(width_pct, height_pct)
              END,
              'keep_ratio',
              object_align, rotation_deg, corner_radius_pct, fill_enabled, fill_color,
              fill_opacity_pct, stroke_enabled, stroke_color, stroke_opacity_pct,
              stroke_width_px, link_href, placement_left_pct, placement_top_pct
            FROM frame_cell_shape
            """
        )
        con.execute("DROP TABLE frame_cell_shape")
        con.execute("ALTER TABLE frame_cell_shape__scale5 RENAME TO frame_cell_shape")
        con.execute("PRAGMA foreign_keys=ON")
        msgs.append("frame_cell_shape: 5–250% range, size_mode, keep_ratio migration")
    elif _add_column(con, "frame_cell_shape", "size_mode", "TEXT NOT NULL DEFAULT 'keep_ratio'"):
        msgs.append("frame_cell_shape: added column size_mode")
        con.execute(
            """
            UPDATE frame_cell_shape SET
              width_pct = max(width_pct, height_pct),
              height_pct = max(width_pct, height_pct),
              size_mode = 'keep_ratio'
            """
        )

    if not con.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='page_group'",
    ).fetchone():
        con.execute(
            """
            CREATE TABLE page_group (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              label TEXT NOT NULL DEFAULT '',
              sort_order INTEGER NOT NULL DEFAULT 0
            )
            """
        )
        msgs.append("page_group: created table")

    if not con.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='site_settings'",
    ).fetchone():
        con.execute(
            """
            CREATE TABLE site_settings (
              id INTEGER PRIMARY KEY CHECK (id = 1),
              home_page_id INTEGER REFERENCES page (id) ON DELETE SET NULL
            )
            """
        )
        con.execute("INSERT INTO site_settings (id, home_page_id) VALUES (1, NULL)")
        msgs.append("site_settings: created table")

    if _add_column(con, "page", "group_id", "INTEGER REFERENCES page_group (id) ON DELETE SET NULL"):
        msgs.append("page: added column group_id")

    if _add_column(con, "page", "sort_order", "INTEGER NOT NULL DEFAULT 0"):
        msgs.append("page: added column sort_order")
        names = [
            str(r[0])
            for r in con.execute("SELECT name FROM page ORDER BY name").fetchall()
        ]
        for i, nm in enumerate(names):
            con.execute("UPDATE page SET sort_order = ? WHERE name = ?", (i * 10, nm))

    row = con.execute("SELECT home_page_id FROM site_settings WHERE id = 1").fetchone()
    if row is None:
        con.execute("INSERT INTO site_settings (id, home_page_id) VALUES (1, NULL)")
        msgs.append("site_settings: seeded row")
    elif row[0] is None:
        idx = con.execute("SELECT id FROM page WHERE name = ?", ("index",)).fetchone()
        if idx:
            con.execute(
                "UPDATE site_settings SET home_page_id = ? WHERE id = 1",
                (int(idx[0]),),
            )
            msgs.append("site_settings: set home_page_id to index page")

    if not con.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='frame_cell_shape'",
    ).fetchone():
        con.execute(
            """
            CREATE TABLE frame_cell_shape (
              frame_cell_id INTEGER PRIMARY KEY REFERENCES frame_cell (id) ON DELETE CASCADE,
              shape_kind TEXT NOT NULL DEFAULT 'square'
                CHECK (shape_kind IN ('square', 'triangle', 'circle')),
              width_pct INTEGER NOT NULL DEFAULT 40 CHECK (width_pct >= 25 AND width_pct <= 250),
              height_pct INTEGER NOT NULL DEFAULT 40 CHECK (height_pct >= 25 AND height_pct <= 250),
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
              rotation_deg INTEGER NOT NULL DEFAULT 0 CHECK (rotation_deg >= 0 AND rotation_deg <= 360),
              corner_radius_pct INTEGER NOT NULL DEFAULT 0 CHECK (corner_radius_pct >= 0 AND corner_radius_pct <= 50),
              fill_enabled INTEGER NOT NULL DEFAULT 1 CHECK (fill_enabled IN (0, 1)),
              fill_color TEXT NOT NULL DEFAULT '#000000',
              fill_opacity_pct INTEGER NOT NULL DEFAULT 100 CHECK (fill_opacity_pct >= 0 AND fill_opacity_pct <= 100),
              stroke_enabled INTEGER NOT NULL DEFAULT 0 CHECK (stroke_enabled IN (0, 1)),
              stroke_color TEXT NOT NULL DEFAULT '#000000',
              stroke_opacity_pct INTEGER NOT NULL DEFAULT 100 CHECK (stroke_opacity_pct >= 0 AND stroke_opacity_pct <= 100),
              stroke_width_px INTEGER NOT NULL DEFAULT 2 CHECK (stroke_width_px >= 0 AND stroke_width_px <= 48),
              link_href TEXT NOT NULL DEFAULT ''
            )
            """
        )
        msgs.append("frame_cell_shape: created table")

    row = con.execute("SELECT id FROM page WHERE name = ?", ("contact",)).fetchone()
    if row:
        pid = int(row[0])
        has_frame = con.execute("SELECT 1 FROM frame WHERE page_id = ?", (pid,)).fetchone()
        if not has_frame:
            contact_cell_1 = (
                '<section class="contact-block" aria-label="Contact">\n'
                '          <div class="project-page-header"></div>\n'
                '          <p class="contact-line"><button type="button" class="contact-email-copy" '
                'data-email="calvinvan58@gmail.com" aria-label="Copy email address">'
                "calvinvan58@gmail.com</button></p>\n"
                '          <p class="contact-line"><a href="https://www.instagram.com/calvinpony/" '
                'target="_blank" rel="noopener noreferrer">calvinpony</a></p>\n'
                "        </section>"
            )
            con.execute(
                "INSERT INTO frame (page_id, column_count, row_count, label, grid_gap, notes, "
                "default_text_font_family, default_text_font_size) VALUES (?, 4, 1, 'contact', '', '', '', 16)",
                (pid,),
            )
            fr = con.execute("SELECT id FROM frame WHERE page_id = ?", (pid,)).fetchone()
            if fr:
                fid = int(fr[0])
                for idx, ctype, body in (
                    (0, "empty", ""),
                    (1, "html", contact_cell_1),
                    (2, "empty", ""),
                    (3, "empty", ""),
                ):
                    con.execute(
                        "INSERT INTO frame_cell (frame_id, cell_index, content_type, body) "
                        "VALUES (?, ?, ?, ?)",
                        (fid, idx, ctype, body),
                    )
                msgs.append("frame: seeded contact page (1×4, label contact)")

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
