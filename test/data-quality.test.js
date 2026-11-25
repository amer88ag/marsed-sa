"use strict";
// Data-quality audit: units, Saudi time, missing values, freshness, data type and
// provenance shown in the UI, and independence of sources.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const T = require("../src/platform/time/saudi-time.js");
const Catalog = require("../src/platform/quality/indicators.js");
const Adapter = require("../src/providers/weather/open-meteo/adapter.js");
const Orchard = require("../src/services/agriculture/orchard-weather.js");
const Gibs = require("../src/services/satellite/nasa-gibs.js");
const Chirps = require("../src/providers/precipitation/chirps/adapter.js");
const { payload, runDashboard } = require("../test-support/weather-fixture.js");

// ---- Saudi time ------------------------------------------------------------------
test("Saudi midnight: 20:59:59Z is still today, 21:00:00Z is tomorrow", () => {
  assert.equal(T.saudiDate(new Date("2026-11-24T20:59:59Z")), "2026-11-24");
  assert.equal(T.saudiDate(new Date("2026-11-24T21:00:00Z")), "2026-11-25");
  assert.equal(T.saudiDate(new Date("2026-12-31T21:00:00Z")), "2027-01-01", "year boundary");
  assert.equal(T.saudiDate(new Date("2028-02-28T21:00:00Z")), "2028-02-29", "leap day");
  assert.equal(T.saudiClock(new Date("2026-11-24T20:59:00Z")), "23:59");
  assert.equal(T.saudiClock(new Date("2026-11-24T21:00:00Z")), "00:00");
});

test("all services agree on the Saudi date at the midnight boundary", () => {
  for (const [iso, expected] of [["2026-11-24T20:59:59Z", "2026-11-24"], ["2026-11-24T21:00:00Z", "2026-11-25"]]) {
    const now = new Date(iso);
    assert.equal(T.saudiDate(now), expected);
    assert.equal(Gibs.saudiDate(now), expected, "NASA GIBS");
    assert.equal(Orchard.saudiToday(now), expected, "orchard");
  }
  // Orchard reanalysis ends yesterday (Saudi) right after Saudi midnight.
  const url = new URL(Orchard.buildArchiveUrl({ lat: 18.2, lon: 42.5 }, Orchard.saudiToday(new Date("2026-11-24T21:00:00Z"))));
  assert.equal(url.searchParams.get("end_date"), "2026-11-24");
  assert.equal(url.searchParams.get("start_date"), "2026-11-18");
});

test("local provider times are parsed as Saudi time; invalid calendar values are rejected", () => {
  assert.equal(T.parseSaudiLocal("2026-11-24T23:00").toISOString(), "2026-11-24T20:00:00.000Z");
  assert.equal(T.parseSaudiLocal("2026-11-25").toISOString(), "2026-11-24T21:00:00.000Z");
  assert.equal(T.parseSaudiLocal("2026-11-24T20:00:00Z").toISOString(), "2026-11-24T20:00:00.000Z", "explicit Z is absolute");
  for (const bad of ["2026-02-30", "2026-11-24T24:00", "24/11/2026", "", null, 5]) assert.equal(T.parseSaudiLocal(bad), null, String(bad));
  assert.equal(T.saudiWeekday("2026-11-26"), 4, "Thursday");
  assert.equal(T.daysBetween("2026-12-30", "2027-01-02"), 3);
});

test("rendering does not depend on the viewer's device time zone", () => {
  const outputs = ["America/Los_Angeles", "Asia/Riyadh", "Pacific/Kiritimati", "UTC"].map(tz =>
    JSON.parse(execFileSync(process.execPath, ["test-support/tz-probe.js"], { env: Object.assign({}, process.env, { TZ: tz }), encoding: "utf8" })));
  const naive = new Set(outputs.map(o => o.naiveParse));
  assert.ok(naive.size > 1, "control: naive new Date(local) differs by time zone");
  for (const out of outputs) {
    assert.deepEqual(out.hours, ["23:00", "00:00", "01:00", "02:00", "03:00", "04:00", "05:00", "06:00", "07:00"], out.tz);
    assert.deepEqual(out.days, ["اليوم", "غداً", "الخميس"], out.tz);
    assert.equal(out.updated, outputs[0].updated, out.tz);
    assert.equal(out.saudiDate, "2026-11-25", out.tz);
  }
});

