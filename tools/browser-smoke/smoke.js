const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const ROOT = process.env.REPO || path.join(__dirname, "..", "..");
const leafletDir = path.join(__dirname, "node_modules/leaflet/dist"); // npm i leaflet@1.9.4 in this folder
const png = require("./png.js");
// Synthetic GIBS tiles with KNOWN content, so the pixel analysis runs in real Chrome:
//   VIIRS true colour  → textured image, CORS allowed      → expected "valid"
//   MODIS Terra true   → left half black, CORS allowed     → expected "partial"
//   MODIS Aqua true    → all black, CORS allowed           → expected "blank"
//   MODIS Terra 7-2-1  → textured image, NO CORS header    → expected "loaded" (unverified)
const textured = png(256, 256, (x, y) => [(x * 7 + y * 3) % 256, (x * 2 + y * 9) % 256, (x * y) % 256, 255]);
const halfBlack = png(256, 256, (x, y) => x < 128 ? [0, 0, 0, 255] : [(x * 7 + y * 3) % 256, (y * 5) % 256, 120, 255]);
const black = png(256, 256, () => [0, 0, 0, 255]);
const TILE_SCENARIOS = { VIIRS_SNPP_CorrectedReflectance_TrueColor: [textured, true], MODIS_Terra_CorrectedReflectance_TrueColor: [halfBlack, true],
  MODIS_Aqua_CorrectedReflectance_TrueColor: [black, true], MODIS_Terra_CorrectedReflectance_Bands721: [textured, false] };
