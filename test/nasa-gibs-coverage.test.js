const test = require("node:test");
const assert = require("node:assert/strict");
const Coverage = require("../src/services/satellite/nasa-gibs-coverage.js");
const Satellite = require("../src/services/satellite/nasa-gibs.js");

test("Saudi sample set spans northern, central, western, southern and eastern locations", () => {
  const ids = Coverage.POINTS.map(point => point.id);
  assert.equal(ids.length, 19);
  assert.equal(new Set(ids).size, ids.length);
  for (const point of Coverage.POINTS) {
    assert.ok(point.lat >= 16 && point.lat <= 32, point.name);
    assert.ok(point.lon >= 34 && point.lon <= 56, point.name);
  }
});

test("Web Mercator tile coordinates are bounded and deterministic", () => {
  const tile = Coverage.tileCoordinates(24.7136, 46.6753, 7);
  assert.equal(tile.z, 7);
  assert.ok(tile.x >= 0 && tile.x < 128);
  assert.ok(tile.y >= 0 && tile.y < 128);
  assert.deepEqual(Coverage.tileCoordinates(24.7136, 46.6753, 7), tile);
  assert.throws(() => Coverage.tileCoordinates(91, 46, 7), /Valid latitude/);
  assert.throws(() => Coverage.tileCoordinates(24, 46, 10), /Valid latitude/);
});

test("probe URL replaces every WMTS tile placeholder with a real sample tile", () => {
  const point = Coverage.POINTS.find(item => item.id === "abha");
  const request = Coverage.buildProbeUrl("viirsTrue", "2026-11-23", point, Satellite);
  assert.match(request.url, /\/GoogleMapsCompatible_Level9\/\d+\/\d+\/\d+\.jpg$/);
  assert.doesNotMatch(request.url, /\{[xyz]\}/);
  assert.equal(request.tile.z, Coverage.ZOOM);
});

test("probeImage reports successful image load without requiring CORS-readable pixels", async () => {
  class LoadedImage {
    set src(value) { this.url = value; queueMicrotask(() => this.onload && this.onload()); }
  }
  const result = await Coverage.probeImage("https://example.test/tile.jpg", LoadedImage, 100);
  assert.equal(result.status, "loaded");
});

test("probeImage reports network errors and bounded timeouts", async () => {
  class FailedImage {
    set src(value) { queueMicrotask(() => this.onerror && this.onerror()); }
  }
  const failed = await Coverage.probeImage("https://example.test/missing.jpg", FailedImage, 100);
  assert.equal(failed.status, "error");
  class StalledImage { set src(value) {} }
  const timedOut = await Coverage.probeImage("https://example.test/stalled.jpg", StalledImage, 5);
  assert.equal(timedOut.status, "timeout");
});