test("freshness separates valid time from fetch time and flags stale or future data", () => {
  const now = new Date("2026-11-24T21:00:00Z");
  assert.deepEqual(T.freshness("2026-11-24T23:45", now, 90), { status: "fresh", age_minutes: 15, valid_at: "2026-11-24T20:45:00.000Z" });
  assert.equal(T.freshness("2026-11-24T20:00", now, 90).status, "stale");
  assert.equal(T.freshness("2026-11-24T20:00", now, 90).age_minutes, 240);
  assert.equal(T.freshness("2026-11-25T02:00", now, 90).status, "future");
  assert.equal(T.freshness(null, now).status, "unknown");
  assert.equal(T.ageText(5), "منذ 5 دقائق");
  assert.equal(T.ageText(1440 * 83), "منذ 83 يوماً");
});

// ---- units -------------------------------------------------------------------------
test("declared provider units are checked; a mismatched value is withheld, not mislabelled", () => {
  const data = Adapter.normalizeCurrent(payload({ currentUnits: { temperature_2m: "°F", wind_speed_10m: "m/s" } }), null, "t");
  const value = name => data.measurements.find(m => m.name === name).value;
  assert.equal(value("temperature"), null, "°F value is not shown under °C");
  assert.equal(value("wind_speed"), null, "m/s value is not shown under km/h");
  assert.equal(value("pressure_msl"), 1016.2, "matching units pass");
  assert.deepEqual(data.quality.unit_mismatches.map(m => m.field).sort(), ["temperature_2m", "wind_speed_10m"]);
  const ok = Adapter.normalizeCurrent(payload({ currentUnits: { shortwave_radiation: "W/m2" } }), null, "t");
  assert.equal(ok.quality.unit_mismatches.length, 0, "W/m2 and W/m² are the same unit");
});

test("hourly and daily unit mismatches null whole columns and are reported", () => {
  const p = payload();
  p.hourly_units = { temperature_2m: "K" };
  p.daily_units = { precipitation_sum: "inch" };
  const data = Adapter.normalizeCurrent(p, null, "t");
  assert.ok(data.hourly.every(row => row.temperature === null));
  assert.ok(data.daily.every(row => row.precipitation === null));
  assert.equal(data.quality.unit_mismatches.length, 2);
  const route = Adapter.normalizeRouteWeatherBatch([{ hourly: payload().hourly, hourly_units: { wind_speed_10m: "mph" } }], [{ id: "p" }], "t");
  assert.ok(route[0].hourly.every(row => row.wind_speed === null));
  assert.equal(route[0].unit_mismatches[0].declared, "mph");
});

test("the adapter keeps surface pressure and sea-level pressure distinct", () => {
  const data = Adapter.normalizeCurrent(payload(), null, "t");
  const value = name => data.measurements.find(m => m.name === name).value;
  assert.equal(value("pressure_msl"), 1016.2);
  assert.equal(value("surface_pressure"), 945.1);
  assert.equal(data.valid_interval_seconds, 900);
  assert.equal(data.utc_offset_seconds, 10800);
});

test("catalogue covers every emitted indicator with matching unit, type, source and limits", () => {
  const data = Adapter.normalizeCurrent(payload(), null, "t");
  for (const measurement of data.measurements) {
    const entry = Catalog.get(measurement.name);
    assert.ok(entry, measurement.name + " is catalogued");
    assert.equal(Catalog.canonicalUnit(entry.unit), Catalog.canonicalUnit(measurement.unit), measurement.name);
  }
  const keys = new Set(Catalog.ALL.map(e => e.id));
  assert.equal(keys.size, Catalog.ALL.length, "unique ids");
  for (const entry of Catalog.ALL) {
    for (const field of ["name_ar", "name_en", "unit", "data_type", "source", "time_semantics", "spatial_resolution", "temporal_resolution", "limits"]) {
      assert.ok(entry[field], entry.id + "." + field);
    }
    assert.ok(Catalog.TYPE_LABELS[entry.data_type], entry.id + " type");
  }
  assert.ok(!Catalog.ALL.some(e => /observation|رصد محطة/.test(e.data_type)), "nothing claims to be a station observation");
});

