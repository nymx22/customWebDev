-- customdev layout / typography store (SQLite).
-- Build: python3 lib/db/init_db.py

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS page (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  header INTEGER NOT NULL DEFAULT 1 CHECK (header IN (0, 1)),
  footer INTEGER NOT NULL DEFAULT 1 CHECK (footer IN (0, 1))
);

-- One logical gallery config per (page, gallery_key); gallery_key distinguishes multiple galleries on the same page.
CREATE TABLE IF NOT EXISTS gallery (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id INTEGER NOT NULL REFERENCES page (id) ON DELETE CASCADE,
  gallery_key TEXT NOT NULL DEFAULT 'default',
  thumbnail INTEGER NOT NULL DEFAULT 1 CHECK (thumbnail IN (0, 1)),
  zoom INTEGER NOT NULL DEFAULT 1 CHECK (zoom IN (0, 1)),
  zoom_style TEXT NOT NULL DEFAULT '',
  column_count INTEGER NOT NULL DEFAULT 2,
  row_count INTEGER NOT NULL DEFAULT 1,
  gallery_style TEXT NOT NULL DEFAULT '',
  thumbnail_style TEXT NOT NULL DEFAULT '',
  UNIQUE (page_id, gallery_key)
);

CREATE INDEX IF NOT EXISTS idx_gallery_page ON gallery (page_id);

-- Typography for a page (one row per page).
CREATE TABLE IF NOT EXISTS font (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id INTEGER NOT NULL UNIQUE REFERENCES page (id) ON DELETE CASCADE,
  font_size INTEGER NOT NULL DEFAULT 16,
  font_family TEXT NOT NULL DEFAULT 'system-ui, sans-serif'
);
