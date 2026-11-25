"use strict";
// Review findings on 83f16b8: unit checks must cover every requested field and
// distinguish verified / mismatch / undeclared; ages must never be misleading.
const test = require("node:test");
const assert = require("node:assert/strict");
const Adapter = require("../src/providers/weather/open-meteo/adapter.js");
const Orchard = require("../src/services/agriculture/orchard-weather.js");
const { payload, runDashboard } = require("../test-support/weather-fixture.js");

function requested() {
  const fields = new Set();
  const urls = [Adapter.buildCurrentUrl({ lat: 1, lon: 1 }), Adapter.buildOverviewUrl({ lat: 1, lon: 1 }), Adapter.buildRouteWeatherBatchUrl([{ lat: 1, lon: 1 }])];
  for (const url of urls) {
    const q = new URL(url).searchParams;
    for (const block of ["current", "hourly", "daily"]) (q.get(block) || "").split(",").filter(Boolean).forEach(f => fields.add(f));
  }
  return [...fields];
}

test("every field the adapter requests has an expected unit (no gaps)", () => {
  const fields = requested();
  assert.equal(fields.length, 46, "requested fields across current/hourly/daily, overview and route");
  const missing = fields.filter(field => !Object.prototype.hasOwnProperty.call(Adapter.FIELD_UNITS, field));
  assert.deepEqual(missing, [], "fields without an expected unit");
  for (const field of ["cape", "freezing_level_height", "boundary_layer_height", "evapotranspiration", "soil_temperature_100_to_255cm",
    "soil_moisture_28_to_100cm", "direct_radiation", "diffuse_radiation", "uv_index", "visibility"]) {
    assert.ok(field in Adapter.FIELD_UNITS, field + " (listed in the review)");
  }
  assert.ok(!Object.keys(Adapter.FIELD_UNITS).some(field => /120m/.test(field)), "120 m removed in 14d2a4d");
});

test("unit status has three outcomes: verified, mismatch, undeclared", () => {
  assert.equal(Adapter.unitStatus({ cape: "J/kg" }, "cape"), "verified");
  assert.equal(Adapter.unitStatus({ cape: "j/kg" }, "cape"), "verified", "case-insensitive");
  assert.equal(Adapter.unitStatus({ cape: "kJ/kg" }, "cape"), "mismatch");
  assert.equal(Adapter.unitStatus({}, "cape"), "undeclared");
  assert.equal(Adapter.unitStatus(null, "cape"), "undeclared");
  assert.equal(Adapter.unitStatus({ weather_code: "wmo code" }, "weather_code"), "verified");
});

test("a missing *_units object is reported as unverified, not as checked", () => {
  const p = payload();
  delete p.current_units; delete p.hourly_units; delete p.daily_units;
  const data = Adapter.normalizeCurrent(p, null, "t");
  assert.equal(data.quality.unit_mismatches.length, 0);
  const unverified = data.quality.unverified_units.map(u => u.scope + ":" + u.field);
  assert.ok(unverified.includes("current:temperature_2m"));
  assert.ok(unverified.includes("hourly:temperature_2m"));
  assert.ok(unverified.includes("daily:precipitation_sum"));
  assert.equal(data.measurements.find(m => m.name === "temperature").unit_status, "undeclared");
  assert.equal(data.measurements.find(m => m.name === "temperature").value, 18.4, "value kept, status flagged");
});

test("per-field outcomes are recorded for previously unchecked fields", () => {
  const p = payload({ current: { cape: 120, boundary_layer_height: 900 }, currentUnits: { cape: "J/kg", boundary_layer_height: "ft" } });
  const data = Adapter.normalizeCurrent(p, null, "t");
  const m = name => data.measurements.find(x => x.name === name);
  assert.equal(m("cape").value, 120);
  assert.equal(m("cape").unit_status, "verified");
  assert.equal(m("boundary_layer_height").value, null, "ft is withheld");
  assert.equal(m("boundary_layer_height").unit_status, "mismatch");
  assert.deepEqual(data.quality.unit_mismatches.map(x => x.field), ["boundary_layer_height"]);
  const route = Adapter.normalizeRouteWeatherBatch([{ hourly: payload().hourly }], [{ id: "p" }], "t");
  assert.ok(route[0].unverified_units.length > 0, "route rows without hourly_units are flagged");
  const overview = Adapter.normalizeOverview({ current: { time: "2026-11-24T23:45", temperature_2m: 20 }, daily: { time: ["2026-11-24"] } }, { id: "a" }, "t");
  assert.ok(overview.quality.unverified_units.some(u => u.field === "temperature_2m"));
});

test("UI reports unverified units next to the data time", async () => {
  const p = payload();
  delete p.current_units;
  const page = await runDashboard("2026-11-24T21:00:00Z", p);
  assert.match(page.$("updated").textContent, /لم يتم التحقق من وحدة \d+ حقلاً \(لم تعلنها الخدمة\)/);
  assert.equal(page.$("temp").textContent, "18.4", "value still shown, with the unverified note");
});

test("no age is shown when the valid time is missing", async () => {
  const p = payload(); delete p.current.time;
  const text = (await runDashboard("2026-11-24T21:00:00Z", p)).$("updated").textContent;
  assert.match(text, /وقت صلاحية البيانات غير متاح؛ لا يمكن حساب عمرها/);
  assert.doesNotMatch(text, /منذ|بعد|أقدم من/);
});

test("no age is shown for a future valid time, only a warning", async () => {
  const text = (await runDashboard("2026-11-24T21:00:00Z", payload({ validTime: "2026-11-25T03:00" }))).$("updated").textContent;
  assert.match(text, /وقت الصلاحية في المستقبل؛ لم يُحسب عمر للبيانات/);
  assert.doesNotMatch(text, /منذ|\(بعد/);
});

test("no age is computed when the provider used a non-Saudi offset", async () => {
  const text = (await runDashboard("2026-11-24T21:00:00Z", payload({ offset: 0, validTime: "2026-11-24T20:45" }))).$("updated").textContent;
  assert.match(text, /بالإزاحة التي أعادتها الخدمة/);
  assert.match(text, /لم يُحسب عمر البيانات/);
  assert.doesNotMatch(text, /منذ|أقدم من/);
});

test("an elevation difference alone is not presented as proof the model is wrong", () => {
  const text = Orchard.elevationContext(2400, 2150).text;
  assert.match(text, /وحده لا يعني أن قيم النموذج خاطئة/);
  assert.doesNotMatch(text, /بيانات الطقس خاطئة|القيم خاطئة\./);
});