test("easily confused indicators are described as different things", () => {
  const limits = id => Catalog.get(id).limits;
  assert.match(limits("pressure_msl"), /ليست الضغط الفعلي/);
  assert.match(limits("surface_pressure"), /لا يقارن بضغط مستوى البحر/);
  assert.match(limits("temperature"), /ليست حرارة سطح الأرض/);
  assert.match(limits("soil_temperature_0_7cm"), /ليست حرارة الهواء/);
  assert.match(limits("relative_humidity"), /ليست رطوبة التربة/);
  assert.match(limits("soil_moisture_0_7cm"), /ليست الرطوبة النسبية/);
  assert.match(limits("wet_bulb_temperature"), /تختلف عن الحرارة المحسوسة/);
  assert.match(limits("apparent_temperature"), /ليست حرارة البصيلة الرطبة/);
  assert.match(limits("wind_speed"), /تختلف عن رياح 80\/100\/120/);
  assert.match(limits("daily_et0"), /ليست كمية ري/);
  assert.match(limits("precipitation"), /لا مجموع اليوم/);
  assert.equal(Catalog.get("chirps_sat").data_type, "estimate");
  assert.equal(Catalog.get("daily_precipitation_sum").data_type, "forecast");
  assert.match(limits("daily_precipitation_sum"), /لا يقارن مباشرة بتقدير CHIRPS/);
});

// ---- missing and invalid values ----------------------------------------------------
test("null stays null and invalid numbers are rejected everywhere", () => {
  const data = Adapter.normalizeCurrent(payload({ current: { temperature_2m: null } }), null, "t");
  assert.equal(data.measurements.find(m => m.name === "temperature").value, null);
  assert.equal(data.daily[1].precipitation, null);
  assert.equal(data.daily[1].temperature_min, null);
  assert.throws(() => Adapter.normalizeCurrent(payload({ current: { temperature_2m: "NaN" } }), null, "t"), /Invalid numeric/);
  assert.throws(() => Adapter.normalizeCurrent(payload({ current: { temperature_2m: "abc" } }), null, "t"), /Invalid numeric/);
  const dataset = JSON.parse(fs.readFileSync("data/chirps_daily.json", "utf8"));
  dataset.series.sat.abha[0].precipitation_mm = null;
  const chirps = Chirps.normalizeCitySeries(dataset, "abha", "sat");
  assert.equal(chirps.observations[0].value, null, "missing CHIRPS day stays null");
});

// ---- UI: valid time, age, type and source ------------------------------------------
test("UI shows valid time, age, data type and fetch time separately", async () => {
  const page = await runDashboard("2026-11-24T21:00:00Z", payload({ validTime: "2026-11-24T23:45" }));
  const text = page.$("updated").textContent;
  assert.match(text, /صلاحية البيانات: 2026-11-24 23:45 بتوقيت السعودية \(منذ 15 دقيقة\)/);
  assert.match(text, /النوع: ناتج نموذج وليس رصد محطة/);
  assert.match(text, /آخر جلب: 00:00/);
  assert.doesNotMatch(text, /أقدم من المتوقع/);
  assert.equal(page.$("rainLabel").textContent, "الهطول خلال آخر 15 دقيقة");
});

test("UI warns when the data are older than expected, or labelled with another offset", async () => {
  const stale = await runDashboard("2026-11-25T03:00:00Z", payload({ validTime: "2026-11-24T23:45" }));
  assert.match(stale.$("updated").textContent, /منذ 6 ساعات/);
  assert.match(stale.$("updated").textContent, /⚠️ البيانات أقدم من المتوقع/);
  const offset = await runDashboard("2026-11-24T21:00:00Z", payload({ offset: 0 }));
  assert.match(offset.$("updated").textContent, /بإزاحة غير توقيت السعودية/);
  const units = await runDashboard("2026-11-24T21:00:00Z", payload({ currentUnits: { temperature_2m: "°F" } }));
  assert.equal(units.$("temp").textContent, "—");
  assert.match(units.$("updated").textContent, /حُجبت 1 قيمة لاختلاف الوحدة/);
});

