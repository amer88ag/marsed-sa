const test = require("node:test");
const assert = require("node:assert/strict");
const Satellite = require("../src/services/satellite/nasa-gibs.js");

test("NASA GIBS tile URLs use the documented Web Mercator tile matrix", () => {
  const url = Satellite.buildTileUrl("viirsTrue", "2026-11-23");
  assert.match(url, /^https:\/\/gibs\.earthdata\.nasa\.gov\/wmts\/epsg3857\/best\//);
  assert.match(url, /VIIRS_SNPP_CorrectedReflectance_TrueColor/);
  assert.match(url, /GoogleMapsCompatible_Level9\/\{z\}\/\{y\}\/\{x\}\.jpg$/);
});

test("supported layers have distinct identifiers and explicit descriptions", () => {
  const ids = Object.values(Satellite.LAYERS).map(layer => layer.id);
  assert.equal(new Set(ids).size, ids.length);
  const falseColor = Satellite.getLayer("modisFalse");
  assert.match(falseColor.title, /ألوان زائفة/);
  assert.match(falseColor.note, /لا يُفسر كصورة/);
  assert.throws(() => Satellite.getLayer("not-a-layer"), /Unsupported/);
});

test("date helpers validate and cross month/year boundaries", () => {
  assert.equal(Satellite.shiftDate("2026-01-02", -1), "2026-01-01");
  assert.equal(Satellite.shiftDate("2026-01-01", -1), "2025-12-31");
  assert.equal(Satellite.validDate("2026-02-30"), false);
  assert.throws(() => Satellite.buildTileUrl("viirsTrue", "not-a-date"), /valid YYYY-MM-DD/);
});

test("Saudi date formatting uses the Riyadh time zone", () => {
  const instant = new Date("2026-11-23T21:30:00.000Z");
  assert.equal(Satellite.saudiDate(instant), "2026-11-24");
});
