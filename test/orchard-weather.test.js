const test = require("node:test");
const assert = require("node:assert/strict");
const OrchardWeather = require("../src/services/agriculture/orchard-weather.js");

test("forecast and archive URLs validate coordinates and use Saudi local time", () => {
  assert.throws(() => OrchardWeather.buildForecastUrl({lat: 100, lon: 40}), /Valid orchard/);
  const forecast = new URL(OrchardWeather.buildForecastUrl({lat: 18.2, lon: 42.5}));
  assert.equal(forecast.searchParams.get("timezone"), "Asia/Riyadh");
  assert.equal(forecast.searchParams.get("forecast_days"), "7");
  const archive = new URL(OrchardWeather.buildArchiveUrl({lat: 18.2, lon: 42.5}, "2026-11-24"));
  assert.equal(archive.searchParams.get("start_date"), "2026-11-17");
  assert.equal(archive.searchParams.get("end_date"), "2026-11-23");
});

test("daily normalization preserves null and rejects mismatched arrays", () => {
  const rows = OrchardWeather.normalizeDaily({daily:{
    time:["2026-11-24"], temperature_2m_min:[null], temperature_2m_max:[34],
    precipitation_sum:[0], precipitation_probability_max:[null], et0_fao_evapotranspiration:[6]
  }});
  assert.equal(rows[0].min, null);
  assert.equal(rows[0].precipitation, 0);
  assert.throws(() => OrchardWeather.normalizeDaily({daily:{time:["a","b"],temperature_2m_min:[1]}}), /length mismatch/);
});

test("risk rules distinguish cold, heat and modeled water-balance signals", () => {
  // Rows as produced by normalizeDaily: every field carries a verified unit status.
  const verified = {min:"verified",max:"verified",precipitation:"verified",precipitationProbability:"verified",et0:"verified"};
  const result = OrchardWeather.evaluate([
    {date:"2026-11-24",min:0,max:41,precipitation:0,et0:7,unit_status:verified},
    {date:"2026-11-25",min:8,max:34,precipitation:2,et0:4,unit_status:verified}
  ], "flower");
  assert.ok(result[0].alerts.some(x => x.type === "cold" && x.level === "high"));
  assert.ok(result[0].alerts.some(x => x.type === "heat" && x.level === "high"));
  assert.ok(result[0].alerts.some(x => x.type === "water"));
  assert.ok(result[0].alerts.some(x => x.type === "stage"));
  assert.equal(result[1].alerts.some(x => x.type === "cold"), false);
});

test("date shifting handles month and year boundaries", () => {
  assert.equal(OrchardWeather.shiftDate("2026-01-03", -7), "2025-12-27");
});
