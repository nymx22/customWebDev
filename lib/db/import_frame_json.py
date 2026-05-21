#!/usr/bin/env python3
"""
Import a baked frame JSON file (data/layout/frame/<page>.json) into lib/db/customdev.db.

Run:  python3 lib/db/import_frame_json.py index
      python3 lib/db/import_frame_json.py --file data/layout/frame/index.json
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DB_PATH = Path(
    os.environ.get("CUSTOMDEV_DB", str(REPO_ROOT / "lib" / "db" / "customdev.db")),
)

sys.path.insert(0, str(REPO_ROOT / "server"))
from dev_api import (  # noqa: E402
    _cell_padding_to_db,
    _connect as api_connect,
    _grid_gap_to_db,
    _sanitize_font_family,
    _sync_frame_cell_image,
    _sync_frame_cell_shape,
    _sync_frame_cell_text,
    _truncate,
)


def _connect() -> sqlite3.Connection:
    return api_connect()


def import_frame_payload(con: sqlite3.Connection, payload: dict) -> None:
    frame = payload.get("frame")
    cells = payload.get("cells")
    if not frame or not isinstance(frame, dict):
        raise ValueError("payload.frame required")
    if not isinstance(cells, list):
        raise ValueError("payload.cells must be a list")

    fid = int(frame["id"])
    frow = con.execute("SELECT id FROM frame WHERE id = ?", (fid,)).fetchone()
    if not frow:
        raise ValueError(f"frame id {fid} not found in database")

    grid_gap = _grid_gap_to_db(frame.get("gridGap"))
    label = _truncate(str(frame.get("label") or ""), 120)
    notes = _truncate(str(frame.get("notes") or ""), 4000)
    dtf = _sanitize_font_family(str(frame.get("defaultTextFontFamily") or ""))
    try:
        dts = int(frame.get("defaultTextFontSize") or 16)
    except (TypeError, ValueError):
        dts = 16
    dts = max(8, min(288, dts))
    cols = max(1, min(24, int(frame.get("columnCount") or 4)))
    rows = max(1, min(24, int(frame.get("rowCount") or 2)))

    con.execute(
        """
        UPDATE frame
        SET column_count = ?, row_count = ?, label = ?, grid_gap = ?, notes = ?,
            default_text_font_family = ?, default_text_font_size = ?
        WHERE id = ?
        """,
        (cols, rows, label, grid_gap, notes, dtf, dts, fid),
    )

    for cell in cells:
        if not cell or not isinstance(cell, dict):
            continue
        cid = int(cell["id"])
        ct = str(cell.get("contentType") or "empty").strip().lower()
        if ct == "table":
            ct = "html"
        body = str(cell.get("body") or "")
        role = _truncate(str(cell.get("cellRole") or ""), 120)
        pad = _cell_padding_to_db(cell.get("cellPadding", ""))

        con.execute(
            """
            UPDATE frame_cell
            SET content_type = ?, body = ?, cell_role = ?, cell_padding = ?
            WHERE id = ?
            """,
            (ct, body, role, pad, cid),
        )

        patch: dict = {
            "contentType": ct,
            "body": body,
            "cellPadding": cell.get("cellPadding", ""),
        }
        if cell.get("textStyle") is not None:
            patch["textStyle"] = cell["textStyle"]
        if cell.get("imageStyle") is not None:
            patch["imageStyle"] = cell["imageStyle"]
        if cell.get("shapeStyle") is not None:
            patch["shapeStyle"] = cell["shapeStyle"]
        if ct == "stack" and cell.get("layers") is not None:
            patch["layers"] = cell["layers"]

        _sync_frame_cell_text(con, cid, patch)
        _sync_frame_cell_image(con, cid, patch)
        _sync_frame_cell_shape(con, cid, patch)
        if ct == "shape":
            con.execute("UPDATE frame_cell SET body = '' WHERE id = ?", (cid,))

    con.commit()


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: import_frame_json.py <pageName> | --file path/to/frame.json", file=sys.stderr)
        sys.exit(1)

    if sys.argv[1] == "--file":
        json_path = Path(sys.argv[2])
    else:
        page = sys.argv[1].strip()
        json_path = REPO_ROOT / "data" / "layout" / "frame" / f"{page}.json"

    if not json_path.is_file():
        print(f"Not found: {json_path}", file=sys.stderr)
        sys.exit(1)
    if not DB_PATH.is_file():
        print(f"No database: {DB_PATH}", file=sys.stderr)
        sys.exit(1)

    payload = json.loads(json_path.read_text(encoding="utf-8"))
    con = _connect()
    try:
        import_frame_payload(con, payload)
        print(f"OK imported {json_path} -> {DB_PATH}")
    finally:
        con.close()


if __name__ == "__main__":
    main()
