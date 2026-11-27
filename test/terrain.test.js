const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../src/services/terrain/terrain.js");

const grid = T.gridPoints(18.2, 42.5, 90, 5);
// Elevation field from a function of (row, col); row 0 = north, col 0 = west.
const field = f => ({ elevation: grid.points.map((_, k) => f(Math.floor(k / 5), k % 5)) });

test("grid is 5×5, north row first, centre on the requested point, within the API limit", () => {
  assert.equal(grid.points.length, 25);
  assert.ok(grid.points[0].lat > grid.points[20].lat);
  assert.ok(grid.points[0].lon < grid.points[4].lon);
  assert.ok(Math.abs(grid.points[12].lat - 18.2) < 1e-12 && Math.abs(grid.points[12].lon - 42.5) < 1e-12);
  assert.match(T.buildUrl(grid), /latitude=.*,.*&longitude=/);
  assert.throws(() => T.buildUrl(T.gridPoints(18, 42, 90, 11)), RangeError);
});

test("a plane rising to the north faces south with the expected slope", () => {
  const r = T.analyse(field(row => 1000 + (4 - row) * 9), grid); // 9 m per 90 m → 10 %
  assert.ok(Math.abs(r.slope.slope_pct - 10) < 1e-9);
  assert.ok(Math.abs(r.slope.slope_deg - Math.atan(0.1) * 180 / Math.PI) < 1e-9);
  assert.equal(r.slope.aspect, "جنوب");
  assert.equal(r.flow.label, "نحو الجنوب");
});

test("a plane rising to the west faces east and water flows east", () => {
  const r = T.analyse(field((row, col) => 2000 + (4 - col) * 20), grid);
  assert.equal(r.slope.aspect, "شرق");
  assert.ok(Math.abs(r.slope.aspect_deg - 90) < 1e-9);
  assert.equal(r.flow.label, "نحو الشرق");
});

test("flat ground and pits are reported as such, not given a direction", () => {
  const flat = T.analyse(field(() => 500), grid);
  assert.equal(flat.slope.aspect_deg, null);
  assert.equal(flat.flow.direction, null);
  const pit = T.analyse(field((r, c) => 500 + (Math.abs(r - 2) + Math.abs(c - 2)) * 30), grid);
  assert.equal(pit.flow.direction, null);
  assert.equal(pit.position.class.id, "valley");
});

test("a peak is classified as ridge with its local relief", () => {
  const peak = T.analyse(field((r, c) => 2500 - (Math.abs(r - 2) + Math.abs(c - 2)) * 25), grid);
  assert.equal(peak.position.class.id, "ridge");
  assert.equal(peak.position.relief_m, 100);
  assert.equal(peak.centre_m, 2500);
});

test("mismatched or invalid elevation responses are rejected", () => {
  assert.throws(() => T.analyse({ elevation: [1, 2] }, grid), TypeError);
  assert.throws(() => T.analyse({ elevation: grid.points.map(() => null) }, grid), TypeError);
  assert.throws(() => T.analyse({}, grid), TypeError);
});
