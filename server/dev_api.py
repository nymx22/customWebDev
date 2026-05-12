#!/usr/bin/env python3
"""
Local layout API for customdev — reads/writes lib/db/customdev.db (SQLite SSOT).
Bind 127.0.0.1 only. Run: python3 server/dev_api.py
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DB_PATH = os.environ.get("CUSTOMDEV_DB", os.path.join(REPO_ROOT, "lib", "db", "customdev.db"))
HOST = os.environ.get("CUSTOMDEV_API_HOST", "127.0.0.1")
PORT = int(os.environ.get("CUSTOMDEV_API_PORT", "8787"))


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
                    for p in pages:
                        pid = p["id"]
                        for r in con.execute(
                            "SELECT * FROM gallery WHERE page_id = ? ORDER BY gallery_key",
                            (pid,),
                        ):
                            galleries.append(_row_to_gallery(r))
                    self._send(200, json.dumps({"pages": pages, "galleries": galleries}).encode())
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
