#!/usr/bin/env node
/**
 * CI: data/layout/ is deploy truth.
 * 1. Import baked JSON → local customdev.db (setup:layout)
 * 2. export:layout → must not change committed frame JSON (placement + scale)
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dbPath = path.join(root, "lib/db/customdev.db");
const layoutDir = path.join(root, "data/layout/frame");

function run(cmd) {
  execSync(cmd, { cwd: root, stdio: "pipe" });
}

/** @param {string} pageName */
function readBakedFrame(pageName) {
  const p = path.join(layoutDir, `${pageName}.json`);
  if (!fs.existsSync(p)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/** @param {string} pageName */
function readDbFrame(pageName) {
  const sql =
    "SELECT fc.cell_index, fc.content_type, fci.scale_pct, fci.placement_left_pct, fci.placement_top_pct, fcs.width_pct, fcs.height_pct, fcs.size_mode, fcs.width_px, fcs.height_px, fcs.placement_left_pct AS shape_left, fcs.placement_top_pct AS shape_top FROM frame_cell fc JOIN frame f ON f.id = fc.frame_id JOIN page p ON p.id = f.page_id LEFT JOIN frame_cell_image fci ON fci.frame_cell_id = fc.id LEFT JOIN frame_cell_shape fcs ON fcs.frame_cell_id = fc.id WHERE p.name = '" +
    pageName.replace(/'/g, "''") +
    "' ORDER BY fc.cell_index";
  const out = execSync(`sqlite3 -json "${dbPath}" "${sql}"`, { encoding: "utf8" }).trim();
  if (!out) {
    return [];
  }
  return JSON.parse(out);
}

function imageStyleFromBakedCell(cell) {
  const is = cell.imageStyle;
  if (!is || cell.contentType !== "image") {
    return null;
  }
  return {
    scalePct: is.scalePct,
    left: is.placementLeftPct,
    top: is.placementTopPct,
  };
}

function shapeStyleFromBakedCell(cell) {
  const ss = cell.shapeStyle;
  if (!ss || cell.contentType !== "shape") {
    return null;
  }
  return {
    widthPct: ss.widthPct,
    heightPct: ss.heightPct,
    sizeMode: ss.sizeMode,
    widthPx: ss.widthPx,
    heightPx: ss.heightPx,
    left: ss.placementLeftPct,
    top: ss.placementTopPct,
  };
}

/** @param {unknown} a @param {unknown} b */
function eq(a, b) {
  if (a == null && b == null) {
    return true;
  }
  return Number(a) === Number(b) || String(a) === String(b);
}

let failed = 0;

const bakedSnapshots = new Map();
for (const f of fs.readdirSync(layoutDir).filter((n) => n.endsWith(".json"))) {
  bakedSnapshots.set(f, fs.readFileSync(path.join(layoutDir, f), "utf8"));
}

run("npm run setup:layout");
run("npm run export:layout");

for (const [file, before] of bakedSnapshots) {
  const after = fs.readFileSync(path.join(layoutDir, file), "utf8");
  if (before !== after) {
    console.error(
      `layout-export-parity: export changed committed ${file} — run export:layout locally and commit, or fix DB drift`,
    );
    failed++;
  }
}

const pages = [...bakedSnapshots.keys()].map((f) => f.replace(/\.json$/, ""));

for (const page of pages) {
  const baked = readBakedFrame(page);
  const dbRows = readDbFrame(page);
  if (!baked || !Array.isArray(baked.cells)) {
    console.error(`skip ${page}: no baked cells`);
    failed++;
    continue;
  }
  const bakedByIx = new Map(baked.cells.map((c) => [c.cellIndex, c]));

  for (const row of dbRows) {
    const ix = row.cell_index;
    const cell = bakedByIx.get(ix);
    if (!cell) {
      console.error(`${page} cell ${ix}: in DB but missing from baked JSON`);
      failed++;
      continue;
    }
    if (row.content_type === "image") {
      const b = imageStyleFromBakedCell(cell);
      if (
        !eq(row.scale_pct, b?.scalePct) ||
        !eq(row.placement_left_pct, b?.left) ||
        !eq(row.placement_top_pct, b?.top)
      ) {
        console.error(
          `${page} image cell ${ix}: DB scale=${row.scale_pct} @${row.placement_left_pct},${row.placement_top_pct} baked scale=${b?.scalePct} @${b?.left},${b?.top}`,
        );
        failed++;
      }
    }
    if (row.content_type === "shape") {
      const b = shapeStyleFromBakedCell(cell);
      if (
        !eq(row.width_pct, b?.widthPct) ||
        !eq(row.height_pct, b?.heightPct) ||
        !eq(row.size_mode || "keep_ratio", b?.sizeMode || "keep_ratio") ||
        ((row.size_mode || b?.sizeMode) === "fixed_px" &&
          (!eq(row.width_px, b?.widthPx) || !eq(row.height_px, b?.heightPx))) ||
        !eq(row.shape_left, b?.left) ||
        !eq(row.shape_top, b?.top)
      ) {
        console.error(`${page} shape cell ${ix}: DB vs baked mismatch`, row, b);
        failed++;
      }
    }
  }
}

if (failed) {
  console.error(`layout-export-parity: ${failed} problem(s)`);
  process.exit(1);
}
console.log(`layout-export-parity: OK (${pages.length} frame page(s), export idempotent)`);
