// Rain accumulation windows and intensity classes over an hourly series.
// Input rows: { time:"YYYY-MM-DDTHH:MM" (Saudi local), mm:number|null }.
// Windows are computed only when every hour in the window has a value;
// otherwise the window reports complete:false with the hours covered, so a
// partial sum is never shown as a full accumulation.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RainAccumulation = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const WINDOWS = Object.freeze([1, 3, 6, 12, 24, 48, 72, 168]);

  // Hourly rain-rate classes (American Meteorological Society glossary):
  // light < 2.5 mm/h, moderate 2.5–7.6, heavy 7.6–50, violent > 50.
  const INTENSITY = Object.freeze([
    { id: "none", label: "لا هطول", max: 0.1 },
    { id: "light", label: "خفيف", max: 2.5 },
    { id: "moderate", label: "متوسط", max: 7.6 },
    { id: "heavy", label: "غزير", max: 50 },
    { id: "violent", label: "غزير جداً", max: Infinity }
  ]);

  function isNum(v) { return typeof v === "number" && Number.isFinite(v); }

  function intensity(mmPerHour) {
    if (!isNum(mmPerHour) || mmPerHour < 0) return null;
    return INTENSITY.find(function (c) { return mmPerHour < c.max; });
  }

  // Sum of `hours` rows starting at index `start` going forward (dir=1) or
  // ending at index `start` going backward (dir=-1).
  function windowSum(rows, start, hours, dir) {
    let sum = 0, have = 0, peak = null;
    for (let k = 0; k < hours; k++) {
      const i = dir > 0 ? start + k : start - k;
      if (i < 0 || i >= rows.length) break;
      const v = rows[i].mm;
      if (isNum(v) && v >= 0) { sum += v; have++; if (peak === null || v > peak) peak = v; }
    }
    return { hours: hours, covered: have, complete: have === hours, mm: have === hours ? sum : null, partial_mm: sum, peak_mm_h: peak };
  }

  // Index of the hour containing `nowLocal` ("YYYY-MM-DDTHH:MM"), or -1.
  function indexAt(rows, nowLocal) {
    const key = String(nowLocal).slice(0, 13);
    for (let i = 0; i < rows.length; i++) if (String(rows[i].time).slice(0, 13) === key) return i;
    return -1;
  }

  // Past windows end at the current hour; next windows start after it.
  function accumulate(rows, nowLocal, windows) {
    const w = windows || WINDOWS;
    const at = indexAt(rows, nowLocal);
    if (at < 0) return { found: false, past: [], next: [] };
    return {
      found: true,
      index: at,
      past: w.map(function (h) { return windowSum(rows, at, h, -1); }),
      next: w.map(function (h) { return windowSum(rows, at + 1, h, 1); })
    };
  }

  // Calendar totals (day / month) from hourly rows; incomplete periods flagged.
  function calendarTotals(rows, period) {
    const len = period === "month" ? 7 : 10;
    const map = new Map();
    rows.forEach(function (r) {
      const k = String(r.time).slice(0, len);
      const e = map.get(k) || { period: k, mm: 0, hours: 0, missing: 0 };
      if (isNum(r.mm) && r.mm >= 0) { e.mm += r.mm; e.hours++; } else e.missing++;
      map.set(k, e);
    });
    return Array.from(map.values()).map(function (e) {
      let expected = 24;
      if (period === "month") {
        const y = Number(e.period.slice(0, 4)), m = Number(e.period.slice(5, 7));
        expected = new Date(Date.UTC(y, m, 0)).getUTCDate() * 24;
      }
      e.complete = e.missing === 0 && e.hours === expected;
      return e;
    });
  }

  return { WINDOWS, INTENSITY, intensity, windowSum, indexAt, accumulate, calendarTotals };
});
