"use strict";
// Offline tests of tools/live-check with a scripted fetch. They prove the tool's
// logic and classification; they are NOT live checks.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Live = require("../tools/live-check/live-check.js");
const Adapter = require("../src/providers/weather/open-meteo/adapter.js");
const Units = require("../src/platform/quality/units.js");

const NOW = new Date("2026-11-25T12:00:00Z"); // 15:00 Saudi
const unitsFor = fields => Object.fromEntries(fields.map(f => [f, Units.FIELD_UNITS[f]]));
const requested = (url, block) => (new URL(url).searchParams.get(block) || "").split(",").filter(Boolean);

function hourly(fields, start, hours) {
  const time = [];
  for (let i = 0; i < hours; i++) time.push(new Date(Date.parse(start) + i * 3600e3 + 3 * 3600e3).toISOString().slice(0, 16));
  const out = { time };
  fields.forEach(f => { out[f] = time.map(() => 1); });
  return out;
}

function forecastPayload(url) {
  const cur = requested(url, "current"), hr = requested(url, "hourly"), dl = requested(url, "daily");
  const current = { time: "2026-11-25T15:00", interval: 900 };
  cur.forEach(f => { current[f] = 1; });
  const daily = { time: ["2026-11-25"] };
  dl.forEach(f => { daily[f] = f === "sunrise" || f === "sunset" ? ["2026-11-25T06:20"] : [1]; });
  return { utc_offset_seconds: 10800, timezone: "Asia/Riyadh", elevation: 612, current_units: Object.assign({ time: "iso8601", interval: "seconds" }, unitsFor(cur)),
    current, hourly_units: unitsFor(hr), hourly: hourly(hr, "2026-11-25T00:00:00Z", 24 * 7), daily_units: unitsFor(dl), daily };
}

