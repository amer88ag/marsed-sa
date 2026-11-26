"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const proxy = fs.readFileSync("api/flight-radar.js", "utf8");
const service = fs.readFileSync("src/services/aviation/flight-radar.js", "utf8");

test("flight radar browser service uses same-origin proxy, not cross-origin provider URLs", () => {
  assert.match(service, /\/api\/flight-radar\?provider=/);
  assert.doesNotMatch(service, /http\.request\(A\.buildPointUrl/);
});

test("flight radar proxy allowlists providers and validates coordinates and radius", () => {
  assert.match(proxy, /opendata\.adsb\.fi/);
  assert.match(proxy, /adsb\.lol/);
  assert.match(proxy, /airplanes\.live/);
  assert.match(proxy, /invalid_provider/);
  assert.match(proxy, /invalid_parameters/);
  assert.match(proxy, /radius > 250/);
});

test("flight radar proxy forwards rate limits and does not expose credentials", () => {
  assert.match(proxy, /Retry-After/);
  assert.match(proxy, /429/);
  assert.doesNotMatch(proxy, /API_KEY|X-Api-Key|Authorization/);
});

test("flight radar proxy rejects non-GET requests and malformed provider payloads", () => {
  assert.match(proxy, /method_not_allowed/);
  assert.match(proxy, /invalid_provider_payload/);
  assert.match(proxy, /AbortSignal\.timeout/);
});


function loadHandler(fetchImpl) {
  const source = proxy.replace("export default async function handler", "module.exports = async function handler");
  const sandbox = { module: { exports: null }, fetch: fetchImpl, AbortSignal, Number, String, Object };
  vm.runInNewContext(source, sandbox, { timeout: 1000 });
  return sandbox.module.exports;
}
function response() {
  const headers = {};
  return {
    headers,
    statusCode: 200,
    setHeader(k, v) { headers[k] = v; return this; },
    status(n) { this.statusCode = n; return this; },
    json(body) { this.body = body; return this; }
  };
}
function request(query, method = "GET") { return { method, query }; }

test("proxy runtime: valid free ADS-B request is forwarded to allowlisted provider", async () => {
  let requested = "";
  const handler = loadHandler(async url => {
    requested = url;
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ ac: [{ hex: "abc123" }] }) };
  });
  const res = response();
  await handler(request({ provider: "adsblol", lat: "24.7136", lon: "46.6753", radius: "54" }), res);
  assert.equal(res.statusCode, 200);
  assert.match(requested, /^https:\/\/api\.adsb\.lol\/v2\/point\/24\.7136\/46\.6753\/54$/);
  assert.equal(res.body.ac[0].hex, "abc123");
  assert.equal(res.headers["X-Flight-Data-Provider"], "adsblol");
  assert.match(res.headers["Cache-Control"], /s-maxage=10/);
});

test("proxy runtime: rejects unsupported method, provider and invalid coordinates", async () => {
  const handler = loadHandler(async () => { throw new Error("must not call upstream"); });
  let res = response();
  await handler(request({}, "POST"), res); assert.equal(res.statusCode, 405);
  res = response(); await handler(request({ provider: "other", lat: 24, lon: 46, radius: 50 }), res); assert.equal(res.statusCode, 400);
  res = response(); await handler(request({ provider: "adsblol", lat: 999, lon: 46, radius: 50 }), res); assert.equal(res.statusCode, 400);
});

test("proxy runtime: forwards upstream rate limit and never switches provider itself", async () => {
  let calls = 0;
  const handler = loadHandler(async () => { calls++; return { ok: false, status: 429, headers: { get: key => key === "Retry-After" ? "90" : null } }; });
  const res = response();
  await handler(request({ provider: "adsblol", lat: 24, lon: 46, radius: 54 }), res);
  assert.equal(res.statusCode, 429); assert.equal(res.headers["Retry-After"], "90");
  assert.equal(res.body.error, "provider_rate_limited"); assert.equal(calls, 1);
});

test("proxy runtime: rejects malformed upstream payload and handles upstream outage", async () => {
  let handler = loadHandler(async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ msg: "bad" }) }));
  let res = response(); await handler(request({ provider: "adsblol", lat: 24, lon: 46, radius: 54 }), res); assert.equal(res.statusCode, 502);
  handler = loadHandler(async () => { throw new Error("offline"); });
  res = response(); await handler(request({ provider: "airplaneslive", lat: 24, lon: 46, radius: 54 }), res); assert.equal(res.statusCode, 502);
  assert.equal(res.body.error, "provider_unreachable");
});


test("proxy runtime: adsb.fi uses its documented public v3 endpoint", async () => {
  let requested = "";
  const handler = loadHandler(async url => {
    requested = url;
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ ac: [] }) };
  });
  const res = response();
  await handler(request({ provider: "adsbfi", lat: "24.7136", lon: "46.6753", radius: "54" }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(requested, "https://opendata.adsb.fi/api/v3/lat/24.7136/lon/46.6753/dist/54");
  assert.deepEqual(Array.from(res.body.ac), []);
});
