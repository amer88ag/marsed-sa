"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Chirps = require("../src/providers/precipitation/chirps/adapter.js");

// Synthetic multi-period datasets: the committed 3-day sample alone is not enough
// to exercise month/year boundaries, long runs of missing values or product separation.
function dataset(dates, satValue, rnlValue) {
  return {
    schema_version: 1, cities: { abha: { name: "أبها", lat: 18.2164, lon: 42.5053 } },
    spatial_sampling: "nearest grid cell at city coordinates; not city-area mean",
    date_semantics: "daily labels assigned during pentad disaggregation",
    series: {
      sat: { abha: dates.map((date, i) => ({ date, precipitation_mm: satValue(i) })) },
      rnl: { abha: dates.map((date, i) => ({ date, precipitation_mm: rnlValue(i) })) }
    }
  };
}
const span = (start, days) => Array.from({ length: days }, (_, i) => new Date(Date.parse(start + "T00:00:00Z") + i * 86400000).toISOString().slice(0, 10));

for (const [label, start, days] of [["month boundary", "2026-01-28", 7], ["year boundary", "2025-12-29", 6], ["full pentad set (30 days)", "2026-03-01", 30], ["leap day", "2024-02-27", 4]]) {
  test("CHIRPS period: " + label + " keeps every date, value and product identity", () => {
    const dates = span(start, days);
    const data = dataset(dates, i => i % 4 === 0 ? null : i * 0.5, i => i % 5 === 0 ? null : i * 0.25);
    const sat = Chirps.normalizeCitySeries(data, "abha", "sat");
    const rnl = Chirps.normalizeCitySeries(data, "abha", "rnl");
    assert.equal(sat.product_id, "DAILY-SAT-FINAL");
    assert.equal(rnl.product_id, "DAILY-RNL");
    assert.deepEqual(sat.observations.map(o => o.valid_date), dates);
    assert.equal(sat.observations.filter(o => o.value === null).length, Math.ceil(days / 4));
    assert.equal(rnl.observations.filter(o => o.value === null).length, Math.ceil(days / 5));
    assert.ok(sat.observations.every(o => o.unit === "mm/day"));
    assert.notDeepEqual(sat.observations.map(o => o.value), rnl.observations.map(o => o.value), "SAT and RNL are not merged");
  });
}

test("CHIRPS provenance never describes a city point as a city mean or a station", () => {
  const sat = Chirps.normalizeCitySeries(dataset(["2026-01-01"], () => 0, () => 0), "abha", "sat");
  assert.match(sat.provenance.limitations[0], /not a city-area mean or station observation/);
  assert.match(sat.provenance.spatial_sampling, /nearest grid cell/);
});

test("committed CHIRPS sample documents unit, dates, source and sampling method", () => {
  const data = JSON.parse(fs.readFileSync("data/chirps_daily.json", "utf8"));
  assert.equal(data.units, "mm/day");
  assert.ok(data.date_range && data.date_range.start && data.date_range.end);
  assert.match(data.source_url, /chc\.ucsb\.edu/);
  assert.match(data.spatial_sampling, /not city-area mean/);
  // Unit tests on the committed sample prove nothing about the live CHC source.
  assert.ok(data.generated_at_utc);
});
