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
  // VIEWPORT=desktop → 1280×800; default mobile 390×844.
  const desktop = process.env.VIEWPORT === "desktop";
  const ctx = await browser.newContext(desktop ? { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 } : { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.hostname === "local.test") {
      let p = path.join(ROOT, decodeURIComponent(url.pathname)); if (p.endsWith("/")) p += "index.html";
      if (!fs.existsSync(p)) return route.fulfill({ status: 404, body: "nf" });
      const type = p.endsWith(".html") ? "text/html" : p.endsWith(".js") ? "application/javascript" : p.endsWith(".json") ? "application/json" : p.endsWith(".css") ? "text/css" : "text/plain";
      return route.fulfill({ status: 200, contentType: type + "; charset=utf-8", body: fs.readFileSync(p) });
    }
    if (url.hostname === "unpkg.com") { const f = path.join(leafletDir, url.pathname.includes("/images/") ? "images/"+path.basename(url.pathname) : path.basename(url.pathname)); if (!fs.existsSync(f)) return route.abort(); return route.fulfill({ status: 200, contentType: f.endsWith(".css") ? "text/css" : "application/javascript", body: fs.readFileSync(f) }); }
    if (url.hostname === "api.open-meteo.com" && url.pathname === "/v1/elevation") { const k = (url.searchParams.get("latitude") || "").split(",").length; return route.fulfill({ json: { elevation: k === 1 ? [2210] : Array.from({ length: k }, (_, i) => 2210 + (4 - Math.floor(i / 5)) * 9) } }); }
    if (url.hostname === "api.open-meteo.com" && url.searchParams.get("models")) {
      // Multi-model mock: suffixed keys per model; GFS deliberately empty to exercise "unavailable".
      const ids = url.searchParams.get("models").split(","), vars = url.searchParams.get("hourly").split(","), n = 72, t0 = Date.now() - 2 * 3600e3, h = { time: [] };
      for (let i = 0; i < n; i++) h.time.push(new Date(t0 + 3 * 3600e3 + i * 3600e3).toISOString().slice(0, 13) + ":00");
      ids.forEach((id, k) => vars.forEach(v => { h[v + "_" + id] = h.time.map((_, i) => id.startsWith("gfs") ? null : v === "precipitation" ? (i >= 10 + k * 3 && i < 16 + k * 3 ? 1.5 + k : 0) : v === "pressure_msl" ? 1012 + k : 20 + k + (i % 6)); }));
      return route.fulfill({ json: { latitude: 18.2, longitude: 42.5, hourly: h, hourly_units: {} } });
    }
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
    if (url.hostname === "gibs.earthdata.nasa.gov" && url.pathname.endsWith("wmts.cgi")) return route.fulfill({ contentType: "text/xml", body: "<Domains><DimensionDomain><Domain>2000-02-24/2026-11-23/P1D</Domain></DimensionDomain></Domains>" });
    // CelesTrak GP (simulated, synthetic elements with a recent epoch).
    if (url.hostname === "celestrak.org") {
      const ep = new Date(Date.now() - 86400000).toISOString().replace("Z", "");
      const mk = (id, name, raan, ma) => ({ OBJECT_NAME: name, OBJECT_ID: "1998-067A", EPOCH: ep, MEAN_MOTION: 15.5, ECCENTRICITY: 0.0005, INCLINATION: 51.64, RA_OF_ASC_NODE: raan, ARG_OF_PERICENTER: 90, MEAN_ANOMALY: ma, EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: "U", NORAD_CAT_ID: id, ELEMENT_SET_NO: 999, REV_AT_EPOCH: 50000, BSTAR: 0.0002, MEAN_MOTION_DOT: 0.0001, MEAN_MOTION_DDOT: 0 });
      return route.fulfill({ json: [mk(25544, "TEST STATION A", 120, 270), mk(48274, "TEST STATION B", 40, 10), mk(99999, "TEST STATION C", 300, 180)] });
    }
    // ADS-B (simulated): adsb.lol answers; airplanes.live only if the primary fails.
    if (url.hostname === "api.adsb.lol" || url.hostname === "api.airplanes.live") {
      const now = Date.now();
      return route.fulfill({ json: { now, total: 3, ctime: now, ptime: 1, msg: "No error", ac: [
        { hex: "710101", flight: "SVA1020 ", r: "HZ-AK11", t: "B77W", alt_baro: 35000, gs: 480, track: 270, lat: 24.9, lon: 46.5, seen_pos: 2, dst: 12, seen: 1, messages: 1, mlat: [], tisb: [], rssi: -20, type: "adsb_icao" },
        { hex: "710102", flight: "", alt_baro: "ground", gs: 0, track: 0, lat: 24.96, lon: 46.70, seen_pos: 1, dst: 15, seen: 1, messages: 1, mlat: [], tisb: [], rssi: -20, type: "adsb_icao" },
        { hex: "710103", flight: "NOPOS1", alt_baro: 20000, seen: 9, messages: 1, mlat: [], tisb: [], rssi: -30, type: "adsb_icao" } ] } });
    }
    return route.abort();
  });
  const results = [];
  for (const [name, url, action] of [
    ["dashboard", "http://local.test/index.html", async p => { await p.waitForTimeout(800); await p.click("#planTrip"); await p.waitForTimeout(800); return await p.textContent("#tripStatus"); }],
    ["seasons", "http://local.test/seasons/index.html", async p => { await p.fill("#orchardLat","18.2164"); await p.fill("#orchardLon","42.5053"); await p.fill("#farmElevation","2400"); await p.click("#loadOrchardWeather"); await p.waitForTimeout(800); return (await p.textContent("#orchardWeatherStatus"))+" | "+(await p.textContent("#orchardElevation"))+" | disabled="+(await p.isDisabled("#loadOrchardWeather")); }],
    ["elevation", "http://local.test/elevation/index.html", async p => { await p.fill("#coords","18.2, 42.5"); await p.click("#searchPoint"); await p.waitForTimeout(600); await p.waitForFunction(() => !document.getElementById("terrain").hidden, null, { timeout: 10000 }); return (await p.textContent("#elevation"))+" | copy disabled="+(await p.isDisabled("#copyResult"))+" | slope="+(await p.textContent("#slope"))+" aspect="+(await p.textContent("#aspect"))+" flow="+(await p.textContent("#flow"))+" pos="+(await p.textContent("#tpos")); }],
    ["satellite", "http://local.test/satellite/index.html", async p => { await p.waitForTimeout(800); return (await p.inputValue("#imageDate"))+" | "+(await p.textContent("#imageStatus")).slice(0,120); }],
    ["coverage", "http://local.test/satellite/coverage.html", async p => { await p.waitForTimeout(800); await p.click("#runAll"); await p.waitForFunction(() => /اكتمل فحص الطبقات|توقف/.test(document.getElementById("status").textContent), null, { timeout: 60000 });
      const pills = await p.$$eval("#summary .pill", els => els.map(e => e.textContent));
      return "STATUS: " + (await p.textContent("#status")) + " || DATES: " + (await p.textContent("#dateStatus")).slice(0, 80) + " || LAYERS: " + pills.join(" ## "); }],
    ["earth-memory", "http://local.test/earth-memory/index.html", async p => { await p.waitForFunction(() => document.querySelectorAll("#years button").length > 0, null, { timeout: 15000 });
      await p.click("#back5"); await p.waitForTimeout(300);
      return "A=" + (await p.inputValue("#dateA")) + " B=" + (await p.inputValue("#dateB")) + " | years=" + (await p.$$eval("#years button", b => b.length)) + " | " + (await p.textContent("#availability")).slice(0, 140); }],
    ["flights", "http://local.test/flights/index.html", async p => { await p.waitForFunction(() => document.querySelectorAll("#list .ac").length > 0, null, { timeout: 15000 });
      await p.click("#list .ac"); await p.waitForTimeout(300);
      return "state=" + (await p.getAttribute("#dataState", "data-state")) + " | list=" + (await p.$$eval("#list .ac", b => b.length)) + " | " + (await p.textContent("#status")).slice(0, 120) + " | card: " + (await p.textContent("#card")).slice(0, 220); }],
    ["sat-radar", "http://local.test/sat-radar/index.html", async p => { await p.waitForFunction(() => document.getElementById("dataState").getAttribute("data-state") !== "not_loaded", null, { timeout: 15000 });
      await p.click("#tabAll"); await p.waitForSelector("#list .sat"); await p.click("#list .sat"); await p.waitForTimeout(400);
      return "state=" + (await p.getAttribute("#dataState", "data-state")) + " | markers=" + (await p.$$eval(".dot", e => e.length)) + " | tracks=" + (await p.$$eval("path.leaflet-interactive", e => e.length)) + " | " + (await p.textContent("#status")).slice(0, 100) + " | card: " + (await p.textContent("#card")).slice(0, 400); }],
    ["models", "http://local.test/models/index.html", async p => { await p.click("#load"); await p.waitForFunction(() => !document.getElementById("rainPanel").hidden, null, { timeout: 15000 });
      const ok = (await p.textContent("#status")) + " | " + (await p.textContent("#rainVerdict")) + " | rows=" + (await p.$$eval("#rainRows tr", r => r.length)) + " | " + (await p.textContent("#rainRows")).includes("لم يُرجع النموذج بيانات");
      await p.fill("#coords", "99, 99"); await p.click("#load"); const bad = await p.textContent("#status");
      await p.fill("#coords", "19.12, 42.13"); await p.click("#load"); await p.waitForFunction(() => /تم الجلب/.test(document.getElementById("status").textContent), null, { timeout: 15000 });
      const pt = await p.textContent("#status"); await p.fill("#coords", "");
      const asirOpts = await p.$$eval("#place optgroup:first-child option", o => o.map(x => x.textContent).join("،"));
      await p.route("**/api.open-meteo.com/**", r => r.abort()); await p.selectOption("#place", "riyadh"); await p.click("#load"); await p.waitForTimeout(1500);
      const down = await p.textContent("#status"); await p.selectOption("#place", "abha"); await p.click("#load"); await p.waitForTimeout(1500);
      return ok + " || bad: " + bad + " || point: " + pt + " || asir: " + asirOpts + " || outage-new: " + down + " || outage-cached: " + (await p.textContent("#status")) + " state=" + (await p.getAttribute("#dataState", "data-state")); }],
    ["admin", "http://local.test/admin/index.html", async p => { await p.waitForTimeout(1200); return (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, " ").slice(0, 300); }]
  ]) {
    const page = await ctx.newPage(); const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    page.on("console", m => { if (m.type() === "error" && !/ERR_FAILED|Failed to load resource/.test(m.text())) errors.push(m.text()); });
    await page.goto(url, { waitUntil: "domcontentloaded" });
    let out; try { out = await action(page); } catch (e) { out = "ACTION FAILED " + e.message; }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    // Elements wider than the viewport that are not inside a horizontal scroller (clipping check).
    // Clipped = part of the element is unreachable: it sticks out of the viewport, or out of an
    // overflow:hidden/clip ancestor, with no horizontally scrollable ancestor in between.
    const clipped = await page.evaluate(() => Array.from(document.querySelectorAll("body *")).filter(el => {
      if (el.closest(".leaflet-container")) return false; // map tiles overflow the map by design
      const r = el.getBoundingClientRect(); if (!r.width || !r.height) return false;
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const o = getComputedStyle(a).overflowX;
        if (o === "auto" || o === "scroll") return false;
        if (o === "hidden" || o === "clip") { const p = a.getBoundingClientRect(); if (r.left < p.left - 1 || r.right > p.right + 1) return true; }
      }
      return r.left < -1 || r.right > window.innerWidth + 1;
    }).slice(0, 5).map(el => el.tagName + (el.id ? "#" + el.id : "") + (el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : "")));
    const leafletLoaded = await page.evaluate(() => typeof window.L === "object");
    await page.screenshot({ path: name + (desktop ? "-desktop" : "") + ".png", fullPage: false });
    results.push({ name, viewport: desktop ? "1280x800" : "390x844", out: String(out).replace(/\s+/g, " ").slice(0, 4000), errors, overflowPx: overflow, clipped, leafletLoaded });
    await page.close();
  }
  console.log(JSON.stringify(results, null, 1));
  await browser.close();
})();
