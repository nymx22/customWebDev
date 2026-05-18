#!/usr/bin/env python3
"""
Export lib/db/customdev.db layout to static JSON under data/layout/ (Option B deploy).

Writes the same payloads as GET /api/frame and GET /api/layout:
  data/layout/frame/<page>.json
  data/layout/gallery/<page>/<galleryKey>.json
  data/layout/manifest.json

Run:  python3 lib/db/export_layout.py
      npm run export:layout
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = REPO_ROOT / "data" / "layout"
DB_PATH = Path(
    os.environ.get("CUSTOMDEV_DB", str(REPO_ROOT / "lib" / "db" / "customdev.db")),
)

sys.path.insert(0, str(REPO_ROOT / "server"))
from dev_api import (  # noqa: E402
    _frame_cells_with_text,
    _row_to_font,
    _row_to_frame,
    _row_to_gallery,
    _row_to_page,
)


def _connect() -> sqlite3.Connection:
    con = sqlite3.connect(str(DB_PATH))
    con.row_factory = sqlite3.Row
    return con


def export_layout(out_dir: Path | None = None) -> dict:
    """Export all frames and gallery layouts. Returns summary dict."""
    target = out_dir or OUT_DIR
    if not DB_PATH.is_file():
        raise FileNotFoundError(f"Database not found: {DB_PATH}")

    frame_dir = target / "frame"
    gallery_dir = target / "gallery"
    frame_dir.mkdir(parents=True, exist_ok=True)
    gallery_dir.mkdir(parents=True, exist_ok=True)

    con = _connect()
    try:
        pages = [_row_to_page(r) for r in con.execute("SELECT * FROM page ORDER BY name")]
        frame_pages: list[str] = []
        gallery_exports: list[dict] = []

        for page in pages:
            if not page:
                continue
            name = str(page["name"])
            pid = int(page["id"])

            frow = con.execute("SELECT * FROM frame WHERE page_id = ?", (pid,)).fetchone()
            if frow:
                frame = _row_to_frame(frow)
                fid = int(frame["id"])
                cells = _frame_cells_with_text(con, fid)
                payload = {"page": page, "frame": frame, "cells": cells}
                out_path = frame_dir / f"{name}.json"
                out_path.write_text(
                    json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8",
                )
                frame_pages.append(name)

            grows = con.execute(
                "SELECT * FROM gallery WHERE page_id = ? ORDER BY gallery_key",
                (pid,),
            ).fetchall()
            frow_font = con.execute("SELECT * FROM font WHERE page_id = ?", (pid,)).fetchone()
            font = _row_to_font(frow_font)

            for grow in grows:
                gallery = _row_to_gallery(grow)
                if not gallery:
                    continue
                gkey = str(gallery.get("galleryKey") or "default")
                page_g_dir = gallery_dir / name
                page_g_dir.mkdir(parents=True, exist_ok=True)
                layout_payload = {"page": page, "gallery": gallery, "font": font}
                gpath = page_g_dir / f"{gkey}.json"
                gpath.write_text(
                    json.dumps(layout_payload, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8",
                )
                gallery_exports.append({"page": name, "galleryKey": gkey})

        manifest = {
            "exportedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "sourceDb": str(DB_PATH.relative_to(REPO_ROOT))
            if DB_PATH.is_relative_to(REPO_ROOT)
            else str(DB_PATH),
            "frames": frame_pages,
            "galleries": gallery_exports,
        }
        (target / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    finally:
        con.close()

    return {
        "ok": True,
        "outDir": str(target.relative_to(REPO_ROOT)) if target.is_relative_to(REPO_ROOT) else str(target),
        "frames": len(frame_pages),
        "galleries": len(gallery_exports),
    }


def main() -> int:
    try:
        summary = export_layout()
    except FileNotFoundError as e:
        print(str(e), file=sys.stderr)
        return 1
    except OSError as e:
        print(f"Export failed: {e}", file=sys.stderr)
        return 1
    print(
        f"OK exported {summary['frames']} frame(s), {summary['galleries']} gallery layout(s) → {summary['outDir']}/",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
