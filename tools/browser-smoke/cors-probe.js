const { chromium } = require("playwright");
const png = require("./png.js");
const img = png(4, 4, (x, y) => [x * 60, y * 60, 100, 255]);
(async () => {
  const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome" });
  const ctx = await browser.newContext();
  await ctx.route("**/*", route => {
    const u = new URL(route.request().url());
    if (u.hostname === "local.test") return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>x</title>" });
    if (u.pathname === "/nocors.png") return route.fulfill({ status: 200, contentType: "image/png", body: img });
    if (u.pathname === "/cors.png") return route.fulfill({ status: 200, contentType: "image/png", body: img, headers: { "Access-Control-Allow-Origin": "*" } });
    return route.abort();
  });
  const page = await ctx.newPage();
  await page.goto("http://local.test/");
  const result = await page.evaluate(async () => {
    const tryLoad = src => new Promise(res => { const i = new Image(); i.crossOrigin = "anonymous";
      i.onload = () => { try { const c = document.createElement("canvas"); c.width = 4; c.height = 4; const g = c.getContext("2d"); g.drawImage(i, 0, 0); g.getImageData(0, 0, 1, 1); res("loaded+readable"); } catch (e) { res("loaded+tainted:" + e.name); } };
      i.onerror = () => res("error"); i.src = src; });
    const f = async src => { try { const r = await fetch(src, { mode: "cors" }); return "fetch ok, ACAO=" + r.headers.get("access-control-allow-origin"); } catch (e) { return "fetch blocked: " + e.message; } };
    return { nocorsImage: await tryLoad("https://tiles.example.org/nocors.png"), corsImage: await tryLoad("https://tiles.example.org/cors.png"),
      nocorsFetch: await f("https://tiles.example.org/nocors.png"), corsFetch: await f("https://tiles.example.org/cors.png") };
  });
  console.log(JSON.stringify(result, null, 1));
  await browser.close();
})();
