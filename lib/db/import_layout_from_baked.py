#!/usr/bin/env python3
"""
Import committed data/layout/*.json into lib/db/customdev.db (local scratch pad).

Used by: npm run setup:layout, npm run import:layout --all

Git truth: data/layout/ — not customdev.db.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
LAYOUT_DIR = REPO_ROOT / "data" / "layout"
DB_PATH = Path(
    __import__("os").environ.get("CUSTOMDEV_DB", str(REPO_ROOT / "lib" / "db" / "customdev.db")),
)

sys.path.insert(0, str(REPO_ROOT / "server"))
sys.path.insert(0, str(REPO_ROOT / "lib" / "db"))
from dev_api import _connect as api_connect, _grid_gap_to_db, _sanitize_font_family, _truncate  # noqa: E402
from import_frame_json import import_frame_payload  # noqa: E402


def _upsert_page(con, page: dict) -> int:
    pid = int(page["id"])
    name = _truncate(str(page.get("name") or ""), 120)
    header = 1 if page.get("header") else 0
    footer = 1 if page.get("footer") else 0
    sort_order = int(page.get("sortOrder") or 0)
    group_id = page.get("groupId")
    gid = int(group_id) if group_id is not None else None
    row = con.execute("SELECT id FROM page WHERE name = ?", (name,)).fetchone()
    if row is not None:
        pid = int(row[0])
        con.execute(
            """
            UPDATE page
            SET header = ?, footer = ?, sort_order = ?, group_id = ?
            WHERE id = ?
            """,
            (header, footer, sort_order, gid, pid),
        )
        return pid
    id_row = con.execute("SELECT id FROM page WHERE id = ?", (pid,)).fetchone()
    if id_row is not None:
        con.execute(
            """
            INSERT INTO page (name, header, footer, sort_order, group_id)
            VALUES (?, ?, ?, ?, ?)
            """,
            (name, header, footer, sort_order, gid),
        )
        return int(con.execute("SELECT last_insert_rowid()").fetchone()[0])
    con.execute(
        """
        INSERT INTO page (id, name, header, footer, sort_order, group_id)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (pid, name, header, footer, sort_order, gid),
    )
    return pid


def _upsert_frame_shell(con, page: dict, frame: dict) -> int:
    pid = _upsert_page(con, page)
    fid = int(frame["id"])
    cols = max(1, min(24, int(frame.get("columnCount") or 4)))
    rows = max(1, min(24, int(frame.get("rowCount") or 2)))
    label = _truncate(str(frame.get("label") or ""), 120)
    grid_gap = _grid_gap_to_db(frame.get("gridGap"))
    notes = _truncate(str(frame.get("notes") or ""), 4000)
    dtf = _sanitize_font_family(str(frame.get("defaultTextFontFamily") or ""))
    try:
        dts = int(frame.get("defaultTextFontSize") or 16)
    except (TypeError, ValueError):
        dts = 16
    dts = max(8, min(288, dts))

    existing = con.execute("SELECT id FROM frame WHERE page_id = ?", (pid,)).fetchone()
    if existing is None:
        con.execute(
            """
            INSERT INTO frame (
              id, page_id, column_count, row_count, label, grid_gap, notes,
              default_text_font_family, default_text_font_size
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (fid, pid, cols, rows, label, grid_gap, notes, dtf, dts),
        )
    else:
        con.execute(
            """
            UPDATE frame
            SET column_count = ?, row_count = ?, label = ?, grid_gap = ?, notes = ?,
                default_text_font_family = ?, default_text_font_size = ?
            WHERE page_id = ?
            """,
            (cols, rows, label, grid_gap, notes, dtf, dts, pid),
        )
        cur_id = int(existing[0])
        if cur_id != fid:
            con.execute("UPDATE frame SET id = ? WHERE page_id = ?", (fid, pid))
    return fid


def _ensure_frame_cells(con, frame_id: int, cells: list) -> None:
    for cell in cells:
        if not cell or not isinstance(cell, dict):
            continue
        cid = int(cell["id"])
        ix = int(cell["cellIndex"])
        ct = str(cell.get("contentType") or "empty").strip().lower()
        body = str(cell.get("body") or "")
        role = _truncate(str(cell.get("cellRole") or ""), 120)
        from dev_api import _cell_padding_to_db  # noqa: E402

        pad = _cell_padding_to_db(cell.get("cellPadding", ""))
        row = con.execute("SELECT id FROM frame_cell WHERE id = ?", (cid,)).fetchone()
        if row is None:
            ix_row = con.execute(
                "SELECT id FROM frame_cell WHERE frame_id = ? AND cell_index = ?",
                (frame_id, ix),
            ).fetchone()
            if ix_row is not None and int(ix_row[0]) != cid:
                con.execute("DELETE FROM frame_cell WHERE id = ?", (int(ix_row[0]),))
            con.execute(
                """
                INSERT INTO frame_cell (id, frame_id, cell_index, content_type, body, cell_role, cell_padding)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (cid, frame_id, ix, ct, body, role, pad),
            )
        else:
            con.execute(
                """
                UPDATE frame_cell
                SET frame_id = ?, cell_index = ?, content_type = ?, body = ?, cell_role = ?, cell_padding = ?
                WHERE id = ?
                """,
                (frame_id, ix, ct, body, role, pad, cid),
            )


def import_frame_file(con, path: Path) -> None:
    payload = json.loads(path.read_text(encoding="utf-8"))
    frame = payload.get("frame")
    cells = payload.get("cells")
    page = payload.get("page")
    if not frame or not page or not isinstance(cells, list):
        raise ValueError(f"{path}: need page, frame, cells")
    fid = _upsert_frame_shell(con, page, frame)
    _ensure_frame_cells(con, fid, cells)
    import_frame_payload(con, payload)


