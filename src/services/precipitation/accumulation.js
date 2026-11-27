// Rain accumulation windows and intensity classes over a Saudi-local hourly series.
// Input rows: { time: "YYYY-MM-DDTHH:MM" (Saudi local), mm: number|null }.
// A window is complete only when each expected local hour occurs exactly once
// in chronological order and has a valid non-negative rainfall value.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RainAccumulation = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const WINDOWS = Object.freeze([1, 3, 6, 12, 24, 48, 72, 168]);
  const HOUR = 60 * 60 * 1000;
  const TIME = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)$/;

  const INTENSITY = Object.freeze([
    { id: "none", label: "لا هطول", max: 0.1 },
    { id: "light", label: "خفيف", max: 2.5 },
    { id: "moderate", label: "متوسط", max: 7.6 },
    { id: "heavy", label: "غزير", max: 50 },
    { id: "violent", label: "غزير جداً", max: Infinity }
  ]);

  function isNum(v) { return typeof v === "number" && Number.isFinite(v); }

  // Parse Saudi wall-clock time as a UTC-like scalar solely for calendar arithmetic.
  // This avoids depending on the visitor's device timezone.
  function hourStamp(value) {
    if (typeof value !== "string") return null;
    const m = TIME.exec(value);
    if (!m) return null;
    const y = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
    const date = new Date(Date.UTC(y, month - 1, day, Number(m[4]), Number(m[5])));
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day || date.getUTCHours() !== Number(m[4]) ||
        date.getUTCMinutes() !== Number(m[5])) return null;
    return date.getTime();
  }

  function intensity(mmPerHour) {
    if (!isNum(mmPerHour) || mmPerHour < 0) return null;
    return INTENSITY.find(function (c) { return mmPerHour < c.max; });
  }

  function validRain(row) {
    return !!row && isNum(row.mm) && row.mm >= 0;
  }

  // Sum hours from start in direction dir. The input must be correctly ordered
  // and contain precisely the expected timestamp at every position.
  function windowSum(rows, start, hours, dir) {
    if (!Array.isArray(rows) || !Number.isInteger(start) || !Number.isInteger(hours) ||
        hours < 1 || (dir !== 1 && dir !== -1)) {
      return { hours: hours, covered: 0, complete: false, mm: null, partial_mm: 0, peak_mm_h: null };
    }
    let sum = 0, covered = 0, peak = null, previous = null;
    for (let k = 0; k < hours; k++) {
      const i = start + k * dir;
      if (i < 0 || i >= rows.length) break;
      const row = rows[i];
      const stamp = hourStamp(row && row.time);
      const expectedStep = dir * HOUR;
      if (stamp === null || (previous !== null && stamp !== previous + expectedStep)) break;
      previous = stamp;
      if (validRain(row)) {
        sum += row.mm;
        covered++;
        if (peak === null || row.mm > peak) peak = row.mm;
      }
    }
    const complete = covered === hours;
    return { hours: hours, covered: covered, complete: complete,
      mm: complete ? sum : null, partial_mm: complete ? null : sum, peak_mm_h: peak };
  }

  function indexAt(rows, nowLocal) {
    if (!Array.isArray(rows)) return -1;
    const stamp = hourStamp(typeof nowLocal === "string" ? nowLocal.slice(0, 16) : nowLocal);
    if (stamp === null) return -1;
    let found = -1;
    for (let i = 0; i < rows.length; i++) {
      if (hourStamp(rows[i] && rows[i].time) === stamp) {
        if (found !== -1) return -1; // ambiguous duplicate timestamp
        found = i;
      }
    }
    return found;
  }

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

  function calendarTotals(rows, period) {
    if (!Array.isArray(rows)) return [];
    const len = period === "month" ? 7 : 10;
    const groups = new Map();
    rows.forEach(function (row) {
      const stamp = hourStamp(row && row.time);
      const key = stamp === null ? null : new Date(stamp).toISOString().slice(0, len);
      if (key === null) return;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ stamp: stamp, row: row });
    });
    return Array.from(groups.entries()).sort(function (a, b) {
      return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
    }).map(function (entry) {
      const key = entry[0], items = entry[1];
      let expected = 24;
      if (period === "month") {
        const y = Number(key.slice(0, 4)), m = Number(key.slice(5, 7));
        expected = new Date(Date.UTC(y, m, 0)).getUTCDate() * 24;
      }
      const seen = new Set();
      let sum = 0, valid = 0, duplicates = 0, invalid = 0;
      items.forEach(function (item) {
        const hourKey = String(item.stamp);
        if (seen.has(hourKey)) { duplicates++; return; }
        seen.add(hourKey);
        if (validRain(item.row)) { sum += item.row.mm; valid++; }
        else invalid++;
      });
      const missingHours = Math.max(0, expected - seen.size);
      const missing = missingHours + invalid + duplicates;
      const complete = missing === 0 && seen.size === expected && valid === expected;
      return { period: key, mm: complete ? sum : null, hours: valid,
        missing: missing, complete: complete };
    });
  }

  return { WINDOWS, INTENSITY, intensity, windowSum, indexAt, accumulate, calendarTotals, hourStamp };
});
