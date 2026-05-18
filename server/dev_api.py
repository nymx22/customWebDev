#!/usr/bin/env python3
"""
Local layout API for customdev — reads/writes lib/db/customdev.db (SQLite SSOT).
Bind 127.0.0.1 only. Run: python3 server/dev_api.py
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DB_PATH = os.environ.get("CUSTOMDEV_DB", os.path.join(REPO_ROOT, "lib", "db", "customdev.db"))
HOST = os.environ.get("CUSTOMDEV_API_HOST", "127.0.0.1")
PORT = int(os.environ.get("CUSTOMDEV_API_PORT", "8787"))
ASSETS_FONTS_DIR = os.path.join(REPO_ROOT, "assets", "fonts")
ASSETS_IMAGES_DIR = os.path.join(REPO_ROOT, "assets", "images")
_FONT_SUFFIXES = (".ttf", ".otf", ".woff2", ".woff", ".ttc")
_IMAGE_SUFFIXES = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif")
_ASSET_IMAGE_PATH_PREFIX = "images/"


def _list_asset_fonts() -> list[dict]:
    """Files in assets/fonts for frame text staging; cssFamily must match @font-face in style/local-asset-fonts.css."""
    out: list[dict] = []
    try:
        names = sorted(os.listdir(ASSETS_FONTS_DIR))
    except OSError:
        return out
    for name in names:
        low = name.lower()
        if not any(low.endswith(s) for s in _FONT_SUFFIXES):
            continue
        stem, _ext = os.path.splitext(name)
        stem = stem or "font"
        safe = re.sub(r"[^a-zA-Z0-9]+", "_", stem).strip("_") or "font"
        css_family = f"CustomdevAsset_{safe}"
        out.append({"file": name, "cssFamily": css_family, "label": f"{stem} ({name})"})
    return out


def _list_asset_images() -> list[dict]:
    """Image files under assets/images; path is relative to assets/ (e.g. images/foo.png)."""
    out: list[dict] = []
    root = ASSETS_IMAGES_DIR
    if not os.path.isdir(root):
        return out
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d and not d.startswith("."))
        for name in sorted(filenames):
            if name.startswith(".") or name.startswith("._"):
                continue
            low = name.lower()
            if not any(low.endswith(s) for s in _IMAGE_SUFFIXES):
                continue
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, root).replace("\\", "/")
            path = f"{_ASSET_IMAGE_PATH_PREFIX}{rel}"
            out.append({"path": path, "label": path})
    out.sort(key=lambda x: x["path"].lower())
    return out


def _normalize_asset_image_body(raw: object) -> str:
    s = _truncate(str(raw or ""), 2000).strip()
    if not s:
        return ""
    if re.match(r"^https?://", s, re.I):
        return s
    s = s.replace("\\", "/")
    if "?" in s:
        s = s.split("?", 1)[0]
    if "#" in s:
        s = s.split("#", 1)[0]
    low = s.lower()
    for marker in ("assets/images/", "/assets/images/", "../assets/images/"):
        idx = low.find(marker)
        if idx >= 0:
            rest = s[idx + len(marker) :].lstrip("/")
            if not rest or ".." in rest.split("/"):
                return ""
            return f"{_ASSET_IMAGE_PATH_PREFIX}{rest.lstrip('/')}"
    if low.startswith(_ASSET_IMAGE_PATH_PREFIX):
        rest = s[len(_ASSET_IMAGE_PATH_PREFIX) :]
        if not rest or ".." in rest.split("/"):
            return ""
        return f"{_ASSET_IMAGE_PATH_PREFIX}{rest.lstrip('/')}"
    if "/" not in s and "." in s and any(low.endswith(ext) for ext in _IMAGE_SUFFIXES):
        return f"{_ASSET_IMAGE_PATH_PREFIX}{s}"
    if ".." in s or "://" in s:
        return ""
    if not low.startswith(_ASSET_IMAGE_PATH_PREFIX):
        return f"{_ASSET_IMAGE_PATH_PREFIX}{s.lstrip('/')}"
    return s


def _asset_image_abs_path(stored: str) -> str | None:
    norm = _normalize_asset_image_body(stored)
    if not norm or not norm.startswith(_ASSET_IMAGE_PATH_PREFIX):
        return None
    if re.match(r"^https?://", norm, re.I):
        return None
    rel = norm[len(_ASSET_IMAGE_PATH_PREFIX) :]
    if not rel or ".." in rel.split("/"):
        return None
    full = os.path.normpath(os.path.join(ASSETS_IMAGES_DIR, rel))
    images_root = os.path.normpath(ASSETS_IMAGES_DIR)
    if not full.startswith(images_root + os.sep) and full != images_root:
        return None
    return full


def _sanitize_frame_image_body(raw: object) -> str:
    norm = _normalize_asset_image_body(raw)
    if not norm:
        return ""
    if re.match(r"^https?://", norm, re.I):
        raise ValueError("external image URLs are not allowed; use a file under assets/images")
    full = _asset_image_abs_path(norm)
    if not full or not os.path.isfile(full):
        raise ValueError(f"image not found under assets/images: {norm}")
    return norm


def _row_to_page(row: sqlite3.Row | None) -> dict | None:
    if row is None:
        return None
    return {
        "id": row["id"],
        "name": row["name"],
        "header": row["header"],
        "footer": row["footer"],
    }


def _row_to_gallery(row: sqlite3.Row | None) -> dict | None:
    if row is None:
        return None
    return {
        "id": row["id"],
        "pageId": row["page_id"],
        "galleryKey": row["gallery_key"],
        "thumbnail": row["thumbnail"],
        "zoom": row["zoom"],
        "zoomStyle": row["zoom_style"],
        "columnCount": row["column_count"],
        "rowCount": row["row_count"],
        "galleryStyle": row["gallery_style"],
        "thumbnailStyle": row["thumbnail_style"],
    }


def _row_to_font(row: sqlite3.Row | None) -> dict | None:
    if row is None:
        return None
    return {
        "id": row["id"],
        "pageId": row["page_id"],
        "fontSize": row["font_size"],
        "fontFamily": row["font_family"],
    }


def _truncate(s: str, max_len: int) -> str:
    if not isinstance(s, str):
        s = str(s or "")
    return s if len(s) <= max_len else s[:max_len]


def _sanitize_css_class_tokens(raw: str) -> str:
    """Space-separated HTML class tokens safe for classList (no injection via quotes)."""
    out: list[str] = []
    for t in (raw or "").split():
        if len(out) >= 24:
            break
        if len(t) > 64:
            continue
        if re.match(r"^[a-zA-Z_][a-zA-Z0-9_-]*$", t):
            out.append(t)
    return " ".join(out)


def _row_to_frame(row: sqlite3.Row | None) -> dict | None:
    if row is None:
        return None
    keys = row.keys()

    def pick(name: str, default):
        return row[name] if name in keys else default

    dts = int(pick("default_text_font_size", 16) or 16)
    dts = max(8, min(288, dts))
    return {
        "id": row["id"],
        "pageId": row["page_id"],
        "columnCount": row["column_count"],
        "rowCount": row["row_count"],
        "label": row["label"],
        "gridGap": _grid_gap_from_db(str(row["grid_gap"] if "grid_gap" in keys else "")),
        "notes": row["notes"],
        "defaultTextFontFamily": str(pick("default_text_font_family", "") or ""),
        "defaultTextFontSize": dts,
    }


def _sanitize_font_family(raw: str) -> str:
    """CSS font-family stack fragment; strip angle brackets / control chars."""
    s = _truncate(str(raw or ""), 500)
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f<>]", "", s)[:500]


def _sanitize_padding_css(raw: str) -> str:
    return _truncate(str(raw or ""), 120)


def _clamp_grid_gap_pct(raw: object) -> float:
    try:
        n = float(raw if raw is not None else 0)
    except (TypeError, ValueError):
        n = 0.0
    if n <= 0:
        return 0.0
    return min(50.0, n)


def _grid_gap_from_db(raw: str) -> str | dict:
    """Legacy CSS string or `{ topPct, rightPct, bottomPct, leftPct }` for JSON column."""
    s = str(raw or "").strip()
    if not s:
        return ""
    if s.startswith("{"):
        try:
            data = json.loads(s)
        except json.JSONDecodeError:
            return _truncate(s, 120)
        if isinstance(data, dict):
            top = _clamp_grid_gap_pct(data.get("topPct", data.get("top", data.get("upPct", data.get("up", 0)))))
            right = _clamp_grid_gap_pct(data.get("rightPct", data.get("right", 0)))
            bottom = _clamp_grid_gap_pct(
                data.get("bottomPct", data.get("bottom", data.get("downPct", data.get("down", 0)))),
            )
            left = _clamp_grid_gap_pct(data.get("leftPct", data.get("left", 0)))
            if not (top or right or bottom or left):
                return ""
            return {
                "topPct": top,
                "rightPct": right,
                "bottomPct": bottom,
                "leftPct": left,
            }
    return _truncate(s, 120)


def _cell_padding_from_db(raw: str) -> str | dict:
  s = str(raw or "").strip()
  if not s:
    return ""
  if s.startswith("{"):
    try:
      data = json.loads(s)
    except json.JSONDecodeError:
      return _truncate(s, 200)
    if isinstance(data, dict):
      top = _clamp_grid_gap_pct(data.get("topPct", data.get("top", data.get("upPct", data.get("up", 0)))))
      right = _clamp_grid_gap_pct(data.get("rightPct", data.get("right", 0)))
      bottom = _clamp_grid_gap_pct(
        data.get("bottomPct", data.get("bottom", data.get("downPct", data.get("down", 0)))),
      )
      left = _clamp_grid_gap_pct(data.get("leftPct", data.get("left", 0)))
      if not (top or right or bottom or left):
        return ""
      return {
        "topPct": top,
        "rightPct": right,
        "bottomPct": bottom,
        "leftPct": left,
      }
  return _truncate(s, 200)


def _cell_padding_to_db(raw: object) -> str:
  if raw is None:
    return ""
  if isinstance(raw, dict):
    top = _clamp_grid_gap_pct(raw.get("topPct", raw.get("top", raw.get("upPct", raw.get("up", 0)))))
    right = _clamp_grid_gap_pct(raw.get("rightPct", raw.get("right", 0)))
    bottom = _clamp_grid_gap_pct(
      raw.get("bottomPct", raw.get("bottom", raw.get("downPct", raw.get("down", 0)))),
    )
    left = _clamp_grid_gap_pct(raw.get("leftPct", raw.get("left", 0)))
    if not (top or right or bottom or left):
      return ""
    return json.dumps(
      {"topPct": top, "rightPct": right, "bottomPct": bottom, "leftPct": left},
      separators=(",", ":"),
    )
  s = _truncate(str(raw).strip(), 200)
  if s.startswith("{"):
    try:
      return _cell_padding_to_db(json.loads(s))
    except json.JSONDecodeError:
      return s
  return s


def _grid_gap_to_db(raw: object) -> str:
    if raw is None:
        return ""
    if isinstance(raw, dict):
        top = _clamp_grid_gap_pct(raw.get("topPct", raw.get("top", raw.get("upPct", raw.get("up", 0)))))
        right = _clamp_grid_gap_pct(raw.get("rightPct", raw.get("right", 0)))
        bottom = _clamp_grid_gap_pct(
            raw.get("bottomPct", raw.get("bottom", raw.get("downPct", raw.get("down", 0)))),
        )
        left = _clamp_grid_gap_pct(raw.get("leftPct", raw.get("left", 0)))
        if not (top or right or bottom or left):
            return ""
        return json.dumps(
            {"topPct": top, "rightPct": right, "bottomPct": bottom, "leftPct": left},
            separators=(",", ":"),
        )
    s = _truncate(str(raw).strip(), 120)
    if s.startswith("{"):
        try:
            return _grid_gap_to_db(json.loads(s))
        except json.JSONDecodeError:
            return s
    return s


def _sanitize_line_height_pct(raw: object) -> int:
    try:
        n = int(raw if raw is not None else 100)
    except (TypeError, ValueError):
        n = 100
    return max(50, min(250, n))


def _sanitize_image_scale_pct(raw: object) -> int:
    try:
        n = int(raw if raw is not None else 100)
    except (TypeError, ValueError):
        n = 100
    return max(25, min(250, n))


_OBJECT_FIT_ALLOWED = frozenset({"contain", "cover", "fill", "scale-down", "none"})
_OBJECT_ALIGN_ALLOWED = frozenset(
    {
        "center",
        "top",
        "bottom",
        "left",
        "right",
        "top-left",
        "top-right",
        "bottom-left",
        "bottom-right",
    },
)


def _sanitize_object_fit(raw: object) -> str:
    s = str(raw or "").strip().lower()
    return s if s in _OBJECT_FIT_ALLOWED else "contain"


def _sanitize_object_align(raw: object) -> str:
    s = re.sub(r"\s+", "-", str(raw or "").strip().lower())
    return s if s in _OBJECT_ALIGN_ALLOWED else "center"


def _sanitize_max_width_css(raw: object) -> str:
    s = _truncate(str(raw or "").strip(), 40)
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f<>;{}\\]", "", s)[:40]


def _sanitize_cell_role(raw: str) -> str:
    """Staging-only label; keep short printable text."""
    s = _truncate(str(raw or "").strip(), 120)
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", s)[:120]


def _sanitize_nav_url(raw: str) -> str:
    s = _truncate(str(raw or ""), 2000).strip()
    if not s:
        return ""
    low = s.lower()
    if low.startswith("javascript:") or low.startswith("data:") or low.startswith("vbscript:"):
        return ""
    if s.startswith(("#", "/", "?", "./", "../")) or low.startswith("mailto:"):
        return s
    if low.startswith("http://") or low.startswith("https://"):
        return s
    # Same-origin relative paths (index.html, pages/contact.html, …).
    if re.fullmatch(
        r"[\w.%\-/+~]+\.html?(?:\?[\w&=%.\-+]*)?(?:#[\w%.-]*)?",
        s,
        flags=re.IGNORECASE,
    ):
        return s
    return ""


def _blocks_to_plain_body(blocks: list[dict]) -> str:
    lines: list[str] = []
    for b in blocks:
        t = str(b.get("type", "")).lower()
        if t == "text":
            v = str(b.get("value", "") or "").strip()
            if v:
                lines.append(v)
        elif t == "link":
            label = str(b.get("label", "") or "").strip()
            if label:
                lines.append(label)
    return "\n".join(lines)


def _sanitize_body_blocks(
    raw: object,
    body_fallback: str = "",
    nav_url: str = "",
    nav_label: str = "",
) -> tuple[list[dict], str]:
    """Normalize block list; return (blocks, plain_body for frame_cell.body)."""
    blocks: list[dict] = []
    if isinstance(raw, list):
        for item in raw:
            if not isinstance(item, dict):
                continue
            t = str(item.get("type", "")).lower()
            if t == "text":
                v = _truncate(str(item.get("value", "") or ""), 8000)
                v = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", v)
                if not v:
                    continue
                href = _sanitize_nav_url(str(item.get("href", "") or item.get("linkHref", "") or ""))
                block: dict = {"type": "text", "value": v}
                if href:
                    block["href"] = href
                blocks.append(block)
            elif t == "link":
                href = _sanitize_nav_url(str(item.get("href", "") or item.get("url", "") or ""))
                if not href:
                    continue
                label = _truncate(str(item.get("label", "") or ""), 200)
                label = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", label)
                if label:
                    blocks.append({"type": "text", "value": label, "href": href})
                elif blocks and blocks[-1].get("type") == "text" and not blocks[-1].get("href"):
                    blocks[-1]["href"] = href
    elif isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
            return _sanitize_body_blocks(parsed, body_fallback, nav_url, nav_label)
        except json.JSONDecodeError:
            pass

    if not blocks:
        body_s = str(body_fallback or "")
        if body_s:
            blocks.append({"type": "text", "value": body_s})
        nu = _sanitize_nav_url(str(nav_url or ""))
        if nu:
            nl = _truncate(str(nav_label or ""), 200)
            nl = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", nl)
            if nl:
                blocks.append({"type": "text", "value": nl, "href": nu})
            elif blocks and blocks[-1].get("type") == "text":
                blocks[-1]["href"] = nu

    return blocks, _blocks_to_plain_body(blocks)


def _table_columns(con: sqlite3.Connection, table: str) -> set[str]:
    cur = con.execute(f"PRAGMA table_info({table})")
    return {str(r[1]) for r in cur.fetchall()}


def _link_style_from_db_row(text_row: sqlite3.Row | None) -> dict:
    if text_row is None:
        return {}
    trk = text_row.keys()
    raw = str(text_row["link_style"] if "link_style" in trk else "")
    if not raw.strip():
        return {}
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return _sanitize_link_style(parsed)
    except json.JSONDecodeError:
        pass
    return {}


def _sanitize_link_style(raw: object) -> dict:
    if not isinstance(raw, dict):
        return {}
    color_inherit = raw.get("colorInherit", True) is not False
    hover_color_inherit = raw.get("hoverColorInherit", True) is not False

    def color_val(key: str) -> str:
        s = str(raw.get(key, "") or "").strip()[:120]
        if not s or s.lower() in ("inherit", "currentcolor"):
            return ""
        low = s.lower()
        if low.startswith("javascript:") or low.startswith("data:"):
            return ""
        if re.fullmatch(r"#[0-9a-f]{3,8}", s, flags=re.IGNORECASE):
            return s
        if re.fullmatch(r"(rgb|rgba|hsl|hsla)\([^)]+\)", s, flags=re.IGNORECASE):
            return s
        return ""

    hover = raw.get("hover")
    if hover is None:
        hover = raw.get("hoverUnderline")
    return {
        "underline": bool(raw.get("underline")),
        "colorInherit": color_inherit,
        "color": "" if color_inherit else color_val("color"),
        "hover": bool(hover),
        "hoverColorInherit": hover_color_inherit,
        "hoverColor": "" if hover_color_inherit else color_val("hoverColor"),
    }


def _body_blocks_from_db_row(text_row: sqlite3.Row | None, body: str) -> list[dict]:
    if text_row is None:
        return _sanitize_body_blocks([], body, "", "")[0]
    trk = text_row.keys()
    raw_json = str(text_row["body_blocks"] if "body_blocks" in trk else "")
    nav_url = str(text_row["nav_url"] if "nav_url" in trk else "" or "")
    nav_label = str(text_row["nav_label"] if "nav_label" in trk else "" or "")
    if raw_json.strip():
        try:
            parsed = json.loads(raw_json)
            blocks, _ = _sanitize_body_blocks(parsed, body, "", "")
            if blocks:
                return blocks
        except json.JSONDecodeError:
            pass
    return _sanitize_body_blocks([], body, nav_url, nav_label)[0]


def _row_to_frame_cell(
    row: sqlite3.Row | None,
    text_row: sqlite3.Row | None = None,
    image_row: sqlite3.Row | None = None,
) -> dict | None:
    if row is None:
        return None
    keys = row.keys()

    def pick(name: str, default: str = "") -> str:
        return row[name] if name in keys else default

    ct = str(row["content_type"] or "empty")
    body_raw = row["body"] if "body" in keys else ""
    body_out = str(body_raw or "")
    if ct == "image" and body_out.strip():
        body_out = _normalize_asset_image_body(body_out)
    out: dict = {
        "id": int(row["id"]),
        "frameId": int(row["frame_id"]),
        "cellIndex": int(row["cell_index"]),
        "contentType": ct,
        "body": body_out,
        "cellRole": pick("cell_role", ""),
        "cellPadding": _cell_padding_from_db(str(pick("cell_padding", "") or "")),
    }
    if ct == "text":
        if text_row is not None:
            trk = text_row.keys()
            body_blocks = _body_blocks_from_db_row(text_row, str(row["body"] if "body" in keys else ""))
            out["textStyle"] = {
                "fontFamily": text_row["font_family"] if "font_family" in trk else "",
                "fontSize": int(text_row["font_size"] if "font_size" in trk else 16),
                "lineHeightPct": int(text_row["line_height_pct"] if "line_height_pct" in trk else 100),
                "padding": text_row["padding"] if "padding" in trk else "",
                "navUrl": "",
                "navLabel": "",
                "bodyBlocks": body_blocks,
                "linkStyle": _link_style_from_db_row(text_row),
            }
        else:
            out["textStyle"] = {
                "fontFamily": "",
                "fontSize": 16,
                "lineHeightPct": 100,
                "padding": "",
                "navUrl": "",
                "navLabel": "",
                "bodyBlocks": _body_blocks_from_db_row(None, str(row["body"] if "body" in keys else "")),
                "linkStyle": {},
            }
    elif ct == "image":
        out["textStyle"] = None
        if image_row is not None:
            irk = image_row.keys()
            out["imageStyle"] = {
                "objectFit": str(image_row["object_fit"] if "object_fit" in irk else "contain"),
                "objectAlign": str(image_row["object_align"] if "object_align" in irk else "center"),
                "maxWidth": str(image_row["max_width"] if "max_width" in irk else ""),
                "scalePct": int(image_row["scale_pct"] if "scale_pct" in irk else 100),
                "linkHref": _sanitize_nav_url(str(image_row["link_href"] if "link_href" in irk else "")),
            }
        else:
            out["imageStyle"] = {
                "objectFit": "contain",
                "objectAlign": "center",
                "maxWidth": "",
                "scalePct": 100,
                "linkHref": "",
            }
    else:
        out["textStyle"] = None
    return out


def _sync_frame_cell_text(con: sqlite3.Connection, cell_id: int, data: dict) -> None:
    """Maintain frame_cell_text when content_type / body / textStyle change."""
    row = con.execute("SELECT content_type FROM frame_cell WHERE id = ?", (cell_id,)).fetchone()
    if not row:
        return
    final_ct = str(row[0] or "empty")
    touch = any(k in data for k in ("contentType", "body", "textStyle"))
    if final_ct != "text":
        con.execute("DELETE FROM frame_cell_text WHERE frame_cell_id = ?", (cell_id,))
        return
    if not touch:
        return
    con.execute("DELETE FROM frame_cell_text WHERE frame_cell_id = ?", (cell_id,))
    ts = data.get("textStyle") if isinstance(data.get("textStyle"), dict) else {}
    ff = _sanitize_font_family(str(ts.get("fontFamily", "") or ""))
    try:
        fs = int(ts.get("fontSize", 16) or 16)
    except (TypeError, ValueError):
        fs = 16
    fs = max(8, min(288, fs))
    pd = _sanitize_padding_css(str(ts.get("padding", "") or ""))
    lh = _sanitize_line_height_pct(ts.get("lineHeightPct", 100))
    body_row = con.execute("SELECT body FROM frame_cell WHERE id = ?", (cell_id,)).fetchone()
    body_fallback = str(data.get("body", "") or "") if "body" in data else ""
    if not body_fallback and body_row:
        body_fallback = str(body_row[0] or "")
    blocks_raw = ts.get("bodyBlocks")
    if blocks_raw is None and "bodyBlocks" not in ts:
        blocks_raw = ts.get("body_blocks")
    blocks, plain_body = _sanitize_body_blocks(
        blocks_raw if blocks_raw is not None else [],
        body_fallback,
        str(ts.get("navUrl", "") or ""),
        str(ts.get("navLabel", "") or ""),
    )
    body_blocks_json = json.dumps(blocks, ensure_ascii=False)
    link_style_json = json.dumps(
        _sanitize_link_style(ts.get("linkStyle") if isinstance(ts.get("linkStyle"), dict) else {}),
        ensure_ascii=False,
    )
    if blocks_raw is not None or "body" in data or touch:
        con.execute("UPDATE frame_cell SET body = ? WHERE id = ?", (plain_body, cell_id))
    text_cols = _table_columns(con, "frame_cell_text")
    link_col = ", link_style" if "link_style" in text_cols else ""
    link_val = ", ?" if "link_style" in text_cols else ""
    con.execute(
        f"""
        INSERT INTO frame_cell_text (
          frame_cell_id, font_family, font_size, line_height_pct, padding, nav_url, nav_label, body_blocks{link_col}
        )
        VALUES (?, ?, ?, ?, ?, '', '', ?{link_val})
        """,
        (cell_id, ff, fs, lh, pd, body_blocks_json)
        + ((link_style_json,) if "link_style" in text_cols else ()),
    )


def _sync_frame_cell_image(con: sqlite3.Connection, cell_id: int, data: dict) -> None:
    row = con.execute("SELECT content_type FROM frame_cell WHERE id = ?", (cell_id,)).fetchone()
    if not row:
        return
    final_ct = str(row[0] or "empty")
    touch = any(k in data for k in ("contentType", "body", "imageStyle"))
    if final_ct != "image":
        con.execute("DELETE FROM frame_cell_image WHERE frame_cell_id = ?", (cell_id,))
        return
    if not touch:
        return
    con.execute("DELETE FROM frame_cell_image WHERE frame_cell_id = ?", (cell_id,))
    ins = data.get("imageStyle") if isinstance(data.get("imageStyle"), dict) else {}
    ofit = _sanitize_object_fit(ins.get("objectFit", "contain"))
    oal = _sanitize_object_align(ins.get("objectAlign", "center"))
    mw = _sanitize_max_width_css(ins.get("maxWidth", ""))
    scale = _sanitize_image_scale_pct(ins.get("scalePct", 100))
    link_href = _sanitize_nav_url(str(ins.get("linkHref", "") or ins.get("link_href", "") or ""))
    con.execute(
        """
        INSERT INTO frame_cell_image (frame_cell_id, object_fit, object_align, max_width, scale_pct, link_href)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (cell_id, ofit, oal, mw, scale, link_href),
    )


