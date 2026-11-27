const test = require("node:test");
const assert = require("node:assert/strict");
const MC = require("../src/services/weather/model-comparison.js");
const RA = require("../src/services/precipitation/accumulation.js");

function payload(n, per) {
  const time = Array.from({ length: n }, (_, i) => "2026-11-27T" + String(i).padStart(2, "0") + ":00");
  const hourly = { time };
  Object.keys(per).forEach(id => Object.keys(per[id]).forEach(v => { hourly[v + "_" + id] = per[id][v]; }));
  return { hourly, hourly_units: {} };
}

test("buildUrl requests every model and variable in Saudi time", () => {
  const u = new URL(MC.buildUrl({ lat: 18.2164, lon: 42.5053 }, { days: 3 }));
  assert.equal(u.searchParams.get("models"), MC.MODELS.map(m => m.id).join(","));
  assert.match(u.searchParams.get("hourly"), /precipitation/);
  assert.equal(u.searchParams.get("timezone"), "Asia/Riyadh");
  assert.equal(u.searchParams.get("forecast_days"), "3");
  assert.throws(() => MC.buildUrl({ lat: NaN, lon: 1 }));
});

test("normalize marks a model with no values as unavailable instead of inventing data", () => {
  const d = MC.normalize(payload(3, {
    ecmwf_ifs025: { temperature_2m: [10, 11, 12], precipitation: [0, 0, 1] },
    gfs_seamless: { temperature_2m: [null, null, null] }
  }), ["ecmwf_ifs025", "gfs_seamless"]);
  assert.equal(d.models[0].available, true);
  assert.equal(d.models[1].available, false);
  assert.deepEqual(d.models[1].series.precipitation, [null, null, null]);
});

test("normalize accepts the unsuffixed form for a single model and rejects malformed input", () => {
  const d = MC.normalize({ hourly: { time: ["a"], temperature_2m: [5] } }, ["icon_seamless"]);
  assert.equal(d.models[0].series.temperature_2m[0], 5);
  assert.throws(() => MC.normalize({}), TypeError);
});

test("hour statistics use only models that returned a value", () => {
  const d = MC.normalize(payload(1, { a: { temperature_2m: [10] }, b: { temperature_2m: [14] }, c: { temperature_2m: [null] } }), ["a", "b", "c"]);
  const s = MC.hourlyStats(d, "temperature_2m")[0];
  assert.equal(s.count, 2); assert.equal(s.mean, 12); assert.equal(s.spread, 4);
});

test("rain comparison: onset spread, split verdict and zero totals", () => {
  const d = MC.normalize(payload(6, {
    a: { precipitation: [0, 0, 1.2, 3, 0, 0] },
    b: { precipitation: [0, 0, 0, 0, 0.5, 0] },
    c: { precipitation: [0, 0, 0, 0, 0, 0] }
  }), ["a", "b", "c"]);
  const r = MC.compareRain(d);
  assert.equal(r.verdict, "split");
  assert.equal(r.models_with_rain, 2);
  assert.equal(r.onset_spread_hours, 2);
  assert.equal(r.events.find(e => e.id === "c").total_mm, 0);
  assert.equal(r.events.find(e => e.id === "c").start, null);
  assert.equal(MC.rainAgreement(d, 2).agreement, 2 / 3);
});

test("rain comparison with no data says so", () => {
  const d = MC.normalize(payload(2, { a: { precipitation: [null, null] } }), ["a"]);
  assert.equal(MC.compareRain(d).verdict, "no_data");
});

test("agreement levels follow the per-variable tolerance", () => {
  assert.equal(MC.agreementLevel("temperature_2m", 1.5), "high");
  assert.equal(MC.agreementLevel("temperature_2m", 3), "medium");
  assert.equal(MC.agreementLevel("temperature_2m", 9), "low");
  assert.equal(MC.agreementLevel("temperature_2m", null), null);
});

test("verification refuses to rank models without enough paired samples", () => {
  const few = MC.verify({ a: [1, 2], b: [2, 2] }, [1, 2]);
  assert.equal(few.ranked, null);
  const obs = Array.from({ length: 40 }, (_, i) => i);
  const ok = MC.verify({ good: obs.map(x => x + 0.5), bad: obs.map(x => x + 3) }, obs);
  assert.equal(ok.ranked[0].id, "good");
  assert.equal(ok.ranked[0].mae, 0.5);
});

test("rain intensity classes and invalid values", () => {
  assert.equal(RA.intensity(0).id, "none");
  assert.equal(RA.intensity(1).id, "light");
  assert.equal(RA.intensity(5).id, "moderate");
  assert.equal(RA.intensity(20).id, "heavy");
  assert.equal(RA.intensity(80).id, "violent");
  assert.equal(RA.intensity(-1), null);
  assert.equal(RA.intensity(NaN), null);
});

test("accumulation windows are complete only when every hour has a value", () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({ time: "2026-11-" + (i < 24 ? "27" : "28") + "T" + String(i % 24).padStart(2, "0") + ":00", mm: 1 }));
  rows[20].mm = null;
  const a = RA.accumulate(rows, "2026-11-27T12:40", [1, 3, 24]);
  assert.equal(a.found, true);
  assert.equal(a.past[1].mm, 3);
  assert.equal(a.past[2].complete, false);   // only 13 past hours exist
  assert.equal(a.past[2].mm, null);
  assert.equal(a.next[1].mm, 3);
  assert.equal(a.next[2].complete, false);   // contains the null hour
  assert.equal(RA.accumulate(rows, "2026-12-01T00:00").found, false);
});

test("calendar totals flag incomplete days and months", () => {
  const rows = Array.from({ length: 24 }, (_, i) => ({ time: "2026-11-27T" + String(i).padStart(2, "0") + ":00", mm: 0.5 }));
  const days = RA.calendarTotals(rows, "day");
  assert.equal(days[0].mm, 12); assert.equal(days[0].complete, true);
  assert.equal(RA.calendarTotals(rows, "month")[0].complete, false);
  rows[3].mm = null;
  assert.equal(RA.calendarTotals(rows, "day")[0].complete, false);
});
