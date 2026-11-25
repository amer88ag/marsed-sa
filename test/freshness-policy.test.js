"use strict";
// Owner decisions 2026-11-25: per-type freshness policies; no 120 m wind request.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const F = require("../src/platform/quality/freshness.js");
const Adapter = require("../src/providers/weather/open-meteo/adapter.js");
const { payload, runDashboard } = require("../test-support/weather-fixture.js");

test("current weather: 90-minute operational threshold measured from valid time", () => {
  assert.equal(F.POLICY.current_weather.max_age_minutes, 90);
  assert.match(F.POLICY.current_weather.basis, /قابل للمراجعة/);
  const now = new Date("2026-11-24T21:00:00Z"); // 00:00 Saudi
  assert.equal(F.currentWeather("2026-11-24T22:30", now).status, "fresh", "exactly 90 min");
  assert.equal(F.currentWeather("2026-11-24T22:29", now).status, "stale", "91 min");
});

test("forecasts are never stale because time passed since fetching", () => {
  const rows = [{ valid_date: "2026-11-26" }, { valid_date: "2026-11-24" }, { valid_date: null }, { valid_date: "2026-11-25" }];
  const fetchedLongAgo = new Date("2026-11-20T00:00:00Z");
  const w = F.forecastWindow(rows, "valid_date", fetchedLongAgo);
  assert.equal(w.status, "not_applicable");
  assert.equal(w.valid_from, "2026-11-24");
  assert.equal(w.valid_to, "2026-11-26");
  assert.equal(w.fetched_at, "2026-11-20T00:00:00.000Z");
  assert.equal(F.forecastWindow([], "valid_date").valid_from, null);
});

test("satellite age uses the product's UTC date, not the Saudi date of page load", () => {
  // 00:30 Saudi on 25 Nov is still 24 Nov in UTC: a 24 Nov product is 0 days old.
  const justAfterSaudiMidnight = new Date("2026-11-24T21:30:00Z");
  assert.equal(F.satelliteProduct("2026-11-24", justAfterSaudiMidnight).age_days_utc, 0);
  assert.equal(F.satelliteProduct("2026-11-23", justAfterSaudiMidnight).age_days_utc, 1);
  assert.equal(F.satelliteProduct(null, justAfterSaudiMidnight).status, "unknown");
  assert.doesNotMatch(F.POLICY.satellite_imagery.basis, /90/);
});

test("CHIRPS staleness follows the monthly final release cycle (third week + 7 days)", () => {
  assert.equal(F.chirpsExpectedLatest(new Date("2026-11-27T12:00:00Z")), "2026-09-30", "before day 28: month M-2");
  assert.equal(F.chirpsExpectedLatest(new Date("2026-11-28T00:00:00Z")), "2026-10-31", "from day 28: month M-1");
  assert.equal(F.chirpsExpectedLatest(new Date("2027-01-10T00:00:00Z")), "2026-11-30", "year wrap");
  assert.equal(F.chirpsExpectedLatest(new Date("2027-03-28T00:00:00Z")), "2027-02-28", "short month");
  const behind = F.chirpsSample("2026-09-03", new Date("2026-11-25T12:00:00Z"));
  assert.deepEqual([behind.status, behind.days_behind, behind.expected_latest], ["behind_release_cycle", 27, "2026-09-30"]);
  const current = F.chirpsSample("2026-09-30", new Date("2026-11-25T12:00:00Z"));
  assert.equal(current.status, "current_for_cycle");
  assert.equal(F.chirpsSample("bad", new Date()).status, "unknown");
  assert.match(F.POLICY.chirps_final.basis, /الأسبوع الثالث من الشهر التالي/);
});

test("dashboard forecast caption shows validity window and fetch time, with no stale flag", async () => {
  const page = await runDashboard("2026-11-25T09:00:00Z", payload({ validTime: "2026-11-25T11:45" }));
  const caption = page.$("chartCaption").textContent;
  assert.match(caption, /صلاحية التوقع: 2026-11-24 إلى 2026-11-26 بتوقيت السعودية · جُلب 12:00/);
  assert.doesNotMatch(caption, /أقدم|⚠️/);
});

test("120 m wind is no longer requested or emitted", () => {
  const hourly = new URL(Adapter.buildCurrentUrl({ lat: 24.7, lon: 46.7 })).searchParams.get("hourly").split(",");
  assert.ok(!hourly.some(field => /120m/.test(field)), "not requested");
  assert.ok(hourly.includes("wind_speed_80m") && hourly.includes("wind_speed_100m"), "80/100 m kept");
  const data = Adapter.normalizeCurrent(payload(), null, "t");
  assert.ok(!data.hourly.some(row => "wind_speed_120m" in row || "wind_direction_120m" in row), "not emitted");
  assert.doesNotMatch(fs.readFileSync("src/providers/weather/open-meteo/adapter.js", "utf8"), /120m/);
});
