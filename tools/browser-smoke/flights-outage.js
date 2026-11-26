const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
// Flight radar UI under simulated outage, rate limit (429) and malformed data. REPO=<repo> node flights-outage.js
const ROOT = process.env.REPO || path.join(__dirname, "..", ".."), LD = path.join(process.cwd(), "node_modules/leaflet/dist");
(async () => {
  const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome" }); const out = {};
  for (const mode of ["down", "ratelimit", "badjson"]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.route("**/*", route => { const u = new URL(route.request().url());
      if (u.hostname === "local.test") { let p = path.join(ROOT, u.pathname); if (p.endsWith("/")) p += "index.html"; return fs.existsSync(p) ? route.fulfill({ status: 200, contentType: p.endsWith(".html") ? "text/html; charset=utf-8" : "application/javascript", body: fs.readFileSync(p) }) : route.fulfill({ status: 404 }); }
      if (u.hostname === "unpkg.com") return route.fulfill({ status: 200, contentType: u.pathname.endsWith(".css") ? "text/css" : "application/javascript", headers: { "access-control-allow-origin": "*" }, body: fs.readFileSync(path.join(LD, path.basename(u.pathname))) });
      if (/adsb\.lol|airplanes\.live/.test(u.hostname)) { if (mode === "down") return route.abort("internetdisconnected"); if (mode === "ratelimit") return route.fulfill({ status: 429, headers: { "Retry-After": "90", "access-control-expose-headers": "Retry-After" }, body: "" }); return route.fulfill({ status: 200, contentType: "application/json", body: "{not json" }); }
      return route.abort(); });
    const p = await ctx.newPage(); const errs = []; p.on("pageerror", e => errs.push(e.message));
    await p.goto("http://local.test/flights/index.html"); await p.waitForFunction(() => document.getElementById("dataState").getAttribute("data-state") !== "not_loaded", null, { timeout: 40000 }).catch(() => {});
    out[mode] = { state: await p.getAttribute("#dataState", "data-state"), status: (await p.textContent("#status")).slice(0, 170), markers: await p.$$eval(".plane", e => e.length), errs };
    await ctx.close();
  }
  console.log(JSON.stringify(out, null, 1)); await browser.close();
})();
