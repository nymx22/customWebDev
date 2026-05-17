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

-- Site "frame": one rectangular grid per page (text/HTML, images, empty spacers). Not the image-strip gallery.
CREATE TABLE IF NOT EXISTS frame (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id INTEGER NOT NULL UNIQUE REFERENCES page (id) ON DELETE CASCADE,
  column_count INTEGER NOT NULL DEFAULT 4 CHECK (column_count >= 1 AND column_count <= 24),
  row_count INTEGER NOT NULL DEFAULT 2 CHECK (row_count >= 1 AND row_count <= 24),
  -- Short name for staging label (e.g. "home"); shown as pageName / label in the UI.
  label TEXT NOT NULL DEFAULT '',
  -- Grid spacing: JSON `{"topPct","rightPct","bottomPct","leftPct"}` (0–50) or legacy CSS `gap` string.
  grid_gap TEXT NOT NULL DEFAULT '',
  -- Optional freeform note for authors (not rendered on the live site).
  notes TEXT NOT NULL DEFAULT '',
  -- Default typography for new / reset text cells (staging + apply when adding text).
  default_text_font_family TEXT NOT NULL DEFAULT '',
  default_text_font_size INTEGER NOT NULL DEFAULT 16 CHECK (default_text_font_size >= 8 AND default_text_font_size <= 288)
);

CREATE TABLE IF NOT EXISTS frame_cell (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  frame_id INTEGER NOT NULL REFERENCES frame (id) ON DELETE CASCADE,
  cell_index INTEGER NOT NULL CHECK (cell_index >= 0),
  content_type TEXT NOT NULL DEFAULT 'empty' CHECK (content_type IN ('empty', 'html', 'image', 'table', 'text')),
  body TEXT NOT NULL DEFAULT '',
  -- Space-separated extra classes on the cell mount (sanitized in the API).
  css_class TEXT NOT NULL DEFAULT '',
  -- Optional accessible name for the cell region.
  aria_label TEXT NOT NULL DEFAULT '',
  -- Optional author label for staging (e.g. "projects", "footer"); not rendered on the public page.
  cell_role TEXT NOT NULL DEFAULT '',
  -- CSS padding on the cell mount (all content types), e.g. "12px" or "8px 16px".
  cell_padding TEXT NOT NULL DEFAULT '',
  UNIQUE (frame_id, cell_index)
);

CREATE INDEX IF NOT EXISTS idx_frame_cell_frame ON frame_cell (frame_id);

-- Styled plain text for a frame cell (`content_type` = `text`). Body stays on `frame_cell.body`.
CREATE TABLE IF NOT EXISTS frame_cell_text (
  frame_cell_id INTEGER PRIMARY KEY REFERENCES frame_cell (id) ON DELETE CASCADE,
  font_family TEXT NOT NULL DEFAULT '',
  font_size INTEGER NOT NULL DEFAULT 16 CHECK (font_size >= 8 AND font_size <= 288),
  line_height_pct INTEGER NOT NULL DEFAULT 100 CHECK (line_height_pct >= 50 AND line_height_pct <= 250),
  padding TEXT NOT NULL DEFAULT '',
  nav_url TEXT NOT NULL DEFAULT '',
  nav_label TEXT NOT NULL DEFAULT '',
  -- JSON array: [{ "type": "text", "value": "…", "href": "…" }, …]
  body_blocks TEXT NOT NULL DEFAULT '',
  -- JSON: underline, colorInherit, color, hoverUnderline, hoverColorInherit, hoverColor
  link_style TEXT NOT NULL DEFAULT ''
);

-- Image layout for a frame cell (`content_type` = `image`). Body stays URL on `frame_cell.body`.
CREATE TABLE IF NOT EXISTS frame_cell_image (
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
  link_href TEXT NOT NULL DEFAULT '',
  -- Uniform scale within the cell mount (25–250, default 100 = 100%).
  scale_pct INTEGER NOT NULL DEFAULT 100 CHECK (scale_pct >= 25 AND scale_pct <= 250)
);

-- Typography for a page (one row per page).
CREATE TABLE IF NOT EXISTS font (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id INTEGER NOT NULL UNIQUE REFERENCES page (id) ON DELETE CASCADE,
  font_size INTEGER NOT NULL DEFAULT 16,
  font_family TEXT NOT NULL DEFAULT 'system-ui, sans-serif'
);
