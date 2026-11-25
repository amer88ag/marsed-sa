"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Itinerary = require("../src/services/routing/itinerary.js");
const OpenMeteo = require("../src/providers/weather/open-meteo/adapter.js");
const Orchard = require("../src/services/agriculture/orchard-weather.js");
const Http = require("../src/platform/http/client.js");
const { runPage, flush, deferred } = require("../test-support/dom-harness.js");

// ---- route forecast window -------------------------------------------------
function hourlyRows(startLocal, days) {
  const rows = [];
  const start = new Date(startLocal + "T00:00:00+03:00").getTime();
  for (let h = 0; h < days * 24; h++) {
    const local = new Date(start + h * 3600000 + 3 * 3600000).toISOString().slice(0, 16);
    rows.push({ valid_time: local, temperature: 20 });
  }
  return rows;
}

test("forecast_days=2 does NOT cover a 48 h window late in the day", () => {
  const now = new Date("2026-11-24T22:00:00+03:00");
  const twoDays = hourlyRows("2026-11-24", 2);
  const arrival = new Date(now.getTime() + 47 * 3600000);
  assert.equal(Itinerary.weatherAtEta(twoDays, arrival), null, "old request leaves the trip end uncovered");
  assert.ok(Itinerary.forecastCoverageEnd(twoDays) < arrival.getTime());
});

test("requiredForecastDays covers now + 48 h at every hour of the Saudi day", () => {
  for (let minute = 0; minute < 24 * 60; minute += 10) {
    const now = new Date(Date.parse("2026-11-24T00:00:00+03:00") + minute * 60000);
    const days = Itinerary.requiredForecastDays(now);
    assert.ok(days >= 3 && days <= 4, "days " + days);
    assert.ok(days <= OpenMeteo.ROUTE_FORECAST_DAYS_DEFAULT);
    const rows = hourlyRows("2026-11-24", days);
    const windowEnd = new Date(now.getTime() + Itinerary.FORECAST_WINDOW_MS);
    assert.ok(Itinerary.weatherAtEta(rows, windowEnd), "covered at " + now.toISOString());
  }
  assert.throws(() => Itinerary.requiredForecastDays(new Date("invalid")), /valid time/);
});

test("trip arriving near the end of the forecast window gets data; beyond it gets null", () => {
  const now = new Date("2026-11-24T23:50:00+03:00");
  const rows = hourlyRows("2026-11-24", Itinerary.requiredForecastDays(now));
  const plan = Itinerary.resolveDepartureTime("", now, 48 * 3600 - 60);
  assert.ok(Itinerary.weatherAtEta(rows, plan.arrival));
  const beyond = new Date(Itinerary.forecastCoverageEnd(rows) + 60000);
  assert.equal(Itinerary.weatherAtEta(rows, beyond), null, "never extrapolates");
});

test("ETA matching uses the nearest hour within 30 minutes only", () => {
  const rows = [{ valid_time: "2026-11-24T10:00", t: 1 }, { valid_time: "2026-11-24T11:00", t: 2 }, { valid_time: "bad" }];
  assert.equal(Itinerary.weatherAtEta(rows, new Date("2026-11-24T10:20:00+03:00")).t, 1);
  assert.equal(Itinerary.weatherAtEta(rows, new Date("2026-11-24T10:40:00+03:00")).t, 2);
  assert.equal(Itinerary.weatherAtEta(rows, new Date("2026-11-24T11:45:00+03:00")), null);
  assert.equal(Itinerary.weatherAtEta(null, new Date()), null);
});

test("arrival time at route points is proportional to distance and clamped", () => {
  const departure = new Date("2026-11-24T08:00:00+03:00");
  assert.equal(Itinerary.etaAtDistance(departure, 3600, 50, 100).toISOString(), "2026-11-24T05:30:00.000Z");
  assert.equal(Itinerary.etaAtDistance(departure, 3600, 120, 100).toISOString(), "2026-11-24T06:00:00.000Z");
  assert.throws(() => Itinerary.etaAtDistance(departure, 3600, 1, 0), /Valid departure/);
});