const hourly = n => { const t=[],v=[]; const s=Date.now(); for(let i=0;i<n;i++){const d=new Date(s+3*3600e3+(i-2)*3600e3);t.push(d.toISOString().slice(0,13)+":00");v.push(20+i%5)} return {time:t,temperature_2m:v,precipitation_probability:v,precipitation:v.map(()=>0),weather_code:v.map(()=>1),wind_speed_10m:v}; };
(async () => {
  const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome" });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.hostname === "local.test") {
      let p = path.join(ROOT, decodeURIComponent(url.pathname)); if (p.endsWith("/")) p += "index.html";
      if (!fs.existsSync(p)) return route.fulfill({ status: 404, body: "nf" });
      const type = p.endsWith(".html") ? "text/html" : p.endsWith(".js") ? "application/javascript" : p.endsWith(".json") ? "application/json" : "text/plain";
      return route.fulfill({ status: 200, contentType: type + "; charset=utf-8", body: fs.readFileSync(p) });
    }
    if (url.hostname === "unpkg.com") { const f = path.join(leafletDir, url.pathname.includes("/images/") ? "images/"+path.basename(url.pathname) : path.basename(url.pathname)); if (!fs.existsSync(f)) return route.abort(); return route.fulfill({ status: 200, contentType: f.endsWith(".css") ? "text/css" : "application/javascript", body: fs.readFileSync(f) }); }
    if (url.hostname === "api.open-meteo.com" && url.pathname === "/v1/elevation") return route.fulfill({ json: { elevation: [2210] } });
    if (url.hostname.endsWith("open-meteo.com")) {
      const lats = (url.searchParams.get("latitude") || "").split(",");
      const one = { latitude: 18.2, longitude: 42.5, elevation: 2150,
        current: { time: "2026-11-24T23:00", temperature_2m: 15, weather_code: 1, is_day: 0 },
        daily: { time: ["2026-11-24","2026-11-25"], temperature_2m_min:[1,null], temperature_2m_max:[22,23], precipitation_sum:[0,null], precipitation_probability_max:[5,null], et0_fao_evapotranspiration:[4,null] },
        hourly: hourly(96) };
      if (url.searchParams.get("current") && !url.searchParams.get("hourly") && lats.length===1) { one.hourly=undefined; }
      if (url.searchParams.get("hourly") && url.searchParams.get("hourly").startsWith("soil")) one.hourly = undefined;
      if (url.hostname.startsWith("archive")) { one.current=undefined; one.hourly=undefined; one.daily={time:["2026-11-17","2026-11-18"],temperature_2m_min:[4,null],temperature_2m_max:[20,null],precipitation_sum:[0,null]}; }
      if (!url.searchParams.get("current") && url.searchParams.get("hourly") && !url.searchParams.get("daily")) { one.daily=undefined; one.current=undefined; one.hourly = hourly(96); }
      const isMain = url.searchParams.get("current") && url.searchParams.get("current").includes("apparent_temperature");
      if (isMain) { one.daily = {time:["2026-11-24"],weather_code:[1],precipitation_sum:[0],precipitation_probability_max:[5],temperature_2m_max:[22],temperature_2m_min:[10],sunrise:["2026-11-24T06:20"],sunset:["2026-11-24T17:30"],uv_index_max:[5],et0_fao_evapotranspiration:[4]}; one.hourly={time:[]}; }
      return route.fulfill({ json: lats.length > 1 ? lats.map(() => one) : one });
    }
    if (url.hostname === "router.project-osrm.org") return route.fulfill({ json: { code: "Ok", routes: [{ distance: 950000, duration: 32000, geometry: { coordinates: [[46.67,24.71],[44,23.5],[41,22.4],[39.19,21.49]] } }] } });
    // Tiles are deliberately NOT served here: Playwright route.fulfill bypasses CORS,
    // so tile content/CORS behaviour is tested by coverage-real-cors.js instead.
    if (url.hostname === "gibs.earthdata.nasa.gov" && url.pathname.endsWith("wmts.cgi")) return route.fulfill({ contentType: "text/xml", body: "<Domains><DimensionDomain><Domain>2026-01-01/2026-11-23/P1D</Domain></DimensionDomain></Domains>" });
    return route.abort();
  });
  const results = [];
  for (const [name, url, action] of [
    ["dashboard", "http://local.test/index.html", async p => { await p.waitForTimeout(800); await p.click("#planTrip"); await p.waitForTimeout(800); return await p.textContent("#tripStatus"); }],
    ["seasons", "http://local.test/seasons/index.html", async p => { await p.fill("#orchardLat","18.2164"); await p.fill("#orchardLon","42.5053"); await p.fill("#farmElevation","2400"); await p.click("#loadOrchardWeather"); await p.waitForTimeout(800); return (await p.textContent("#orchardWeatherStatus"))+" | "+(await p.textContent("#orchardElevation"))+" | disabled="+(await p.isDisabled("#loadOrchardWeather")); }],
    ["elevation", "http://local.test/elevation/index.html", async p => { await p.fill("#coords","18.2, 42.5"); await p.click("#searchPoint"); await p.waitForTimeout(600); return (await p.textContent("#elevation"))+" | copy disabled="+(await p.isDisabled("#copyResult")); }],
    ["satellite", "http://local.test/satellite/index.html", async p => { await p.waitForTimeout(800); return (await p.inputValue("#imageDate"))+" | "+(await p.textContent("#imageStatus")).slice(0,120); }],
    ["coverage", "http://local.test/satellite/coverage.html", async p => { await p.waitForTimeout(800); await p.click("#runAll"); await p.waitForFunction(() => /اكتمل فحص الطبقات|توقف/.test(document.getElementById("status").textContent), null, { timeout: 60000 });
      const pills = await p.$$eval("#summary .pill", els => els.map(e => e.textContent));
      return "STATUS: " + (await p.textContent("#status")) + " || DATES: " + (await p.textContent("#dateStatus")).slice(0, 80) + " || LAYERS: " + pills.join(" ## "); }],
    ["admin", "http://local.test/admin/index.html", async p => { await p.waitForTimeout(1200); return (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, " ").slice(0, 300); }]
  ]) {
    const page = await ctx.newPage(); const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    page.on("console", m => { if (m.type() === "error" && !/ERR_FAILED|Failed to load resource/.test(m.text())) errors.push(m.text()); });
    await page.goto(url, { waitUntil: "domcontentloaded" });
    let out; try { out = await action(page); } catch (e) { out = "ACTION FAILED " + e.message; }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await page.screenshot({ path: name + ".png", fullPage: false });
    results.push({ name, out: String(out).replace(/\s+/g, " ").slice(0, 4000), errors, overflowPx: overflow });
    await page.close();
  }
  console.log(JSON.stringify(results, null, 1));
  await browser.close();
})();
