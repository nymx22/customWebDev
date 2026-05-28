Baked layout JSON — deploy truth (generated from local lib/db/customdev.db)

The database file is NOT in git. Only this directory is shared.

Clone / CI bootstrap:
  npm run setup:layout
  # migrate_schema + import all frame/*.json and gallery/*/*.json into lib/db/customdev.db

Edit without staging GUI:
  1. Edit frame/<page>.json or gallery/<page>/<key>.json
  2. npm run import:layout
  3. Open the page without ?staging=1 (loads baked JSON; same as GitHub Pages)

Edit with staging GUI (placement, scale, gallery layout fields):
  1. npm run dev:api
  2. ?staging=1 on the page — saves to SQLite
  3. npm run export:layout  (or Publish in the toolbar)
  4. git add data/layout/ && commit

Regenerate only:
  npm run export:layout
  # or staging Publish (POST /api/export-layout while dev:api runs)

Files:
  manifest.json           — export summary (pages, gallery keys)
  frame/<page>.json       — same shape as GET /api/frame?page=<page>
  gallery/<page>/<key>.json — same shape as GET /api/layout?page=&galleryKey=

Live preview (no ?staging=1): js/web-dev-base/layout-baked.js — never reads SQLite.

Staging (?staging=1): js/web-dev-base/site-frame.js + gallery-core use the layout API.

Optional override: <meta name="customdev-layout-baked" content="../data/layout">

Deploy: ship static HTML/CSS/JS/assets plus this data/layout/ directory.

Pre-push checklist:
  [ ] npm run export:layout after staging edits
  [ ] npm run test:layout-parity
  [ ] git diff data/layout/ — only intentional changes
