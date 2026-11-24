"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Satellite = require("../src/services/satellite/nasa-gibs.js");
const Coverage = require("../src/services/satellite/nasa-gibs-coverage.js");
const Http = require("../src/platform/http/client.js");
const { runPage, flush, deferred } = require("../test-support/dom-harness.js");

test("WMTS daily domain: start, end and gaps are respected", () => {
  const periods = Satellite.parseAvailablePeriods("<Domain>2026-11-01/2026-11-10/P1D,2026-11-15/2026-11-20/P1D</Domain>");
  assert.equal(Satellite.isDateAvailable("2026-11-01", periods), true);
  assert.equal(Satellite.isDateAvailable("2026-10-31", periods), false);
  assert.equal(Satellite.isDateAvailable("2026-11-12", periods), false, "gap");
  assert.equal(Satellite.isDateAvailable("2026-11-21", periods), false);
  assert.equal(Satellite.latestAvailableOnOrBefore(periods, "2026-11-13"), "2026-11-10");
});

test("WMTS interval domain (P8D): only step-aligned dates are available", () => {
  const periods = Satellite.parseAvailablePeriods("<Domain>2026-01-01/2026-12-31/P8D</Domain>");
  assert.equal(Satellite.isDateAvailable("2026-01-09", periods), true);
  assert.equal(Satellite.isDateAvailable("2026-01-10", periods), false, "inside range but off-step");
  assert.equal(Satellite.latestAvailableOnOrBefore(periods, "2026-11-24"), "2026-11-17");
  assert.equal(Satellite.latestAvailableDate(periods), "2026-12-27");
  assert.equal(Satellite.adjacentAvailableDate("2026-11-17", periods, 1), "2026-11-25");
  assert.equal(Satellite.adjacentAvailableDate("2026-11-17", periods, -1), "2026-11-09");
  assert.equal(Satellite.adjacentAvailableDate("2026-11-17", periods, 1, "2026-11-24"), null, "bounded by cap");
});

test("WMTS monthly and yearly steps, sub-daily steps and unknown steps", () => {
  const monthly = Satellite.parseAvailablePeriods("<Domain>2025-01-01/2026-10-01/P1M</Domain>");
  assert.equal(Satellite.isDateAvailable("2026-03-01", monthly), true);
  assert.equal(Satellite.isDateAvailable("2026-03-02", monthly), false);
  assert.equal(Satellite.latestAvailableOnOrBefore(monthly, "2026-11-24"), "2026-10-01");
  const yearly = Satellite.parseAvailablePeriods("<Domain>2020-07-01/2026-07-01/P1Y</Domain>");
  assert.equal(Satellite.isDateAvailable("2023-07-01", yearly), true);
  assert.equal(Satellite.isDateAvailable("2023-08-01", yearly), false);
  const subDaily = Satellite.parseAvailablePeriods("<Domain>2026-11-20/2026-11-22/PT10M</Domain>");
  assert.equal(Satellite.isDateAvailable("2026-11-21", subDaily), true);
  const unknown = Satellite.parseAvailablePeriods("<Domain>2026-11-01/2026-11-30/PXYZ</Domain>");
  assert.equal(Satellite.isDateAvailable("2026-11-15", unknown), false, "unknown step is conservative");
  assert.equal(Satellite.isDateAvailable("2026-11-30", unknown), true);
  assert.equal(Satellite.parseStep("P0D"), null);
});

test("11. unavailable or malformed dates are rejected", () => {
  const periods = Satellite.parseAvailablePeriods("<Domain>2026-11-01/2026-11-10/P1D</Domain>");
  assert.equal(Satellite.isDateAvailable("2026-02-30", periods), false);
  assert.equal(Satellite.isDateAvailable("", periods), false);
  assert.equal(Satellite.latestAvailableOnOrBefore(periods, "2026-10-01"), null);
});

test("GIBS availability request has a timeout and propagates the failure kind", async () => {
  await assert.rejects(Satellite.getAvailableDates("viirsTrue", () => new Promise(() => {}), { timeoutMs: 15 }),
    error => error.kind === "timeout" && /availability request failed/.test(error.message));
});

function rgba(pixels, colour) {
  const data = new Uint8ClampedArray(pixels * 4);
  for (let i = 0; i < pixels; i++) data.set(colour(i), i * 4);
  return data;
}

test("pixel analysis distinguishes valid, partial and blank tiles", () => {
  const varied = rgba(400, i => [(i * 37) % 255, (i * 91) % 255, (i * 13) % 255, 255]);
  assert.equal(Coverage.analyzePixels(varied).content, "valid");
  const black = rgba(400, () => [0, 0, 0, 255]);
  assert.equal(Coverage.analyzePixels(black).content, "blank");
  const transparent = rgba(400, () => [120, 120, 120, 0]);
  assert.equal(Coverage.analyzePixels(transparent).content, "blank");
  const uniformGrey = rgba(400, () => [128, 128, 128, 255]);
  assert.equal(Coverage.analyzePixels(uniformGrey).content, "blank", "uniform colour is not valid imagery");
  const half = rgba(400, i => i < 200 ? [0, 0, 0, 255] : [(i * 37) % 255, (i * 91) % 255, 90, 255]);
  assert.equal(Coverage.analyzePixels(half).content, "partial");
  assert.throws(() => Coverage.analyzePixels([1, 2]), /RGBA/);
});

function canvasReturning(data, options) {
  return () => ({
    getContext() {
      return {
        drawImage() {},
        getImageData() {
          if (options && options.tainted) { const e = new Error("tainted"); e.name = "SecurityError"; throw e; }
          return { data };
        }
      };
    }
  });
}
class LoadedImage { set src(value) { this.url = value; queueMicrotask(() => this.onload && this.onload()); } }