// ---- orchard service ---------------------------------------------------------
const forecastPayload = { latitude: 18.2, longitude: 42.5, elevation: 2150, daily: { time: ["2026-11-26", "2026-11-27"], temperature_2m_min: [-1, null], temperature_2m_max: [20, 22], precipitation_sum: [0, null], precipitation_probability_max: [10, null], et0_fao_evapotranspiration: [6, null] } };
const archivePayload = { latitude: 18.2, longitude: 42.5, elevation: 2150, daily: { time: ["2026-11-17", "2026-11-18"], temperature_2m_min: [5, null], temperature_2m_max: [21, null], precipitation_sum: [0, null] } };
const routedFetch = handlers => async url => {
  const handler = url.includes("archive-api") ? handlers.archive : handlers.forecast;
  return handler(url);
};
const jsonResponse = body => ({ ok: true, json: async () => body });

test("orchard: forecast and reanalysis are fetched separately with source, date range and type", async () => {
  const data = await Orchard.fetchOrchardData({ lat: 18.2164, lon: 42.5053 }, {
    endDate: "2026-11-24", retrievedAt: "2026-11-24T20:00:00Z",
    fetch: routedFetch({ forecast: () => jsonResponse(forecastPayload), archive: () => jsonResponse(archivePayload) })
  });
  assert.equal(data.forecast.source.kind, "forecast");
  assert.equal(data.archive.source.kind, "reanalysis");
  assert.equal(data.forecast.source.date_start, "2026-11-25");
  assert.equal(data.archive.source.date_end, "2026-11-18");
  assert.equal(data.forecast.source.model_elevation_m, 2150);
  assert.equal(data.archive.rows[1].min, null, "missing reanalysis stays null");
  assert.equal(data.forecast.rows[1].et0, null);
});

test("orchard: each source can fail independently (HTTP, JSON, timeout)", async () => {
  const httpFail = await Orchard.fetchOrchardData({ lat: 18, lon: 42 }, {
    fetch: routedFetch({ forecast: () => ({ ok: false, status: 502 }), archive: () => jsonResponse(archivePayload) })
  });
  assert.equal(httpFail.forecast.ok, false);
  assert.equal(httpFail.forecast.error.kind, "http");
  assert.equal(httpFail.archive.ok, true);
  const jsonFail = await Orchard.fetchOrchardData({ lat: 18, lon: 42 }, {
    fetch: routedFetch({ forecast: () => jsonResponse(forecastPayload), archive: () => ({ ok: true, json: async () => { throw new SyntaxError("bad"); } }) })
  });
  assert.equal(jsonFail.forecast.ok, true);
  assert.equal(jsonFail.archive.error.kind, "json");
  const timeout = await Orchard.fetchOrchardData({ lat: 18, lon: 42 }, {
    timeoutMs: 15, fetch: routedFetch({ forecast: () => new Promise(() => {}), archive: () => jsonResponse(archivePayload) })
  });
  assert.equal(timeout.forecast.error.kind, "timeout");
  assert.equal(timeout.archive.ok, true);
  const mismatch = await Orchard.fetchOrchardData({ lat: 18, lon: 42 }, {
    fetch: routedFetch({ forecast: () => jsonResponse({ daily: { time: ["a", "b"], temperature_2m_min: [1] } }), archive: () => jsonResponse(archivePayload) })
  });
  assert.match(mismatch.forecast.error.message, /length mismatch/);
});

test("orchard alerts explain basis, limits and source and never compute irrigation", () => {
  const verified = { min: "verified", max: "verified", precipitation: "verified", precipitationProbability: "verified", et0: "verified" };
  const [day] = Orchard.evaluate([{ date: "2026-11-26", min: -1, max: 41, precipitation: 0, et0: 7, unit_status: verified }], "flower", "توقع نموذجي");
  for (const alert of day.alerts) {
    assert.ok(alert.basis && alert.limits && alert.source === "توقع نموذجي", alert.type);
  }
  const cold = day.alerts.find(a => a.type === "cold");
  assert.match(cold.text, /ليس إنذار صقيع/);
  assert.doesNotMatch(cold.text, /احتمال تجمد/);
  const water = day.alerts.find(a => a.type === "water");
  assert.match(water.text, /ليس حساباً لكمية الري/);
  assert.match(water.limits, /لا يحسب المرصد كمية الري/);
});

