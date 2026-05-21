/**
 * Frame placement unit tests (Node). Run: npm test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parsePlacementPct,
  placementFromStyle,
  placementIsActive,
  placementForApi,
} from "../../js/web-dev-base/frame-cell-placement.js";

describe("parsePlacementPct", () => {
  it("clamps to 0–100 and rounds to one decimal", () => {
    assert.equal(parsePlacementPct(50.44), 50.4);
    assert.equal(parsePlacementPct(-5), 0);
    assert.equal(parsePlacementPct(120), 100);
    assert.equal(parsePlacementPct(null), null);
  });
});

describe("placementFromStyle", () => {
  it("requires both axes", () => {
    assert.equal(placementFromStyle({ placementLeftPct: 10 }), null);
    assert.equal(placementFromStyle({ placementTopPct: 20 }), null);
    assert.deepEqual(placementFromStyle({ placementLeftPct: 10, placementTopPct: 20 }), {
      placementLeftPct: 10,
      placementTopPct: 20,
    });
  });

  it("accepts snake_case from API rows", () => {
    assert.deepEqual(
      placementFromStyle({ placement_left_pct: 73.1, placement_top_pct: 74.4 }),
      { placementLeftPct: 73.1, placementTopPct: 74.4 },
    );
  });
});

describe("placementIsActive", () => {
  it("is false when either axis missing", () => {
    assert.equal(placementIsActive({}), false);
    assert.equal(placementIsActive({ placementLeftPct: 50 }), false);
    assert.equal(placementIsActive({ placementLeftPct: 50, placementTopPct: 50 }), true);
  });
});

describe("placementForApi", () => {
  it("clears with null", () => {
    assert.deepEqual(placementForApi(null), {
      placementLeftPct: null,
      placementTopPct: null,
    });
  });
});