test("probe reports blank content when the tile loads but holds no imagery", async () => {
  const result = await Coverage.probeImage("https://t.test/1.jpg", LoadedImage, 100, { createCanvas: canvasReturning(rgba(64, () => [0, 0, 0, 255])) });
  assert.equal(result.status, "blank");
  assert.equal(result.contentChecked, true);
});

test("probe reports valid content only after pixel inspection", async () => {
  const result = await Coverage.probeImage("https://t.test/1.jpg", LoadedImage, 100, { createCanvas: canvasReturning(rgba(64, i => [i * 3, i * 2, 200 - i, 255])) });
  assert.equal(result.status, "valid");
});

test("CORS-tainted canvas yields 'loaded' (unverified), never 'valid'", async () => {
  const result = await Coverage.probeImage("https://t.test/1.jpg", LoadedImage, 100, { createCanvas: canvasReturning(null, { tainted: true }) });
  assert.equal(result.status, "loaded");
  assert.equal(result.contentChecked, false);
});

test("CORS-mode load failure retries without CORS and stays unverified", async () => {
  class CorsRefused {
    set src(value) { const cors = this.crossOrigin === "anonymous"; queueMicrotask(() => cors ? this.onerror() : this.onload()); }
  }
  const result = await Coverage.probeImage("https://t.test/1.jpg", CorsRefused, 100, { createCanvas: canvasReturning(rgba(4, () => [9, 9, 9, 255])) });
  assert.equal(result.status, "loaded");
  assert.equal(result.contentChecked, false);
});

test("summary keeps delivered, verified and failed counts distinct", () => {
  const counts = Coverage.summarize([{ status: "valid" }, { status: "blank" }, { status: "loaded" }, { status: "timeout" }, { status: "error" }, { status: "partial" }]);
  assert.deepEqual(counts, { total: 6, valid: 1, partial: 1, blank: 1, unverified: 1, failed: 2, delivered: 4 });
});

// ---- coverage page behaviour -------------------------------------------------
function coverageHarness(availability) {
  const calls = [];
  const SatelliteStub = Object.assign({}, Satellite, {
    saudiDate: () => "2026-11-24",
    getAvailableDates: (key, fetchImpl, options) => { calls.push(key); return availability(key, options); }
  });
  const CoverageStub = Object.assign({}, Coverage, {
    checkPoint: async (key, date, point) => ({ id: point.id, name: point.name, lat: point.lat, lon: point.lon, z: 7, x: 1, y: 1, url: "u", status: key === "modisAquaTrue" ? "blank" : "valid" })
  });
  const page = runPage("satellite/coverage.html", {
    NasaGibsSatellite: SatelliteStub, NasaGibsCoverage: CoverageStub, HttpClient: Http, Image: function () {}
  }, { values: { layer: "viirsTrue" } });
  return Object.assign(page, { calls });
}
const domain = periods => async () => ({ periods: Satellite.parseAvailablePeriods("<Domain>" + periods + "</Domain>"), latestDate: null });

test("four-layer scan: one layer failing does not fail the others, and the summary survives the date refresh", async () => {
  const page = coverageHarness(key => key === "modisTerraTrue"
    ? Promise.reject(new Error("HTTP 500"))
    : domain("2026-11-01/2026-11-23/P1D")());
  await flush();
  assert.equal(page.$("imageDate").value, "2026-11-23");
  await page.$("runAll").fire("click");
  await flush(); await flush();
  const summary = page.$("status").textContent;
  assert.match(summary, /اكتمل فحص الطبقات/);
  assert.match(summary, /تعذر فحص 1 طبقة/);
  assert.match(summary, /محتوى صالح 38 · جزئية 0 · فارغة 19/, "2 valid layers + 1 blank layer, 19 points each");
  // The trailing refreshDates() must not overwrite the scan summary.
  assert.match(page.$("dateStatus").textContent, /أحدث تاريخ متاح/);
  assert.equal(page.$("status").textContent, summary);
  assert.equal(page.$("runAll").disabled, false);
  assert.equal(page.$("layer").disabled, false);
  const pills = page.$("summary").children.map(child => child.textContent);
  assert.equal(pills.length, 4);
  assert.ok(pills.some(text => /MODIS Terra — ألوان طبيعية: تعذر الفحص/.test(text)));
  assert.ok(pills.some(text => /MODIS Aqua.*فارغة 19/.test(text)));
});

test("12. coverage page rejects a run on a date that is in range but off-step", async () => {
  const page = coverageHarness(domain("2026-01-01/2026-11-24/P8D"));
  await flush();
  assert.equal(page.$("imageDate").value, "2026-11-17", "latest aligned date, not period end");
  page.$("imageDate").value = "2026-11-18";
  await page.$("imageDate").fire("change");
  assert.equal(page.$("run").disabled, true);
  await page.$("run").fire("click");
  assert.match(page.$("status").textContent, /لا يوافق خطوتها الزمنية/);
});

test("14. coverage buttons re-enable after the date request times out", async () => {
  const pending = deferred();
  const page = coverageHarness(() => pending.promise);
  await flush();
  assert.equal(page.$("run").disabled, true);
  const timeout = new Error("NASA GIBS date availability request failed (timeout)"); timeout.kind = "timeout";
  pending.reject(timeout);
  await flush();
  assert.match(page.$("dateStatus").textContent, /تعذر التحقق من نطاق التواريخ/);
  assert.equal(page.$("runAll").disabled, false);
  assert.equal(page.$("layer").disabled, false);
});
