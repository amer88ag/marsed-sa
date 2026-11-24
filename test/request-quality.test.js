"use strict";
// Quality matrix for external requests: success, HTTP, JSON, network, timeout,
// cancellation, stale responses, missing values and length mismatches.
const test = require("node:test");
const assert = require("node:assert/strict");
const Http = require("../src/platform/http/client.js");
const Weather = require("../src/services/weather/service.js");
const Routing = require("../src/services/routing/service.js");
const Precipitation = require("../src/services/precipitation/service.js");
const OpenMeteo = require("../src/providers/weather/open-meteo/adapter.js");

const ok = body => async () => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const hanging = () => (url, init) => new Promise((resolve, reject) => {
  if (init && init.signal) init.signal.addEventListener("abort", () => {
    const error = new Error("aborted"); error.name = "AbortError"; reject(error);
  });
});

test("1. success: JSON body is returned", async () => {
  assert.deepEqual(await Http.request("https://x.test", { fetch: ok({ a: 1 }) }), { a: 1 });
});

test("2. HTTP failure is typed and keeps the status", async () => {
  await assert.rejects(Http.request("https://x.test", { fetch: async () => ({ ok: false, status: 503 }) }),
    error => error.kind === "http" && error.status === 503 && /HTTP 503/.test(error.message));
});

test("3. invalid JSON is typed as json", async () => {
  await assert.rejects(Http.request("https://x.test", {
    fetch: async () => ({ ok: true, json: async () => { throw new SyntaxError("Unexpected token <"); } })
  }), error => error.kind === "json");
});

test("4. network failure is typed as network", async () => {
  await assert.rejects(Http.request("https://x.test", { fetch: async () => { throw new TypeError("Failed to fetch"); } }),
    error => error.kind === "network" && /Failed to fetch/.test(error.message));
});

test("5. timeout aborts the underlying request and rejects within the bound", async () => {
  let receivedSignal = null;
  const started = Date.now();
  await assert.rejects(Http.request("https://x.test", {
    timeoutMs: 20,
    fetch: (url, init) => { receivedSignal = init.signal; return hanging()(url, init); }
  }), error => error.kind === "timeout");
  assert.ok(Date.now() - started < 1000);
  assert.equal(receivedSignal.aborted, true);
});

test("5b. timeout is enforced even if fetch ignores AbortSignal", async () => {
  await assert.rejects(Http.request("https://x.test", { timeoutMs: 15, fetch: () => new Promise(() => {}) }),
    error => error.kind === "timeout");
});

test("6. caller cancellation rejects as aborted (before and during the request)", async () => {
  const before = new AbortController(); before.abort();
  await assert.rejects(Http.request("https://x.test", { signal: before.signal, fetch: ok({}) }), error => error.kind === "aborted");
  const during = new AbortController();
  const pending = Http.request("https://x.test", { signal: during.signal, timeoutMs: 5000, fetch: hanging() });
  during.abort();
  await assert.rejects(pending, error => error.kind === "aborted");
  assert.equal(Http.isAbortError({ kind: "aborted" }), true);
});

test("7. latest-request tracker cancels the previous request and marks it stale", async () => {
  const tracker = Http.createLatestTracker();
  const first = tracker.start();
  const second = tracker.start();
  assert.equal(first.signal.aborted, true);
  assert.equal(first.isCurrent(), false);
  assert.equal(second.isCurrent(), true);
  tracker.cancel();
  assert.equal(second.signal.aborted, true);
  assert.equal(second.isCurrent(), false);
});

test("describeError gives an Arabic reason for every failure kind", () => {
  for (const kind of ["timeout", "aborted", "http", "json", "network"]) {
    assert.match(Http.describeError({ kind, message: "HTTP 500" }), /[؀-ۿ]/, kind);
  }
});

test("services forward signal and timeout to the shared client", async () => {
  let seenSignal = null;
  const controller = new AbortController();
  await Weather.fetchWeather({ id: "abha", lat: 18, lon: 42 }, {
    adapter: { buildCurrentUrl: () => "https://w.test", normalizeCurrent: p => p },
    signal: controller.signal,
    fetch: async (url, init) => { seenSignal = init.signal; return { ok: true, json: async () => ({}) }; }
  });
  assert.ok(seenSignal, "an AbortSignal reaches fetch");
  await assert.rejects(Routing.fetchRoute({ lat: 24, lon: 46 }, { lat: 21, lon: 39 }, {
    adapter: { buildRouteUrl: () => "https://r.test", normalizeRoute: p => p }, timeoutMs: 10, fetch: () => new Promise(() => {})
  }), error => error.kind === "timeout");
  await assert.rejects(Precipitation.fetchDataset("https://c.test", { fetch: async () => { throw new TypeError("offline"); } }),
    error => error.kind === "network");
});

test("8. missing values stay null in every Open-Meteo normalizer", () => {
  const current = OpenMeteo.normalizeCurrent({
    current: { temperature_2m: null }, daily: { time: ["2026-11-24"], precipitation_sum: [null] },
    hourly: { time: ["2026-11-24T00:00"], temperature_2m: [null] }
  }, { id: "x", lat: 1, lon: 2 }, "t");
  assert.equal(current.measurements.find(m => m.name === "temperature").value, null);
  assert.equal(current.daily[0].precipitation, null);
  assert.equal(current.hourly[0].temperature, null);
  const overview = OpenMeteo.normalizeOverview({ current: { temperature_2m: null }, daily: { time: ["2026-11-24"], precipitation_sum: [null] } }, { id: "x", lat: 1, lon: 2 }, "t");
  assert.equal(overview.current.temperature, null);
  assert.equal(overview.today.precipitation, null);
});

test("9. array length mismatches are rejected, never padded", () => {
  assert.throws(() => OpenMeteo.normalizeCurrent({ current: {}, daily: { time: ["a", "b"], precipitation_sum: [1] } }, null), /length mismatch/);
  const route = OpenMeteo.normalizeRouteWeatherBatch([{ hourly: { time: ["a", "b"], temperature_2m: [1] } }], [{ id: "p1" }]);
  assert.equal(route[0].hourly, null);
  assert.match(route[0].error, /length mismatch/);
  assert.throws(() => OpenMeteo.normalizeOverviewBatch([{}], [{ id: "a" }, { id: "b" }]), /length mismatch/);
});

test("10. one failing city in a batch does not hide the others", () => {
  const result = OpenMeteo.normalizeOverviewBatch([
    { current: { temperature_2m: 20 }, daily: { time: ["2026-11-24"] } },
    { current: null }
  ], [{ id: "a", lat: 1, lon: 1 }, { id: "b", lat: 2, lon: 2 }], "t");
  assert.equal(result[0].data.current.temperature, 20);
  assert.equal(result[1].data, null);
  assert.ok(result[1].error);
});