test("orchard elevation context compares farm and model grid without deriving dates", () => {
  const big = Orchard.elevationContext(2400, 2150);
  assert.equal(big.difference_m, 250);
  assert.equal(big.significant, true);
  assert.match(big.text, /لا يُستنتج من الارتفاع وحده موعد زراعي/);
  assert.equal(Orchard.elevationContext(null, null).available, false);
  assert.equal(Orchard.elevationContext("", 900).farm_m, null);
});

// ---- orchard page behaviour --------------------------------------------------
function seasonsHarness(fetchOrchardData) {
  const OrchardStub = Object.assign({}, Orchard, { fetchOrchardData });
  return runPage("seasons/index.html", { OrchardWeather: OrchardStub, HttpClient: Http },
    { values: { farmMonth: "11", farmRegion: "highland", farmTree: "grape", farmStage: "flower", farmElevation: "2400", orchardLat: "18.2164", orchardLon: "42.5053" } });
}

test("13/14. orchard button re-enables after success, failure, crash and timeout", async () => {
  const cases = {
    success: async () => ({
      forecast: { ok: true, rows: Orchard.normalizeDaily(forecastPayload), source: Orchard.describeSource(forecastPayload, "forecast", Orchard.normalizeDaily(forecastPayload), "2026-11-24T20:00:00Z"), error: null },
      archive: { ok: false, rows: [], source: null, error: Object.assign(new Error("HTTP 500"), { kind: "http" }) }
    }),
    failure: async () => { throw Object.assign(new Error("Network request failed"), { kind: "network" }); },
    crash: async () => ({ forecast: { ok: true, rows: null, source: null }, archive: { ok: false, error: new Error("x") } }),
    timeout: async () => { throw Object.assign(new Error("Request timed out"), { kind: "timeout" }); }
  };
  for (const [name, impl] of Object.entries(cases)) {
    const page = seasonsHarness(impl);
    const click = page.$("loadOrchardWeather").fire("click");
    assert.equal(page.$("loadOrchardWeather").disabled, true, name + " disables while loading");
    await click; await flush();
    assert.equal(page.$("loadOrchardWeather").disabled, false, name + " re-enables");
    if (name === "success") {
      assert.equal(page.$("orchardForecast").children.length, 2);
      assert.match(page.$("orchardForecastSource").textContent, /توقع نموذجي/);
      assert.match(page.$("orchardHistory").textContent, /تعذر تحميل إعادة التحليل/);
      assert.match(page.$("orchardElevation").textContent, /فرق 250 م/);
      assert.match(page.$("orchardWeatherStatus").textContent, /جزئياً/);
    }
    if (name === "timeout") assert.match(page.$("orchardWeatherStatus").textContent, /انتهت مهلة/);
  }
});

test("7. orchard page ignores a stale response that arrives after a newer one", async () => {
  const first = deferred(), second = deferred();
  const queue = [first, second];
  const signals = [];
  const page = seasonsHarness((location, options) => { signals.push(options.signal); return queue.shift().promise; });
  const firstClick = page.$("loadOrchardWeather").fire("click");
  page.$("orchardLat").value = "20.0";
  const secondClick = page.$("loadOrchardWeather").fire("click");
  assert.equal(signals[0].aborted, true, "previous request is cancelled");
  const make = min => ({ forecast: { ok: true, rows: [{ date: "2026-11-26", min, max: 20, precipitation: 0, precipitationProbability: 0, et0: 1 }], source: null }, archive: { ok: false, error: new Error("x") } });
  second.resolve(make(10));
  await secondClick; await flush();
  first.resolve(make(-5));
  await firstClick; await flush();
  const text = JSON.stringify(page.$("orchardForecast").children.map(card => card.children.map(c => c.textContent)));
  assert.match(text, /الصغرى: 10°م/);
  assert.doesNotMatch(text, /-5°م/);
  assert.equal(page.$("loadOrchardWeather").disabled, false);
});
