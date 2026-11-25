// Runs satellite/coverage.html in real Chrome against real cross-origin servers.
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-proxy-server"] });
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto("http://127.0.0.1:8801/satellite/coverage.html");
  await page.waitForFunction(() => /أحدث تاريخ متاح/.test(document.getElementById("dateStatus").textContent), null, { timeout: 20000 });
  await page.click("#runAll");
  await page.waitForFunction(() => /اكتمل فحص الطبقات|توقف/.test(document.getElementById("status").textContent), null, { timeout: 90000 });
  const rows = await page.$$eval("#results tr", trs => trs.map(tr => [...tr.children].map(td => td.textContent)));
  const byLayer = {};
  rows.forEach(r => { const k = r[0], s = r[6]; byLayer[k] = byLayer[k] || {}; byLayer[k][s] = (byLayer[k][s] || 0) + 1; });
  console.log(JSON.stringify({ status: await page.textContent("#status"), per_layer_states: byLayer, rows: rows.length, errors,
    overflowPx: await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) }, null, 1));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