def _frame_cells_with_text(con: sqlite3.Connection, fid: int) -> list[dict]:
    rows = list(
        con.execute(
            "SELECT * FROM frame_cell WHERE frame_id = ? ORDER BY cell_index",
            (fid,),
        ),
    )
    if not rows:
        return []
    ids = [int(r["id"]) for r in rows]
    by_id: dict[int, sqlite3.Row] = {}
    by_img: dict[int, sqlite3.Row] = {}
    if ids:
        ph = ",".join("?" * len(ids))
        try:
            for tr in con.execute(f"SELECT * FROM frame_cell_text WHERE frame_cell_id IN ({ph})", ids):
                by_id[int(tr["frame_cell_id"])] = tr
        except sqlite3.OperationalError:
            pass
        try:
            for ir in con.execute(f"SELECT * FROM frame_cell_image WHERE frame_cell_id IN ({ph})", ids):
                by_img[int(ir["frame_cell_id"])] = ir
        except sqlite3.OperationalError:
            pass
    return [_row_to_frame_cell(r, by_id.get(int(r["id"])), by_img.get(int(r["id"]))) for r in rows]


def _connect() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    return con


def _cors_headers(origin: str | None) -> dict[str, str]:
    h: dict[str, str] = {}
    if origin and (
        origin.startswith("http://127.0.0.1:")
        or origin.startswith("http://localhost:")
        or origin.startswith("http://[::1]:")
    ):
        h["Access-Control-Allow-Origin"] = origin
        h["Access-Control-Allow-Methods"] = "GET, POST, PATCH, DELETE, OPTIONS"
        h["Access-Control-Allow-Headers"] = "Content-Type"
        h["Vary"] = "Origin"
    return h


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _send(self, code: int, body: bytes, content_type: str = "application/json") -> None:
        origin = self.headers.get("Origin")
        cors = _cors_headers(origin)
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        for k, v in cors.items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self._send(204, b"")

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        origin = self.headers.get("Origin")
        if parsed.path == "/api/layout":
            qs = parse_qs(parsed.query)
            page_name = (qs.get("page") or [""])[0].strip()
            gallery_key = (qs.get("galleryKey") or ["default"])[0].strip() or "default"
            if not page_name:
                self._send(400, json.dumps({"error": "missing page"}).encode())
                return
            try:
                con = _connect()
                try:
                    cur = con.execute("SELECT * FROM page WHERE name = ?", (page_name,))
                    prow = cur.fetchone()
                    if not prow:
                        self._send(404, json.dumps({"error": "page not found"}).encode())
                        return
                    page = _row_to_page(prow)
                    cur = con.execute(
                        "SELECT * FROM gallery WHERE page_id = ? AND gallery_key = ?",
                        (page["id"], gallery_key),
                    )
                    grow = cur.fetchone()
                    gallery = _row_to_gallery(grow) if grow else None
                    cur = con.execute("SELECT * FROM font WHERE page_id = ?", (page["id"],))
                    frow = cur.fetchone()
                    font = _row_to_font(frow)
                    body = json.dumps({"page": page, "gallery": gallery, "font": font}).encode()
                    self._send(200, body)
                finally:
                    con.close()
            except OSError as e:
                self._send(500, json.dumps({"error": str(e)}).encode())
            return

        if parsed.path == "/api/pages":
            try:
                con = _connect()
                try:
                    cur = con.execute("SELECT * FROM page ORDER BY name")
                    pages = [_row_to_page(r) for r in cur.fetchall()]
                    self._send(200, json.dumps({"pages": pages}).encode())
                finally:
                    con.close()
            except OSError as e:
                self._send(500, json.dumps({"error": str(e)}).encode())
            return

        if parsed.path == "/api/galleries":
            qs = parse_qs(parsed.query)
            page_name = (qs.get("page") or [""])[0].strip()
            if not page_name:
                self._send(400, json.dumps({"error": "missing page"}).encode())
                return
            try:
                con = _connect()
                try:
                    cur = con.execute("SELECT id FROM page WHERE name = ?", (page_name,))
                    prow = cur.fetchone()
                    if not prow:
                        self._send(404, json.dumps({"error": "page not found"}).encode())
                        return
                    pid = prow["id"]
                    cur = con.execute(
                        "SELECT * FROM gallery WHERE page_id = ? ORDER BY gallery_key",
                        (pid,),
                    )
                    galleries = [_row_to_gallery(r) for r in cur.fetchall()]
                    self._send(200, json.dumps({"galleries": galleries}).encode())
                finally:
                    con.close()
            except OSError as e:
                self._send(500, json.dumps({"error": str(e)}).encode())
            return

        if parsed.path == "/api/registry":
            try:
                con = _connect()
                try:
                    pages = [_row_to_page(r) for r in con.execute("SELECT * FROM page ORDER BY name")]
                    galleries: list = []
                    frames: list = []
                    for p in pages:
                        pid = p["id"]
                        for r in con.execute(
                            "SELECT * FROM gallery WHERE page_id = ? ORDER BY gallery_key",
                            (pid,),
                        ):
                            galleries.append(_row_to_gallery(r))
                        fr = con.execute("SELECT * FROM frame WHERE page_id = ?", (pid,)).fetchone()
                        if fr:
                            frames.append(_row_to_frame(fr))
                    self._send(
                        200,
                        json.dumps({"pages": pages, "galleries": galleries, "frames": frames}).encode(),
                    )
                finally:
                    con.close()
            except OSError as e:
                self._send(500, json.dumps({"error": str(e)}).encode())
            return

        if parsed.path == "/api/fonts":
            try:
                fonts = _list_asset_fonts()
                self._send(200, json.dumps({"fonts": fonts}).encode())
            except OSError as e:
                self._send(500, json.dumps({"error": str(e)}).encode())
            return

        if parsed.path == "/api/asset-images":
            try:
                images = _list_asset_images()
                self._send(200, json.dumps({"images": images}).encode())
            except OSError as e:
                self._send(500, json.dumps({"error": str(e)}).encode())
            return

        if parsed.path == "/api/frame":
            qs = parse_qs(parsed.query)
            page_name = (qs.get("page") or [""])[0].strip()
            if not page_name:
                self._send(400, json.dumps({"error": "missing page"}).encode())
                return
            try:
                con = _connect()
                try:
                    cur = con.execute("SELECT * FROM page WHERE name = ?", (page_name,))
                    prow = cur.fetchone()
                    if not prow:
                        self._send(404, json.dumps({"error": "page not found"}).encode())
                        return
                    page = _row_to_page(prow)
                    pid = page["id"]
                    cur = con.execute("SELECT * FROM frame WHERE page_id = ?", (pid,))
                    frow = cur.fetchone()
                    if not frow:
                        self._send(404, json.dumps({"error": "no frame for page"}).encode())
                        return
                    frame = _row_to_frame(frow)
                    fid = frame["id"]
                    cells = _frame_cells_with_text(con, fid)
                    self._send(200, json.dumps({"page": page, "frame": frame, "cells": cells}).encode())
                finally:
                    con.close()
            except OSError as e:
                self._send(500, json.dumps({"error": str(e)}).encode())
            return

        self._send(404, json.dumps({"error": "not found"}).encode())

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        return json.loads(raw.decode("utf-8") or "{}")

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/export-layout":
            script = os.path.join(REPO_ROOT, "lib", "db", "export_layout.py")
            try:
                proc = subprocess.run(
                    [sys.executable, script],
                    cwd=REPO_ROOT,
                    capture_output=True,
                    text=True,
                    timeout=120,
                    check=False,
                )
                if proc.returncode != 0:
                    err = (proc.stderr or proc.stdout or "export failed").strip()
                    self._send(500, json.dumps({"error": err}).encode())
                    return
                manifest_path = os.path.join(REPO_ROOT, "data", "layout", "manifest.json")
                summary = {"ok": True, "outDir": "data/layout"}
                if os.path.isfile(manifest_path):
                    with open(manifest_path, encoding="utf-8") as mf:
                        summary["manifest"] = json.load(mf)
                self._send(200, json.dumps(summary).encode())
            except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError) as e:
                self._send(500, json.dumps({"error": str(e)}).encode())
            return

        if parsed.path == "/api/page":
            try:
                data = self._read_json()
                name = str(data.get("name") or "").strip()
                if not name:
                    self._send(400, json.dumps({"error": "name required"}).encode())
                    return
                header = 1 if data.get("header", True) else 0
                footer = 1 if data.get("footer", True) else 0
                con = _connect()
                try:
                    con.execute(
                        "INSERT INTO page (name, header, footer) VALUES (?, ?, ?)",
                        (name, header, footer),
                    )
                    con.commit()
                    cur = con.execute("SELECT * FROM page WHERE name = ?", (name,))
                    row = cur.fetchone()
                    self._send(201, json.dumps({"page": _row_to_page(row)}).encode())
                except sqlite3.IntegrityError:
                    self._send(409, json.dumps({"error": "duplicate name"}).encode())
                finally:
                    con.close()
            except (json.JSONDecodeError, OSError, sqlite3.Error) as e:
                self._send(400, json.dumps({"error": str(e)}).encode())
            return

        if parsed.path == "/api/gallery":
            try:
                data = self._read_json()
                page_name = str(data.get("pageName") or "").strip()
                gallery_key = str(data.get("galleryKey") or "default").strip() or "default"
                if not page_name:
                    self._send(400, json.dumps({"error": "pageName required"}).encode())
                    return
                con = _connect()
                try:
                    cur = con.execute("SELECT id FROM page WHERE name = ?", (page_name,))
                    prow = cur.fetchone()
                    if not prow:
                        self._send(404, json.dumps({"error": "page not found"}).encode())
                        return
                    pid = prow["id"]
                    thumbnail = 1 if data.get("thumbnail", True) else 0
                    zoom = 1 if data.get("zoom", True) else 0
                    zoom_style = str(data.get("zoomStyle") or "")
                    column_count = int(data.get("columnCount") or 2)
                    row_count = int(data.get("rowCount") or 1)
                    gallery_style = str(data.get("galleryStyle") or "")
                    thumbnail_style = str(data.get("thumbnailStyle") or "")
                    con.execute(
                        """INSERT INTO gallery (
                          page_id, gallery_key, thumbnail, zoom, zoom_style,
                          column_count, row_count, gallery_style, thumbnail_style
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                        (
                            pid,
                            gallery_key,
                            thumbnail,
                            zoom,
                            zoom_style,
                            column_count,
                            row_count,
                            gallery_style,
                            thumbnail_style,
                        ),
                    )
                    con.commit()
                    cur = con.execute(
                        "SELECT * FROM gallery WHERE page_id = ? AND gallery_key = ?",
                        (pid, gallery_key),
                    )
                    row = cur.fetchone()
                    self._send(201, json.dumps({"gallery": _row_to_gallery(row)}).encode())
                except sqlite3.IntegrityError:
                    self._send(409, json.dumps({"error": "duplicate gallery key on page"}).encode())
                finally:
                    con.close()
            except (json.JSONDecodeError, OSError, sqlite3.Error, ValueError) as e:
                self._send(400, json.dumps({"error": str(e)}).encode())
            return

        if parsed.path == "/api/frame":
            try:
                data = self._read_json()
                page_name = str(data.get("pageName") or "").strip()
                cols = int(data.get("columnCount") or 4)
                rows = int(data.get("rowCount") or 2)
                if not page_name:
                    self._send(400, json.dumps({"error": "pageName required"}).encode())
                    return
                cols = max(1, min(24, cols))
                rows = max(1, min(24, rows))
                con = _connect()
                try:
                    cur = con.execute("SELECT id FROM page WHERE name = ?", (page_name,))
                    prow = cur.fetchone()
                    if not prow:
                        self._send(404, json.dumps({"error": "page not found"}).encode())
                        return
                    pid = prow["id"]
                    if con.execute("SELECT id FROM frame WHERE page_id = ?", (pid,)).fetchone():
                        self._send(409, json.dumps({"error": "frame already exists for page"}).encode())
                        return
                    label = _truncate(str(data.get("label") or ""), 120)
                    grid_gap = _grid_gap_to_db(data.get("gridGap"))
                    notes = _truncate(str(data.get("notes") or ""), 4000)
                    dtf = _sanitize_font_family(str(data.get("defaultTextFontFamily") or ""))
                    try:
                        dts = int(data.get("defaultTextFontSize") or 16)
                    except (TypeError, ValueError):
                        dts = 16
                    dts = max(8, min(288, dts))
                    con.execute(
                        "INSERT INTO frame (page_id, column_count, row_count, label, grid_gap, notes, default_text_font_family, default_text_font_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                        (pid, cols, rows, label, grid_gap, notes, dtf, dts),
                    )
                    con.commit()
                    cur = con.execute("SELECT * FROM frame WHERE page_id = ?", (pid,))
                    frow = cur.fetchone()
                    fid = int(frow["id"])
                    n = cols * rows
                    for i in range(n):
                        con.execute(
                            "INSERT INTO frame_cell (frame_id, cell_index, content_type, body) VALUES (?, ?, 'empty', '')",
                            (fid, i),
                        )
                    con.commit()
                    cur = con.execute("SELECT * FROM frame WHERE id = ?", (fid,))
                    frame = _row_to_frame(cur.fetchone())
                    cells = _frame_cells_with_text(con, fid)
                    self._send(201, json.dumps({"frame": frame, "cells": cells}).encode())
                finally:
                    con.close()
            except (json.JSONDecodeError, OSError, sqlite3.Error, ValueError) as e:
                self._send(400, json.dumps({"error": str(e)}).encode())
            return

        self._send(404, json.dumps({"error": "not found"}).encode())

    def do_PATCH(self) -> None:
        parsed = urlparse(self.path)
        try:
            data = self._read_json()
        except json.JSONDecodeError:
            self._send(400, json.dumps({"error": "invalid json"}).encode())
            return

        if parsed.path == "/api/gallery":
            gid = int(data.get("id") or 0)
            if not gid:
                self._send(400, json.dumps({"error": "id required"}).encode())
                return
            try:
                con = _connect()
                try:
                    cur = con.execute("SELECT * FROM gallery WHERE id = ?", (gid,))
                    row = cur.fetchone()
                    if not row:
                        self._send(404, json.dumps({"error": "gallery not found"}).encode())
                        return
                    fields = []
                    vals: list = []
                    if "galleryKey" in data:
                        new_key = str(data.get("galleryKey") or "").strip() or "default"
                        dup = con.execute(
                            "SELECT id FROM gallery WHERE page_id = ? AND gallery_key = ? AND id != ?",
                            (row["page_id"], new_key, gid),
                        ).fetchone()
                        if dup:
                            self._send(
                                409,
                                json.dumps({"error": "duplicate gallery key on page"}).encode(),
                            )
                            return
                        fields.append("gallery_key = ?")
                        vals.append(new_key)
                    mapping = [
                        ("thumbnail", "thumbnail", int),
                        ("zoom", "zoom", int),
                        ("zoomStyle", "zoom_style", str),
                        ("columnCount", "column_count", int),
                        ("rowCount", "row_count", int),
                        ("galleryStyle", "gallery_style", str),
                        ("thumbnailStyle", "thumbnail_style", str),
                    ]
                    for js_key, sql_key, typ in mapping:
                        if js_key in data:
                            v = data[js_key]
                            if typ is int:
                                v = int(v)
                            elif typ is str:
                                v = str(v)
                            fields.append(f"{sql_key} = ?")
                            vals.append(v)
                    if not fields:
                        self._send(400, json.dumps({"error": "no fields"}).encode())
                        return
                    vals.append(gid)
                    con.execute(
                        f"UPDATE gallery SET {', '.join(fields)} WHERE id = ?",
                        vals,
                    )
                    con.commit()
                    cur = con.execute("SELECT * FROM gallery WHERE id = ?", (gid,))
                    self._send(200, json.dumps({"gallery": _row_to_gallery(cur.fetchone())}).encode())
                finally:
                    con.close()
            except (OSError, sqlite3.Error, ValueError) as e:
                self._send(400, json.dumps({"error": str(e)}).encode())
            return

        if parsed.path == "/api/page":
            pid = int(data.get("id") or 0)
            if not pid:
                self._send(400, json.dumps({"error": "id required"}).encode())
                return
            try:
                con = _connect()
                try:
                    cur = con.execute("SELECT * FROM page WHERE id = ?", (pid,))
                    if not cur.fetchone():
                        self._send(404, json.dumps({"error": "page not found"}).encode())
                        return
                    fields = []
                    vals: list = []
                    if "name" in data:
                        fields.append("name = ?")
                        vals.append(str(data["name"]).strip())
                    if "header" in data:
                        fields.append("header = ?")
                        vals.append(1 if data["header"] else 0)
                    if "footer" in data:
                        fields.append("footer = ?")
                        vals.append(1 if data["footer"] else 0)
                    if not fields:
                        self._send(400, json.dumps({"error": "no fields"}).encode())
                        return
                    vals.append(pid)
                    con.execute(f"UPDATE page SET {', '.join(fields)} WHERE id = ?", vals)
                    con.commit()
                    cur = con.execute("SELECT * FROM page WHERE id = ?", (pid,))
                    self._send(200, json.dumps({"page": _row_to_page(cur.fetchone())}).encode())
                except sqlite3.IntegrityError:
                    self._send(409, json.dumps({"error": "duplicate name"}).encode())
                finally:
                    con.close()
            except (OSError, sqlite3.Error) as e:
                self._send(400, json.dumps({"error": str(e)}).encode())
            return

        if parsed.path == "/api/font":
            fid = int(data.get("id") or 0)
            page_id = int(data.get("pageId") or 0)
            try:
                con = _connect()
                try:
                    if fid:
                        cur = con.execute("SELECT * FROM font WHERE id = ?", (fid,))
                        if not cur.fetchone():
                            self._send(404, json.dumps({"error": "font not found"}).encode())
                            return
                        fields = []
                        vals: list = []
                        if "fontSize" in data:
                            fields.append("font_size = ?")
                            vals.append(int(data["fontSize"]))
                        if "fontFamily" in data:
                            fields.append("font_family = ?")
                            vals.append(str(data["fontFamily"]))
                        if not fields:
                            self._send(400, json.dumps({"error": "no fields"}).encode())
                            return
                        vals.append(fid)
                        con.execute(f"UPDATE font SET {', '.join(fields)} WHERE id = ?", vals)
                        con.commit()
                        cur = con.execute("SELECT * FROM font WHERE id = ?", (fid,))
                        self._send(200, json.dumps({"font": _row_to_font(cur.fetchone())}).encode())
                    elif page_id:
                        cur = con.execute("SELECT * FROM font WHERE page_id = ?", (page_id,))
                        existing = cur.fetchone()
                        fs = int(data.get("fontSize") or 16)
                        ff = str(data.get("fontFamily") or "system-ui, sans-serif")
                        if existing:
                            con.execute(
                                "UPDATE font SET font_size = ?, font_family = ? WHERE page_id = ?",
                                (fs, ff, page_id),
                            )
                        else:
                            con.execute(
                                "INSERT INTO font (page_id, font_size, font_family) VALUES (?, ?, ?)",
                                (page_id, fs, ff),
                            )
                        con.commit()
                        cur = con.execute("SELECT * FROM font WHERE page_id = ?", (page_id,))
                        self._send(200, json.dumps({"font": _row_to_font(cur.fetchone())}).encode())
                    else:
                        self._send(400, json.dumps({"error": "id or pageId required"}).encode())
                finally:
                    con.close()
            except (OSError, sqlite3.Error, ValueError) as e:
                self._send(400, json.dumps({"error": str(e)}).encode())
            return

        if parsed.path == "/api/frame/cell":
            cid = int(data.get("id") or 0)
            if not cid:
                self._send(400, json.dumps({"error": "id required"}).encode())
                return
            try:
                con = _connect()
                try:
                    cur = con.execute("SELECT * FROM frame_cell WHERE id = ?", (cid,))
                    row = cur.fetchone()
                    if not row:
                        self._send(404, json.dumps({"error": "frame cell not found"}).encode())
                        return
                    fields = []
                    vals: list = []
                    if "contentType" in data:
                        ct = str(data.get("contentType") or "empty").strip().lower()
                        if ct not in ("empty", "html", "image", "table", "text"):
                            self._send(400, json.dumps({"error": "invalid contentType"}).encode())
                            return
                        fields.append("content_type = ?")
                        vals.append(ct)
                    if "body" in data:
                        effective_ct = (
                            str(data.get("contentType") or "").strip().lower()
                            if "contentType" in data
                            else str(row["content_type"] or "empty")
                        )
                        if effective_ct == "image":
                            try:
                                body_val = _sanitize_frame_image_body(data.get("body"))
                            except ValueError as e:
                                self._send(400, json.dumps({"error": str(e)}).encode())
                                return
                        else:
                            body_val = str(data.get("body") or "")
                        fields.append("body = ?")
                        vals.append(body_val)
                    if "cellRole" in data:
                        fields.append("cell_role = ?")
                        vals.append(_sanitize_cell_role(str(data.get("cellRole") or "")))
                    if "cellPadding" in data:
                        fields.append("cell_padding = ?")
                        vals.append(_cell_padding_to_db(data.get("cellPadding")))
                    if not fields:
                        if (
                            "textStyle" not in data
                            and "imageStyle" not in data
                            and "cellPadding" not in data
                        ):
                            self._send(400, json.dumps({"error": "no fields"}).encode())
                            return
                        fields = ["css_class = ?", "aria_label = ?"]
                        vals = ["", ""]
                    else:
                        fields.append("css_class = ?")
                        vals.append("")
                        fields.append("aria_label = ?")
                        vals.append("")
                    vals.append(cid)
                    con.execute(
                        f"UPDATE frame_cell SET {', '.join(fields)} WHERE id = ?",
                        vals,
                    )
                    _sync_frame_cell_text(con, cid, data)
                    _sync_frame_cell_image(con, cid, data)
                    con.commit()
                    crow = con.execute("SELECT * FROM frame_cell WHERE id = ?", (cid,)).fetchone()
                    tr = None
                    ir = None
                    if crow and str(crow["content_type"] or "") == "text":
                        tr = con.execute(
                            "SELECT * FROM frame_cell_text WHERE frame_cell_id = ?",
                            (cid,),
                        ).fetchone()
                    if crow and str(crow["content_type"] or "") == "image":
                        ir = con.execute(
                            "SELECT * FROM frame_cell_image WHERE frame_cell_id = ?",
                            (cid,),
                        ).fetchone()
                    self._send(200, json.dumps({"cell": _row_to_frame_cell(crow, tr, ir)}).encode())
                finally:
                    con.close()
            except (OSError, sqlite3.Error, ValueError) as e:
                self._send(400, json.dumps({"error": str(e)}).encode())
            return

        if parsed.path == "/api/frame":
            fid = int(data.get("id") or 0)
            if not fid:
                self._send(400, json.dumps({"error": "id required"}).encode())
                return
            try:
                con = _connect()
                try:
                    cur = con.execute("SELECT * FROM frame WHERE id = ?", (fid,))
                    frow = cur.fetchone()
                    if not frow:
                        self._send(404, json.dumps({"error": "frame not found"}).encode())
                        return
                    cur_c = int(frow["column_count"])
                    cur_r = int(frow["row_count"])
                    fields: list[str] = []
                    vals: list = []
                    if "label" in data:
                        fields.append("label = ?")
                        vals.append(_truncate(str(data.get("label") or ""), 120))
                    if "gridGap" in data:
                        fields.append("grid_gap = ?")
                        vals.append(_grid_gap_to_db(data.get("gridGap")))
                    if "notes" in data:
                        fields.append("notes = ?")
                        vals.append(_truncate(str(data.get("notes") or ""), 4000))
                    if "defaultTextFontFamily" in data:
                        fields.append("default_text_font_family = ?")
                        vals.append(_sanitize_font_family(str(data.get("defaultTextFontFamily") or "")))
                    if "defaultTextFontSize" in data:
                        try:
                            dts = int(data.get("defaultTextFontSize") or 16)
                        except (TypeError, ValueError):
                            dts = 16
                        fields.append("default_text_font_size = ?")
                        vals.append(max(8, min(288, dts)))
                    resize = False
                    new_c, new_r = cur_c, cur_r
                    if "columnCount" in data or "rowCount" in data:
                        if "columnCount" not in data or "rowCount" not in data:
                            self._send(
                                400,
                                json.dumps(
                                    {"error": "send both columnCount and rowCount to resize the grid"},
                                ).encode(),
                            )
                            return
                        new_c = max(1, min(24, int(data["columnCount"])))
                        new_r = max(1, min(24, int(data["rowCount"])))
                        if (new_c, new_r) != (cur_c, cur_r):
                            resize = True
                        fields.append("column_count = ?")
                        vals.append(new_c)
                        fields.append("row_count = ?")
                        vals.append(new_r)
                    if not fields:
                        self._send(400, json.dumps({"error": "no fields"}).encode())
                        return
                    vals.append(fid)
                    con.execute(f"UPDATE frame SET {', '.join(fields)} WHERE id = ?", vals)
                    if resize:
                        con.execute("DELETE FROM frame_cell WHERE frame_id = ?", (fid,))
                        n = new_c * new_r
                        for i in range(n):
                            con.execute(
                                "INSERT INTO frame_cell (frame_id, cell_index, content_type, body) VALUES (?, ?, 'empty', '')",
                                (fid, i),
                            )
                    con.commit()
                    cur = con.execute("SELECT * FROM frame WHERE id = ?", (fid,))
                    frame = _row_to_frame(cur.fetchone())
                    cells = _frame_cells_with_text(con, fid)
                    self._send(200, json.dumps({"frame": frame, "cells": cells}).encode())
                finally:
                    con.close()
            except (OSError, sqlite3.Error, ValueError) as e:
                self._send(400, json.dumps({"error": str(e)}).encode())
            return

        self._send(404, json.dumps({"error": "not found"}).encode())

    def do_DELETE(self) -> None:
        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)
        try:
            if parsed.path == "/api/page":
                pid = int((qs.get("id") or ["0"])[0])
                if not pid:
                    self._send(400, json.dumps({"error": "id required"}).encode())
                    return
                con = _connect()
                try:
                    con.execute("DELETE FROM page WHERE id = ?", (pid,))
                    con.commit()
                    self._send(204, b"")
                finally:
                    con.close()
                return
            if parsed.path == "/api/gallery":
                gid = int((qs.get("id") or ["0"])[0])
                if not gid:
                    self._send(400, json.dumps({"error": "id required"}).encode())
                    return
                con = _connect()
                try:
                    con.execute("DELETE FROM gallery WHERE id = ?", (gid,))
                    con.commit()
                    self._send(204, b"")
                finally:
                    con.close()
                return
        except (OSError, sqlite3.Error, ValueError) as e:
            self._send(400, json.dumps({"error": str(e)}).encode())
            return

        self._send(404, json.dumps({"error": "not found"}).encode())


def main() -> None:
    if not os.path.isfile(DB_PATH):
        sys.stderr.write("Database not found: %s\nRun: python3 lib/db/init_db.py\n" % DB_PATH)
        sys.exit(1)
    server = HTTPServer((HOST, PORT), Handler)
    print("customdev layout API  http://%s:%s  (DB: %s)" % (HOST, PORT, DB_PATH))
    server.serve_forever()


if __name__ == "__main__":
    main()
