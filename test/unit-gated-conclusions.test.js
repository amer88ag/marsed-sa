"use strict";
// Values whose unit is not verified may be displayed, but must never feed advice
// or indicators presented as reliable (review of 206df97).
const test = require("node:test");
const assert = require("node:assert/strict");
const Units = require("../src/platform/quality/units.js");
const Adapter = require("../src/providers/weather/open-meteo/adapter.js");
const Orchard = require("../src/services/agriculture/orchard-weather.js");
const { payload, runDashboard } = require("../test-support/weather-fixture.js");

const hot = extra => payload(Object.assign({ current: { apparent_temperature: 41, wind_speed_10m: 40 },
  currentUnits: { apparent_temperature: "°C", wind_speed_10m: "km/h", weather_code: "wmo code" } }, extra || {}));

test("adapter and orchard share one unit policy module", () => {
  assert.equal(Adapter.FIELD_UNITS, Units.FIELD_UNITS);
  assert.equal(Units.fieldVerified({ unit_mismatches: [], unverified_units: [] }, "daily", "x"), true);
  assert.equal(Units.fieldVerified({ unit_mismatches: [], unverified_units: [{ scope: "daily", field: "x" }] }, "daily", "x"), false);
  assert.equal(Units.fieldVerified(null, "daily", "x"), false);
});

test("dashboard advice uses verified values", async () => {
  const p = hot(); p.daily_units.precipitation_probability_max = "%";
  const text = (await runDashboard("2026-11-24T21:00:00Z", p)).$("weatherInsight").textContent;
  assert.match(text, /الحرارة المحسوسة مرتفعة/);
  assert.match(text, /الرياح نشطة/);
  assert.doesNotMatch(text, /لعدم التحقق من وحدتها/);
});

test("dashboard advice ignores values with undeclared units and says so", async () => {
  const p = hot();
  delete p.current_units.apparent_temperature;
  delete p.current_units.wind_speed_10m;
  const page = await runDashboard("2026-11-24T21:00:00Z", p);
  const text = page.$("weatherInsight").textContent;
  assert.doesNotMatch(text, /الحرارة المحسوسة مرتفعة/, "41 with an unverified unit is not judged as hot");
  assert.doesNotMatch(text, /الرياح نشطة/);
  assert.match(text, /لم تُستخدم \d+ قيمة في هذا الملخص لعدم التحقق من وحدتها/);
  assert.match(page.$("feels").textContent, /^41(\.0)?$/, "the value is still displayed");
});

test("orchard rows carry unit status; verified rows produce indicators", () => {
  const p = { daily_units: { temperature_2m_min: "°C", temperature_2m_max: "°C", precipitation_sum: "mm", et0_fao_evapotranspiration: "mm" },
    daily: { time: ["2026-11-25"], temperature_2m_min: [-3], temperature_2m_max: [20], precipitation_sum: [0], et0_fao_evapotranspiration: [6] } };
  const { rows, quality } = Orchard.normalizeDailyWithQuality(p);
  assert.equal(rows[0].unit_status.min, "verified");
  assert.equal(quality.unit_mismatches.length, 0);
  const alerts = Orchard.evaluate(rows, "")[0].alerts;
  assert.ok(alerts.some(a => a.type === "cold" && a.level === "high"));
  assert.ok(alerts.some(a => a.type === "water"));
});

test("orchard never judges values whose units are undeclared", () => {
  const p = { daily: { time: ["2026-11-25"], temperature_2m_min: [-3], temperature_2m_max: [44], precipitation_sum: [0], et0_fao_evapotranspiration: [9] } };
  const { rows, quality } = Orchard.normalizeDailyWithQuality(p);
  assert.equal(rows[0].min, -3, "value kept for display");
  assert.ok(quality.unverified_units.length >= 4);
  const alerts = Orchard.evaluate(rows, "flower")[0].alerts;
  assert.ok(!alerts.some(a => ["cold", "heat", "water", "stage"].includes(a.type)), JSON.stringify(alerts.map(a => a.type)));
  const note = alerts.find(a => a.type === "unit");
  assert.ok(note, "an explicit note replaces the indicators");
  assert.match(note.text, /لعدم التحقق من وحدة القيم: الصغرى، العظمى، الهطول، ET₀/);
});

test("orchard withholds mismatched units entirely", () => {
  const p = { daily_units: { temperature_2m_min: "°F", temperature_2m_max: "°C" }, daily: { time: ["2026-11-25"], temperature_2m_min: [26], temperature_2m_max: [80] } };
  const { rows, quality } = Orchard.normalizeDailyWithQuality(p);
  assert.equal(rows[0].min, null, "°F value is not shown under °C");
  assert.equal(rows[0].max, 80);
  assert.equal(quality.unit_mismatches[0].declared, "°F");
  assert.ok(Orchard.evaluate(rows, "")[0].alerts.some(a => a.type === "heat"), "verified max still evaluated");
});

test("orchard fetch exposes unit quality on each source", async () => {
  const fetch = async url => ({ ok: true, json: async () => url.includes("archive")
    ? { daily: { time: ["2026-11-18"], temperature_2m_min: [5] } }
    : { daily_units: { temperature_2m_min: "°C" }, daily: { time: ["2026-11-25"], temperature_2m_min: [5] } } });
  const data = await Orchard.fetchOrchardData({ lat: 18.2, lon: 42.5 }, { fetch, endDate: "2026-11-24" });
  assert.equal(data.forecast.quality.unverified_units.length, 0);
  assert.equal(data.archive.quality.unverified_units[0].field, "temperature_2m_min");
  assert.equal(data.archive.source.unit_quality, data.archive.quality);
});
