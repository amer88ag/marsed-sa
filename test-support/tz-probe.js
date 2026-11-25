"use strict";
// Run under different TZ values; prints what the dashboard shows for a fixed instant.
const { payload, runDashboard } = require("./weather-fixture.js");
const SaudiTime = require("../src/platform/time/saudi-time.js");
(async () => {
  const page = await runDashboard("2026-11-24T20:50:00Z", payload());
  const hours = (page.$("hourlyForecast").innerHTML.match(/<b>(\d{2}:\d{2})<\/b>/g) || []).map(s => s.slice(3, 8));
  const days = (page.$("dailyForecast").innerHTML.match(/<div class="day"><b>([^<]+)<\/b>/g) || []).map(s => s.replace(/<[^>]+>/g, ""));
  process.stdout.write(JSON.stringify({
    tz: process.env.TZ, hours, days, updated: page.$("updated").textContent,
    saudiDate: SaudiTime.saudiDate(new Date("2026-11-24T21:00:00Z")),
    naiveParse: new Date("2026-11-24T23:00").toISOString()
  }));
})().catch(error => { console.error(error); process.exit(1); });
