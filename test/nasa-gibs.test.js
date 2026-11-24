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
