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

test("NASA GIBS DescribeDomains requests are scoped to the selected layer and tile matrix", () => {
  const url = new URL(Satellite.describeDomainsUrl("viirsTrue"));
  assert.equal(url.searchParams.get("REQUEST"), "DescribeDomains");
  assert.equal(url.searchParams.get("LAYER"), Satellite.getLayer("viirsTrue").id);
  assert.equal(url.searchParams.get("TILEMATRIXSET"), "GoogleMapsCompatible_Level9");
  assert.throws(() => Satellite.describeDomainsUrl("unknown"), /Unsupported/);
});

test("NASA GIBS time domains preserve gaps and identify the latest available date", () => {
  const xml = '<DimensionDomain><Domain>2026-11-18/2026-11-20/P1D,2026-11-22/2026-11-23/P1D</Domain></DimensionDomain>';
  const periods = Satellite.parseAvailablePeriods(xml);
  assert.equal(periods.length, 2);
  assert.equal(Satellite.latestAvailableDate(periods), "2026-11-23");
  assert.equal(Satellite.isDateAvailable("2026-11-19", periods), true);
  assert.equal(Satellite.isDateAvailable("2026-11-21", periods), false);
  assert.equal(Satellite.isDateAvailable("2026-11-24", periods), false);
});

test("NASA GIBS availability fetch returns actual periods and rejects failed responses", async () => {
  const xml = '<DimensionDomain><Domain>2026-11-21/2026-11-23/P1D</Domain></DimensionDomain>';
  const fetchMock = async (url, options) => {
    assert.match(url, /REQUEST=DescribeDomains/);
    assert.equal(options.headers.Accept, "application/xml, text/xml");
    return { ok: true, text: async () => xml };
  };
  const result = await Satellite.getAvailableDates("modisTerraTrue", fetchMock);
  assert.equal(result.latestDate, "2026-11-23");
  assert.equal(result.periods.length, 1);
  await assert.rejects(
    Satellite.getAvailableDates("modisTerraTrue", async () => ({ ok: false, text: async () => "" })),
    /availability request failed/
  );
  await assert.rejects(
    Satellite.getAvailableDates("modisTerraTrue", async () => ({ ok: true, text: async () => "<broken/>" })),
    /readable time domain/
  );
});


const Coverage = require("../src/services/satellite/nasa-gibs-coverage.js");

test("coverage sample contains 19 valid Saudi city points", () => {
  assert.equal(Coverage.POINTS.length, 19);
  for (const point of Coverage.POINTS) {
    assert.ok(point.id && point.name);
    assert.ok(point.lat >= 16 && point.lat <= 32, point.name);
    assert.ok(point.lon >= 34 && point.lon <= 56, point.name);
    assert.equal(Coverage.tileCoordinates(point.lat, point.lon).z, 7);
  }
});

test("tile coordinate conversion rejects invalid coordinates and zoom levels", () => {
  assert.throws(() => Coverage.tileCoordinates(NaN, 40), /Valid latitude/);
  assert.throws(() => Coverage.tileCoordinates(20, 190), /Valid latitude/);
  assert.throws(() => Coverage.tileCoordinates(20, 40, 10), /Valid latitude/);
});

test("probe URL replaces all Web Mercator placeholders for the selected layer and date", () => {
  const point = Coverage.POINTS.find(item => item.id === "abha");
  const request = Coverage.buildProbeUrl("viirsTrue", "2026-11-24", point, Satellite);
  assert.match(request.url, /VIIRS_SNPP_CorrectedReflectance_TrueColor/);
  assert.match(request.url, /\\/2026-11-24\\/GoogleMapsCompatible_Level9\\/7\\/\\d+\\/\\d+\\.jpg$/);
  assert.equal(request.tile.z, 7);
  assert.ok(!/[{][xyz][}]/.test(request.url));
  assert.throws(() => Coverage.buildProbeUrl("unknown", "2026-11-24", point, Satellite), /Unsupported/);
});

test("image probe resolves loaded and failed images", async () => {
  class LoadedImage {
    set src(value) { this.url = value; this.onload(); }
  }
  class FailedImage {
    set src(value) { this.url = value; this.onerror(); }
  }
  assert.equal((await Coverage.probeImage("https://example.test/tile.jpg", LoadedImage, 50)).status, "loaded");
  assert.equal((await Coverage.probeImage("https://example.test/missing.jpg", FailedImage, 50)).status, "error");
});

test("image probe reports timeout and ignores a late load callback", async () => {
  let lateImage;
  class HangingImage {
    constructor() { lateImage = this; }
    set src(value) { this.url = value; }
  }
  const result = await Coverage.probeImage("https://example.test/slow.jpg", HangingImage, 5);
  assert.equal(result.status, "timeout");
  assert.equal(lateImage.onload, null);
  assert.equal(lateImage.onerror, null);
});

test("checkPoint preserves city metadata, tile coordinates and image delivery status", async () => {
  class LoadedImage {
    set src(value) { this.url = value; this.onload(); }
  }
  const point = Coverage.POINTS.find(item => item.id === "tabuk");
  const result = await Coverage.checkPoint("modisTerraTrue", "2026-11-23", point, Satellite, LoadedImage, 50);
  assert.equal(result.id, "tabuk");
  assert.equal(result.name, "تبوك");
  assert.equal(result.status, "loaded");
  assert.equal(result.z, 7);
  assert.match(result.url, /MODIS_Terra_CorrectedReflectance_TrueColor/);
});