def _upsert_gallery(con, payload: dict) -> None:
    page = payload.get("page")
    gallery = payload.get("gallery")
    if not page or not gallery:
        raise ValueError("gallery payload needs page + gallery")
    pid = _upsert_page(con, page)
    g = gallery
    gid = int(g["id"])
    g["pageId"] = pid
    gkey = _truncate(str(g.get("galleryKey") or "default"), 120)
    thumb = 1 if g.get("thumbnail") else 0
    zoom = 1 if g.get("zoom") else 0
    zoom_style = _truncate(str(g.get("zoomStyle") or ""), 120)
    col_count = max(2, min(8, int(g.get("columnCount") or 2)))
    row_count = max(1, min(8, int(g.get("rowCount") or 1)))
    gal_style = _truncate(str(g.get("galleryStyle") or ""), 120)
    thumb_style = _truncate(str(g.get("thumbnailStyle") or ""), 120)

    row = con.execute(
        "SELECT id FROM gallery WHERE page_id = ? AND gallery_key = ?",
        (pid, gkey),
    ).fetchone()
    if row is None:
        con.execute(
            """
            INSERT INTO gallery (
              id, page_id, gallery_key, thumbnail, zoom, zoom_style,
              column_count, row_count, gallery_style, thumbnail_style
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                gid,
                pid,
                gkey,
                thumb,
                zoom,
                zoom_style,
                col_count,
                row_count,
                gal_style,
                thumb_style,
            ),
        )
    else:
        con.execute(
            """
            UPDATE gallery
            SET thumbnail = ?, zoom = ?, zoom_style = ?, column_count = ?, row_count = ?,
                gallery_style = ?, thumbnail_style = ?
            WHERE page_id = ? AND gallery_key = ?
            """,
            (
                thumb,
                zoom,
                zoom_style,
                col_count,
                row_count,
                gal_style,
                thumb_style,
                pid,
                gkey,
            ),
        )

    font = payload.get("font")
    if font and isinstance(font, dict):
        try:
            fs = int(font.get("fontSize") or 16)
        except (TypeError, ValueError):
            fs = 16
        fs = max(8, min(288, fs))
        ff = _truncate(str(font.get("fontFamily") or "system-ui, sans-serif"), 200)
        fid = int(font.get("id") or 0)
        frow = con.execute("SELECT id FROM font WHERE page_id = ?", (pid,)).fetchone()
        if frow is None:
            if fid:
                con.execute(
                    "INSERT INTO font (id, page_id, font_size, font_family) VALUES (?, ?, ?, ?)",
                    (fid, pid, fs, ff),
                )
            else:
                con.execute(
                    "INSERT INTO font (page_id, font_size, font_family) VALUES (?, ?, ?)",
                    (pid, fs, ff),
                )
        else:
            con.execute(
                "UPDATE font SET font_size = ?, font_family = ? WHERE page_id = ?",
                (fs, ff, pid),
            )


def _manifest_lists(root: Path) -> tuple[list[str], list[tuple[str, str]]]:
    manifest_path = root / "manifest.json"
    if not manifest_path.is_file():
        return [], []
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    frames = [str(n) for n in manifest.get("frames") or [] if str(n).strip()]
    galleries: list[tuple[str, str]] = []
    for item in manifest.get("galleries") or []:
        if not item or not isinstance(item, dict):
            continue
        page = str(item.get("page") or "").strip()
        key = str(item.get("galleryKey") or "default").strip() or "default"
        if page:
            galleries.append((page, key))
    return frames, galleries


def import_all_layout(layout_dir: Path | None = None) -> dict:
    root = layout_dir or LAYOUT_DIR
    frame_dir = root / "frame"
    gallery_dir = root / "gallery"
    if not frame_dir.is_dir():
        raise FileNotFoundError(f"Missing {frame_dir}")

    manifest_frames, manifest_galleries = _manifest_lists(root)

    con = api_connect()
    frames: list[str] = []
    galleries: list[str] = []
    try:
        frame_names = manifest_frames or sorted(p.stem for p in frame_dir.glob("*.json"))
        for name in frame_names:
            path = frame_dir / f"{name}.json"
            if not path.is_file():
                raise FileNotFoundError(f"Missing frame JSON: {path}")
            import_frame_file(con, path)
            frames.append(name)

        gallery_specs = manifest_galleries
        if not gallery_specs and gallery_dir.is_dir():
            for page_dir in sorted(gallery_dir.iterdir()):
                if not page_dir.is_dir():
                    continue
                for gpath in sorted(page_dir.glob("*.json")):
                    gallery_specs.append((page_dir.name, gpath.stem))

        for page_name, gkey in gallery_specs:
            gpath = gallery_dir / page_name / f"{gkey}.json"
            if not gpath.is_file():
                raise FileNotFoundError(f"Missing gallery JSON: {gpath}")
            payload = json.loads(gpath.read_text(encoding="utf-8"))
            _upsert_gallery(con, payload)
            galleries.append(f"{page_name}/{gkey}")
        con.commit()
    finally:
        con.close()

    return {"frames": frames, "galleries": galleries}


def main() -> int:
    if not DB_PATH.is_file():
        print(f"No database: {DB_PATH} — run npm run setup:layout first", file=sys.stderr)
        return 1
    try:
        summary = import_all_layout()
    except (OSError, ValueError, json.JSONDecodeError) as e:
        print(f"Import failed: {e}", file=sys.stderr)
        return 1
    print(
        f"OK imported {len(summary['frames'])} frame(s), "
        f"{len(summary['galleries'])} gallery layout(s) → {DB_PATH}",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
