// End-to-end acceptance journey in real Chrome with SIMULATED sources (no live network).
// Run from a folder that has playwright and leaflet@1.9.4 installed:
//   REPO=<repo> node journey.js            (mobile 390×844)
//   REPO=<repo> VIEWPORT=desktop node journey.js
// What it proves: the pages wire the services correctly and react to outage,
// recovery and reload as designed. It does NOT prove the live sources work.
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const ROOT = process.env.REPO || path.join(__dirname, "..", "..");
const LD = path.join(process.cwd(), "node_modules/leaflet/dist");
// Units come from the observatory's own unit dictionary so the simulation declares canonical units.
const FIELD_UNITS = require(path.join(ROOT, "src/platform/quality/units.js")).FIELD_UNITS;

// Saudi local "YYYY-MM-DDTHH:MM" rounded down to 15 min, like Open-Meteo current.time.
function saudiNow(offsetH) {
  const d = new Date(Date.now() + 3 * 3600e3 + (offsetH || 0) * 3600e3);
  d.setUTCMinutes(d.getUTCMinutes() - d.getUTCMinutes() % 15, 0, 0);
  return d.toISOString().slice(0, 16);
}
function hours(n) { const t = []; for (let i = -2; i < n - 2; i++) t.push(saudiNow(i).slice(0, 13) + ":00"); return t; }
function days(n, back) { const t = []; for (let i = 0; i < n; i++) t.push(new Date(Date.now() + 3 * 3600e3 + (i - (back || 0)) * 864e5).toISOString().slice(0, 10)); return t; }
const U = { temperature_2m: "°C", apparent_temperature: "°C", relative_humidity_2m: "%", dew_point_2m: "°C", precipitation: "mm", rain: "mm", showers: "mm", wind_speed_10m: "km/h", wind_direction_10m: "°", wind_gusts_10m: "km/h", cloud_cover: "%", pressure_msl: "hPa", surface_pressure: "hPa", visibility: "m", weather_code: "wmo code", precipitation_probability: "%", is_day: "", time: "iso8601", interval: "seconds" };
const DU = { time: "iso8601", weather_code: "wmo code", precipitation_sum: "mm", precipitation_probability_max: "%", temperature_2m_max: "°C", temperature_2m_min: "°C", sunrise: "iso8601", sunset: "iso8601", uv_index_max: "", et0_fao_evapotranspiration: "mm" };

