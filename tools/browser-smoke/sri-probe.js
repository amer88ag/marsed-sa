const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const ROOT = process.env.REPO || path.join(__dirname, "..", ".."), LD = path.join(process.cwd(), "node_modules/leaflet/dist");
(async () => {
  const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome" });
  const out = {};
  for (const tamper of [false, true]) {
    const ctx = await browser.newContext();
    await ctx.route("**/*", route => {
      const u = new URL(route.request().url());
      if (u.hostname === "local.test") return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: fs.readFileSync(path.join(ROOT, "elevation/index.html")) });
      if (u.hostname === "unpkg.com") { let b = fs.readFileSync(path.join(LD, path.basename(u.pathname))); if (tamper && u.pathname.endsWith(".js")) b = Buffer.concat([b, Buffer.from("\n//x")]);
        return route.fulfill({ status: 200, contentType: u.pathname.endsWith(".css") ? "text/css" : "application/javascript", headers: { "access-control-allow-origin": "*" }, body: b }); }
      return route.abort();
    });
    const p = await ctx.newPage(); const msgs = []; p.on("console", m => msgs.push(m.text()));
    await p.goto("http://local.test/elevation/index.html"); await p.waitForTimeout(800);
    out[tamper ? "tampered" : "genuine"] = { leafletLoaded: await p.evaluate(() => typeof window.L === "object"), integrityMessage: msgs.find(m => /integrity/i.test(m)) || null };
    await ctx.close();
  }
  console.log(JSON.stringify(out, null, 1)); await browser.close();
})();
