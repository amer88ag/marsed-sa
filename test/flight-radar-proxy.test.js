"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const proxy = fs.readFileSync("api/flight-radar.js", "utf8");
const service = fs.readFileSync("src/services/aviation/flight-radar.js", "utf8");

test("flight radar browser service uses same-origin proxy, not cross-origin provider URLs", () => {
  assert.match(service, /\/api\/flight-radar\?provider=/);
  assert.doesNotMatch(service, /http\.request\(A\.buildPointUrl/);
});

test("flight radar proxy allowlists providers and validates coordinates and radius", () => {
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