function response(status, body, headers) {
  const h = new Map(Object.entries(headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  return { ok: status >= 200 && status < 300, status, headers: { get: k => h.has(k.toLowerCase()) ? h.get(k.toLowerCase()) : null },
    json: async () => typeof body === "string" ? JSON.parse(body) : body, text: async () => typeof body === "string" ? body : JSON.stringify(body) };
}

// A healthy world; `overrides(url)` may return a replacement response or throw.
function world(overrides) {
  return async (url, init) => {
    const custom = overrides && overrides(url, init);
    if (custom) return custom;
    const u = new URL(url);
    if (u.hostname === "api.open-meteo.com" && u.pathname === "/v1/elevation") return response(200, { elevation: [612] });
    if (u.hostname === "api.open-meteo.com") {
      if (u.searchParams.get("latitude").includes(",")) {
        const hr = requested(url, "hourly");
        const one = { utc_offset_seconds: 10800, hourly_units: unitsFor(hr), hourly: hourly(hr, "2026-11-25T00:00:00Z", 24 * 4) };
        return response(200, [one, one]);
      }
      return response(200, forecastPayload(url));
    }
    if (u.hostname === "archive-api.open-meteo.com") {
      return response(200, { daily_units: { temperature_2m_min: "°C", temperature_2m_max: "°C", precipitation_sum: "mm" },
        daily: { time: ["2026-11-18", "2026-11-24"], temperature_2m_min: [10, null], temperature_2m_max: [25, null], precipitation_sum: [0, null] } });
    }
    if (u.hostname === "data.chc.ucsb.edu") return response(200, "");
    if (u.hostname === "gibs.earthdata.nasa.gov" && u.pathname.endsWith("wmts.cgi")) {
      return response(200, "<Domains><Domain>2026-01-01/2026-11-26/P1D</Domain></Domains>");
    }
    if (u.hostname === "gibs.earthdata.nasa.gov") return response(200, "", { "content-type": "image/jpeg", "access-control-allow-origin": "*" });
    if (u.hostname === "router.project-osrm.org") {
      return response(200, { code: "Ok", routes: [{ distance: 947985, duration: 37374, geometry: { type: "LineString", coordinates: [[46.6753, 24.7136], [39.1925, 21.4858]] } }] });
    }
    throw new Error("unexpected URL " + url);
  };
}

test("a healthy world is fully verified (exit 0)", async () => {
  const report = await Live.runChecks({ fetch: world(), now: NOW });
  assert.deepEqual(report.results.filter(r => r.status !== "verified").map(r => r.id + ": " + r.evidence + " " + (r.problems || []).join("; ")), []);
  assert.equal(report.summary.total, 11);
  assert.equal(report.exitCode, 0);
  assert.match(Live.render(report), /RESULT: ALL VERIFIED/);
  assert.match(report.results.find(r => r.id === "GB-modisAquaTrue").evidence, /selected 2026-11-25 \(UTC cap 2026-11-25\)/, "future domain end not selected");
});

test("undeclared or mismatched units are findings", async () => {
  const report = await Live.runChecks({ now: NOW, fetch: world(url => {
    const u = new URL(url);
    if (u.hostname === "api.open-meteo.com" && u.pathname === "/v1/forecast" && !u.searchParams.get("latitude").includes(",")) {
      const p = forecastPayload(url);
      delete p.current_units.temperature_2m;
      p.hourly_units.wind_speed_10m = "m/s";
      return response(200, p);
    }
  }) });
  const om1 = report.results.find(r => r.id === "OM1");
  assert.equal(om1.status, "failed_verification");
  assert.ok(om1.problems.some(p => /current\.temperature_2m: undeclared/.test(p)));
  assert.ok(om1.problems.some(p => /hourly\.wind_speed_10m: mismatch/.test(p)));
  assert.equal(report.exitCode, 1);
});

test("wrong offset, interval or stale data are findings", async () => {
  const report = await Live.runChecks({ now: NOW, fetch: world(url => {
    const u = new URL(url);
    if (u.hostname === "api.open-meteo.com" && u.pathname === "/v1/forecast" && !u.searchParams.get("latitude").includes(",")) {
      const p = forecastPayload(url);
      p.utc_offset_seconds = 0; p.current.interval = 3600; p.current.time = "2026-11-25T09:00";
      return response(200, p);
    }
  }) });
  const problems = report.results.find(r => r.id === "OM1").problems.join(" | ");
  assert.match(problems, /utc_offset_seconds = 0/);
  assert.match(problems, /current\.interval = 3600/);
  assert.match(problems, /is stale/);
});

test("a missing CHIRPS file for the expected day challenges the release-cycle margin", async () => {
  const report = await Live.runChecks({ now: NOW, fetch: world(url => new URL(url).hostname === "data.chc.ucsb.edu" ? response(404, "") : null) });
  const sat = report.results.find(r => r.id === "CH-sat");
  assert.equal(sat.status, "failed_verification");
  assert.match(sat.evidence, /chirps-v3\.0\.sat\.2026\.09\.30\.tif → 404/);
  assert.match(sat.problems[0], /optimistic/);
});

test("GIBS tiles without CORS headers are reported, not hidden", async () => {
  const report = await Live.runChecks({ now: NOW, fetch: world(url => {
    const u = new URL(url);
    if (u.hostname === "gibs.earthdata.nasa.gov" && !u.pathname.endsWith("wmts.cgi")) return response(200, "", { "content-type": "image/jpeg" });
  }) });
  const viirs = report.results.find(r => r.id === "GB-viirsTrue");
  assert.equal(viirs.status, "failed_verification");
  assert.match(viirs.problems[0], /no usable Access-Control-Allow-Origin/);
});

test("unreachable sources are inconclusive (exit 2), never counted as service failures", async () => {
  const report = await Live.runChecks({ now: NOW, timeoutMs: 50, fetch: world(url => {
    const host = new URL(url).hostname;
    if (host === "data.chc.ucsb.edu") throw new TypeError("getaddrinfo ENOTFOUND");
    if (host === "router.project-osrm.org") return new Promise(() => {});
  }) });
  assert.equal(report.results.find(r => r.id === "CH-sat").status, "unreachable");
  assert.equal(report.results.find(r => r.id === "OS1").status, "unreachable");
  assert.equal(report.summary.failed_verification + report.summary.service_error, 0);
  assert.equal(report.exitCode, 2);
  assert.match(Live.render(report), /says nothing about the service itself/);
});

test("HTTP errors and invalid bodies are service errors", async () => {
  const report = await Live.runChecks({ now: NOW, fetch: world(url => {
    const u = new URL(url);
    if (u.hostname === "api.open-meteo.com" && u.pathname === "/v1/elevation") return response(503, {});
    if (u.hostname === "archive-api.open-meteo.com") return { ok: true, status: 200, headers: { get: () => null }, json: async () => { throw new SyntaxError("bad"); } };
  }) });
  assert.equal(report.results.find(r => r.id === "OM3").status, "service_error");
  assert.equal(report.results.find(r => r.id === "OM2").status, "service_error");
  assert.equal(report.exitCode, 1);
});

test("the live tool uses the same URL builders as the application and the CHIRPS extractor", () => {
  const src = fs.readFileSync("tools/live-check/live-check.js", "utf8");
  assert.match(src, /Adapter\.buildCurrentUrl/);
  assert.match(src, /Orchard\.buildArchiveUrl/);
  assert.match(src, /Adapter\.buildRouteWeatherBatchUrl/);
  assert.match(src, /Gibs\.getAvailableDates/);
  assert.match(src, /Osrm\.buildRouteUrl/);
  const py = fs.readFileSync("scripts/chirps_extract.py", "utf8").match(/return f"(https:[^"]+)"/)[1];
  assert.equal(py.replace("{product}", "sat").replace("{day.year}", "2026").replace("{product}", "sat").replace("{day:%Y.%m.%d}", "2026.09.30"), Live.chirpsUrl("sat", "2026-09-30"));
  assert.ok(Adapter.buildCurrentUrl);
});