function openMeteo(url, temp) {
  const lats = (url.searchParams.get("latitude") || "").split(",");
  const cur = url.searchParams.get("current"), hr = url.searchParams.get("hourly"), dl = url.searchParams.get("daily");
  const one = () => {
    const o = { latitude: 18.2, longitude: 42.5, elevation: 2150, utc_offset_seconds: 10800, timezone: "Asia/Riyadh" };
    if (cur) {
      o.current = { time: saudiNow(), interval: 900 }; o.current_units = { time: "iso8601", interval: "seconds" };
      for (const k of cur.split(",")) { o.current[k] = k === "temperature_2m" ? temp : k === "pressure_msl" ? 1016.4 : k === "surface_pressure" ? 795.2 : k === "visibility" ? 24000 : k === "weather_code" ? 1 : k === "is_day" ? 1 : 12; o.current_units[k] = FIELD_UNITS[k] !== undefined ? FIELD_UNITS[k] : (U[k] !== undefined ? U[k] : ""); }
    }
    if (hr) { const t = hours(96); o.hourly = { time: t }; o.hourly_units = { time: "iso8601" }; for (const k of hr.split(",")) { o.hourly[k] = t.map((_, i) => k === "precipitation" ? 0 : k === "weather_code" ? 1 : 15 + i % 6); o.hourly_units[k] = FIELD_UNITS[k] !== undefined ? FIELD_UNITS[k] : (U[k] !== undefined ? U[k] : ""); } }
    if (dl) { const archive = url.hostname.startsWith("archive"); const t = archive ? days(7, 9) : days(7); o.daily = { time: t }; o.daily_units = { time: "iso8601" };
      for (const k of dl.split(",")) { o.daily[k] = t.map(() => k === "sunrise" ? t[0] + "T06:20" : k === "sunset" ? t[0] + "T17:30" : k.startsWith("precipitation_sum") ? 0.4 : k === "temperature_2m_min" ? 9 : k === "temperature_2m_max" ? 24 : 5); o.daily_units[k] = FIELD_UNITS[k] !== undefined ? FIELD_UNITS[k] : (DU[k] !== undefined ? DU[k] : ""); }
      if (o.daily.sunrise) { o.daily.sunrise = t.map(d => d + "T06:20"); o.daily.sunset = t.map(d => d + "T17:30"); } }
    return o;
  };
  return lats.length > 1 ? lats.map(one) : one();
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome" });
  const desktop = process.env.VIEWPORT === "desktop";
  const ctx = await browser.newContext(desktop ? { viewport: { width: 1280, height: 800 } } : { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const state = { outage: false, temp: 17.5, calls: 0 };
  await ctx.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.hostname === "local.test") {
      let p = path.join(ROOT, decodeURIComponent(url.pathname)); if (p.endsWith("/")) p += "index.html";
      if (!fs.existsSync(p)) return route.fulfill({ status: 404, body: "nf" });
      const type = p.endsWith(".html") ? "text/html" : p.endsWith(".js") ? "application/javascript" : p.endsWith(".json") ? "application/json" : p.endsWith(".css") ? "text/css" : "text/plain";
      return route.fulfill({ status: 200, contentType: type + "; charset=utf-8", body: fs.readFileSync(p) });
    }
    if (url.hostname === "unpkg.com") { const f = path.join(LD, url.pathname.includes("/images/") ? "images/" + path.basename(url.pathname) : path.basename(url.pathname)); return fs.existsSync(f) ? route.fulfill({ status: 200, contentType: f.endsWith(".css") ? "text/css" : "application/javascript", headers: { "access-control-allow-origin": "*" }, body: fs.readFileSync(f) }) : route.abort(); }
    if (url.hostname.endsWith("open-meteo.com")) {
      state.calls++;
      if (state.outage) return route.abort("internetdisconnected");
      if (url.pathname === "/v1/elevation") return route.fulfill({ json: { elevation: [2210] } });
      return route.fulfill({ json: openMeteo(url, state.temp) });
    }
    if (url.hostname === "router.project-osrm.org") return state.outage ? route.fulfill({ status: 503, body: "down" }) : route.fulfill({ json: { code: "Ok", routes: [{ distance: 950000, duration: 32000, geometry: { coordinates: [[46.67, 24.71], [44, 23.5], [41, 22.4], [39.19, 21.49]] } }] } });
    if (url.hostname === "gibs.earthdata.nasa.gov" && url.pathname.endsWith("wmts.cgi")) return route.fulfill({ contentType: "text/xml", body: "<Domains><DimensionDomain><Domain>2026-01-01/2026-11-23/P1D</Domain></DimensionDomain></Domains>" });
    return route.abort();
  });

  const steps = []; const errors = [];
  const step = async (name, fn) => { let out, ok = true; try { out = await fn(); if (out && out.ok === false) ok = false; } catch (e) { ok = false; out = "FAILED: " + e.message; } steps.push({ step: steps.length + 1, name, ok, detail: typeof out === "object" ? out : String(out).replace(/\s+/g, " ").slice(0, 300) }); };
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push(e.message));
  const text = sel => page.textContent(sel).then(t => (t || "").replace(/\s+/g, " ").trim());
  const check = (cond, detail) => ({ ok: !!cond, detail });

  await step("فتح الموقع", async () => { await page.goto("http://local.test/index.html"); await page.waitForFunction(() => document.getElementById("temp").textContent !== "—"); return check(true, await text("#placeName")); });
  await step("اختيار موقع (أبها)", async () => { await page.selectOption("#place", "abha"); await page.waitForFunction(() => /أبها/.test(document.getElementById("placeName").textContent) && document.getElementById("temp").textContent !== "—"); return check(true, await text("#placeName")); });
  await step("الطقس الحالي + الحالة", async () => { const t = await text("#temp"), s = await page.getAttribute("#dataState", "data-state"); return check(t === "17.5" && s === "fresh", { temp: t, state: s, label: await text("#dataState") }); });
  await step("الرطوبة والرياح والرؤية", async () => check(await text("#visibility") === "24.0", { humidity: await text("#humidity"), wind: await text("#wind"), visibility: await text("#visibility") }));
  await step("الارتفاع", async () => check(/2150/.test(await text("#elevation")), await text("#elevation")));
  await step("الضغط (مستوى البحر/السطح)", async () => check(/1016/.test(await text("#pressureMsl")) && /795/.test(await text("#surfacePressure")), { msl: await text("#pressureMsl"), surface: await text("#surfacePressure") }));
  await step("مقارنة المدن", async () => { await page.waitForFunction(() => document.querySelectorAll("#compareBody tr").length >= 13); return check(true, (await page.$$eval("#compareBody tr", r => r.length)) + " صفاً"); });
  await step("الأمطار التاريخية CHIRPS + التحليل", async () => { await page.waitForFunction(() => document.getElementById("chirpsAnalysis").textContent.length > 20); const a = await text("#chirpsAnalysis"); return check(/لا يُحسب مجموع/.test(a), a.slice(0, 200)); });
  await step("رحلة", async () => { await page.click("#planTrip"); await page.waitForFunction(() => /ارتفاع التضاريس/.test(document.getElementById("tripOutput").innerHTML)); return check(true, (await text("#tripStatus")).slice(0, 120)); });

  await step("انقطاع المصدر → بيانات محفوظة موسومة", async () => {
    state.outage = true; state.temp = 99; await page.click("#refresh");
    await page.waitForFunction(() => !/جارٍ/.test(document.getElementById("loading").textContent) && document.getElementById("dataState").getAttribute("data-state") !== "fresh", null, { timeout: 15000 });
    const s = await page.getAttribute("#dataState", "data-state"), t = await text("#temp");
    return check(s === "cached" && t === "17.5", { state: s, temp: t, label: await text("#dataState") });
  });
  await step("رحلة أثناء انقطاع OSRM", async () => { await page.click("#planTrip"); await page.waitForFunction(() => /ليست مسار طريق/.test(document.getElementById("tripOutput").innerHTML), null, { timeout: 15000 }); return check(true, (await text("#tripOutput")).slice(0, 140)); });
  await step("إعادة التحميل أثناء الانقطاع (من التخزين المحلي)", async () => {
    await page.reload(); await page.waitForFunction(() => /cached|stale|unavailable|source_error/.test(document.getElementById("dataState").getAttribute("data-state")), null, { timeout: 20000 });
    const s = await page.getAttribute("#dataState", "data-state");
    return check(s === "cached", { state: s, temp: await text("#temp"), label: await text("#dataState") });
  });
  await step("التعافي", async () => {
    state.outage = false; state.temp = 18.25; await page.click("#refresh");
    await page.waitForFunction(() => document.getElementById("dataState").getAttribute("data-state") === "fresh", null, { timeout: 15000 });
    return check(await text("#temp") === "18.3", { temp: await text("#temp"), state: await page.getAttribute("#dataState", "data-state") });
  });

  await step("الأقمار الصناعية", async () => { await page.goto("http://local.test/satellite/index.html"); await page.waitForTimeout(800); const v = await page.inputValue("#imageDate"); return check(/^\d{4}-\d{2}-\d{2}$/.test(v), v); });
  await step("المواسم + الفصول الفلكية", async () => { await page.goto("http://local.test/seasons/index.html"); await page.waitForTimeout(500); const h = await text("#astroTitle"), cards = await page.$$eval("#astroGrid article", a => a.length), cur = await text("#currentName"); return check(cards === 4 && /\d{4}/.test(h), { title: h, cards, folkSeason: cur }); });
  await step("التقويم الزراعي", async () => { const r = await text("#farmAdvice").catch(() => ""); return check(r.length > 0, r.slice(0, 160)); });
  await step("مساعد البستان", async () => {
    await page.fill("#orchardLat", "18.2164"); await page.fill("#orchardLon", "42.5053"); await page.fill("#farmElevation", "2400");
    await page.click("#loadOrchardWeather");
    await page.waitForFunction(() => /اكتمل|تعذر/.test(document.getElementById("orchardWeatherStatus").textContent), null, { timeout: 15000 });
    return check(/اكتمل/.test(await text("#orchardWeatherStatus")), (await text("#orchardWeatherStatus")).slice(0, 160));
  });

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  console.log(JSON.stringify({ viewport: desktop ? "1280x800" : "390x844", simulated: true, passed: steps.filter(s => s.ok).length, total: steps.length, pageErrors: errors, lastPageOverflowPx: overflow, steps }, null, 1));
  await browser.close();
  process.exit(steps.every(s => s.ok) && !errors.length ? 0 : 1);
})();
