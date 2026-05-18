Baked layout JSON (Option B deploy) — generated from lib/db/customdev.db

Regenerate:
  npm run export:layout
  # or after staging Publish (POST /api/export-layout while dev:api runs)

Files:
  manifest.json           — export summary (pages, gallery keys)
  frame/<page>.json       — same shape as GET /api/frame?page=<page>
  gallery/<page>/<key>.json — same shape as GET /api/layout?page=&galleryKey=

Official live (`data-official-live="true"` on <html>) loads these via
js/web-dev-base/layout-baked.js (no layout API on the public host).

Optional override: <meta name="customdev-layout-baked" content="../data/layout">

Deploy: ship static HTML/CSS/JS/assets plus this data/layout/ directory.
