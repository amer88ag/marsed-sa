"use strict";
// Real GIBS time domains captured on 2026-11-25 (see fixture for method and limits).
const test = require("node:test");
const assert = require("node:assert/strict");
const Gibs = require("../src/services/satellite/nasa-gibs.js");
const F = require("../src/platform/quality/freshness.js");
const fixture = require("./fixtures/gibs-live-domains-2026-11-25.json");
const periods = id => Gibs.parseAvailablePeriods("<Domain>" + fixture.layers[id].domain + "</Domain>");

test("real domains parse into the advertised number of periods, gaps included", () => {
  for (const [id, layer] of Object.entries(fixture.layers)) assert.equal(periods(id).length, layer.size, id);
  const viirs = periods("VIIRS_SNPP_CorrectedReflectance_TrueColor");
  assert.equal(Gibs.isDateAvailable("2022-08-01", viirs), false, "real gap 2022-07-28..2022-08-09");
  assert.equal(Gibs.isDateAvailable("2026-04-29", viirs), false, "real one-day gap");
  assert.equal(Gibs.adjacentAvailableDate("2026-04-28", viirs, 1), "2026-04-30");
});

test("VIIRS SNPP real latest date is 2026-11-02, shown with its true age", () => {
  const viirs = periods("VIIRS_SNPP_CorrectedReflectance_TrueColor");
  assert.equal(Gibs.latestAvailableOnOrBefore(viirs, "2026-11-25"), "2026-11-02");
  assert.equal(F.satelliteProduct("2026-11-02", new Date("2026-11-25T12:00:00Z")).age_days_utc, 23);
});

test("MODIS Aqua lists a future date; the UTC cap never selects a day that has not started in UTC", () => {
  const aqua = periods("MODIS_Aqua_CorrectedReflectance_TrueColor");
  assert.equal(Gibs.latestAvailableDate(aqua), "2026-11-26", "domain end is in the future");
  // 00:30 Saudi on 26 Nov = 21:30 UTC on 25 Nov.
  const now = new Date("2026-11-25T21:30:00Z");
  assert.equal(Gibs.saudiDate(now), "2026-11-26", "Saudi date is already the 26th");
  assert.equal(Gibs.productDateCap(now), "2026-11-25");
  assert.equal(Gibs.latestAvailableOnOrBefore(aqua, Gibs.productDateCap(now)), "2026-11-25");
  assert.equal(Gibs.latestAvailableOnOrBefore(aqua, Gibs.saudiDate(now)), "2026-11-26", "control: the old Saudi cap would pick a future UTC day");
});

test("pages cap GIBS dates with the UTC product date, not the Saudi date", () => {
  const fs = require("node:fs");
  for (const file of ["satellite/index.html", "satellite/coverage.html"]) {
    const page = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(page, /NasaGibsSatellite\.saudiDate\(/, file);
    assert.match(page, /NasaGibsSatellite\.productDateCap\(new Date\(\)\)/, file);
  }
});