test("forecast panel is labelled as a 7-day model forecast and draws missing days as gaps", async () => {
  const html = fs.readFileSync("index.html", "utf8");
  assert.doesNotMatch(html, /7 أيام سابقة/, "past_days=0: no past days are requested");
  assert.match(html, /الأمطار المتوقعة — الأيام السبعة القادمة \(توقع نموذجي\)/);
  assert.equal(new URL(Adapter.buildCurrentUrl({ lat: 1, lon: 1 })).searchParams.get("past_days"), "0");
  const page = await runDashboard("2026-11-24T21:00:00Z", payload());
  const bars = (page.$("rainChart").innerHTML.match(/<rect /g) || []).length;
  assert.equal(bars, 2, "3 days with one null: the null day is not drawn as zero");
  assert.match(page.$("chartCaption").textContent, /لا يقارن مباشرة بتقدير CHIRPS/);
});

test("a stale daily row is not called «اليوم» after Saudi midnight", async () => {
  const page = await runDashboard("2026-11-24T21:10:00Z", payload());
  const days = (page.$("dailyForecast").innerHTML.match(/<div class="day"><b>([^<]+)<\/b>/g) || []).map(s => s.replace(/<[^>]+>/g, ""));
  assert.deepEqual(days, ["الثلاثاء", "اليوم", "غداً"], "row 2026-11-24 is yesterday once it is 00:10 on the 25th");
});

test("weather failure does not block CHIRPS, and CHIRPS shows its age and type", async () => {
  const dataset = JSON.parse(fs.readFileSync("data/chirps_daily.json", "utf8"));
  const page = await runDashboard("2026-11-25T12:00:00Z", Object.assign(new Error("HTTP 503"), { kind: "http" }), {
    precipitation: { fetchDataset: async () => dataset, getCitySeries: (d, c, p) => Chirps.normalizeCitySeries(d, c, p) }
  });
  assert.match(page.$("chirpsState").textContent, /آخر يوم في العينة \(2026-09-03\) منذ 83 يوماً/);
  assert.match(page.$("chirpsState").textContent, /عينة تاريخية وليست بيانات حديثة/);
  assert.match(page.$("chirpsState").textContent, /تقدير من الأقمار الصناعية والمحطات وليس رصداً مباشراً/);
  assert.doesNotMatch(fs.readFileSync("index.html", "utf8"), /تبويب Actions/, "public page does not instruct visitors to run CI");
  assert.match(page.$("loading").textContent + page.$("chartCaption").textContent, /.+/);
});

test("satellite page states data type and product age; elevation states GLO-90 limits", () => {
  const sat = fs.readFileSync("satellite/index.html", "utf8");
  assert.match(sat, /نوع البيانات: صورة أقمار صناعية مرئية/);
  assert.match(sat, /SaudiTime\.daysBetween\(date,SaudiTime\.saudiDate\(new Date\(\)\)\)/);
  const elevation = fs.readFileSync("elevation/index.html", "utf8");
  assert.match(elevation, /GLO-90/);
  assert.match(elevation, /90 متراً/);
  assert.match(elevation, /ليست مسحاً ميدانياً|ليس مسحاً ميدانياً/);
});

test("orchard elevation text reflects what Open-Meteo returns (DEM used for downscaling)", () => {
  const source = Orchard.describeSource({ elevation: 2150, latitude: 18.2, longitude: 42.5 }, "forecast", [], "t");
  assert.match(source.elevation_meaning, /نموذج تضاريس 90 م/);
  const ctx = Orchard.elevationContext(2400, 2150);
  assert.match(ctx.text, /صُحّحت له قيم النموذج/);
  assert.doesNotMatch(ctx.text, /نقطة النموذج/);
});
