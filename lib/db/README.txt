SQLite store: lib/db/customdev.db (layout SSOT)

Tables (see schema.sql):

  page
    id            INTEGER PRIMARY KEY
    name          TEXT NOT NULL UNIQUE          — page slug from URL (see identity below)
    header        INTEGER NOT NULL 0|1          — show header (app-defined)
    footer        INTEGER NOT NULL 0|1          — show footer (app-defined)

  gallery
    id              INTEGER PRIMARY KEY
    page_id         INTEGER NOT NULL → page(id) ON DELETE CASCADE
    gallery_key     TEXT NOT NULL DEFAULT 'default' — multiple galleries per page
    thumbnail       INTEGER NOT NULL 0|1        — thumbnail strip on
    zoom            INTEGER NOT NULL 0|1        — zoom UI on
    zoom_style      TEXT                        — e.g. bookflip, crossfade (maps to gallery zoom-image transition)
    column_count    INTEGER                     — zoom-open grid column count (≥2)
    row_count       INTEGER                     — reserved / future grid rows
    gallery_style   TEXT                        — optional token → root class draggable-gallery--layout-g-<token>
    thumbnail_style TEXT                        — optional token; values fill / cover set thumb fill mode
    UNIQUE (page_id, gallery_key)

  font
    id           INTEGER PRIMARY KEY
    page_id      INTEGER NOT NULL UNIQUE → page(id) ON DELETE CASCADE — one typography row per page
    font_size    INTEGER NOT NULL
    font_family  TEXT NOT NULL

Identity (for GET /api/layout and gallery init):

  page name — from the URL path’s last segment without .html (e.g. /pages/farewell-mr-fuji.html → farewell-mr-fuji; / or /index.html → index). Implemented in js/web-dev-base/gallery-layout-from-db.js as pageNameFromPathname().

  gallery key — from the gallery root element: data-gallery-key="..." if set, otherwise default. Implemented as galleryKeyFromRoot() (default default).

Build / refresh the database file (drops existing file, applies schema, seeds demo pages + default galleries):

  python3 lib/db/init_db.py

Requires Python 3 (stdlib sqlite3 only).

Local layout API (read/write this DB during staging):

  npm run dev:api
  # or: python3 server/dev_api.py

  Binds 127.0.0.1:8787 by default (CUSTOMDEV_API_PORT / CUSTOMDEV_API_HOST). Database path: CUSTOMDEV_DB or lib/db/customdev.db.

  Endpoints: GET /api/layout?page=<name>&galleryKey=<key>, GET /api/registry, GET /api/pages, GET /api/galleries?page=..., POST /api/page, POST /api/gallery, PATCH /api/gallery|/api/page|/api/font, DELETE /api/page?id=...& /api/gallery?id=...

Staging in the browser uses this API for the Pages / galleries dialog and for per-gallery layout in the “Gallery testing” panel (see lib/staging/staging.txt).
