const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const page = fs.readFileSync("seasons/index.html", "utf8");

test("orchard weather section requests exact farm coordinates and labels data provenance", () => {
  for (const id of ["orchardLat", "orchardLon", "loadOrchardWeather", "orchardForecast", "orchardHistory"]) {
    assert.ok(page.includes('id="' + id + '"'), id);
  }
  assert.match(page, /توقع نموذجي/);
  assert.match(page, /إعادة تحليل/);
  assert.match(page, /ليست قياسات محطة أرضية/);
  assert.match(page, /لا تتوفر في هذا المسار حالياً أمطار فعلية مقاسة/);
});

test("orchard weather service is loaded before the page controller", () => {
  assert.ok(page.indexOf('src="../src/services/agriculture/orchard-weather.js"') < page.indexOf("(function(){"));
  // Fetching moved into the service (independent forecast/reanalysis via Promise.allSettled).
  assert.match(page, /OrchardWeather\.fetchOrchardData/);
  const service = fs.readFileSync("src/services/agriculture/orchard-weather.js", "utf8");
  assert.match(service, /Promise\.allSettled/);
  assert.match(service, /buildForecastUrl\(location\)/);
  assert.match(service, /buildArchiveUrl\(location/);
});

test("all inline page scripts remain syntactically valid", () => {
  const scripts = [...page.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1].trim()).filter(Boolean);
  for (const script of scripts) new vm.Script(script, { filename: "seasons/index.html" });
});
