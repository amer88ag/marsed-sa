(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RainAggregate = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  // Daily → monthly / yearly rainfall totals and dry/wet spells.
  // Rules: a missing day is never zero; a total is given only for a complete
  // period (every calendar day present); duplicate dates are rejected, so
  // periods never overlap or double-count.
  const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

  function arDays(n) { return n === 1 ? "يوم واحد" : n === 2 ? "يومان" : n <= 10 ? n + " أيام" : n + " يوماً"; }
  function daysInMonth(year, month) { return new Date(Date.UTC(year, month, 0)).getUTCDate(); }
  function isLeap(year) { return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0; }

  // rows: [{ valid_date: "YYYY-MM-DD", value: number|null }]
  function clean(rows) {
    if (!Array.isArray(rows)) throw new TypeError("Daily rows must be an array");
    const seen = new Set();
    return rows.map(function (row) {
      const date = row && (row.valid_date || row.date);
      const m = DATE.exec(date || "");
      if (!m) throw new TypeError("Invalid date: " + date);
      const check = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
      if (check.getUTCMonth() !== +m[2] - 1 || check.getUTCDate() !== +m[3]) throw new TypeError("Invalid date: " + date);
      if (seen.has(date)) throw new TypeError("Duplicate date (overlapping periods): " + date);
      seen.add(date);
      const raw = row.value !== undefined ? row.value : row.precipitation_mm;
      const value = raw === null || raw === undefined || raw === "" ? null : Number(raw);
      if (value !== null && (!Number.isFinite(value) || value < 0)) throw new TypeError("Invalid rainfall value for " + date);
      return { date: date, year: +m[1], month: +m[2], value: value };
    }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  }

  function summarise(key, label, expected, items) {
    const valid = items.filter(function (r) { return r.value !== null; });
    const missing = items.length - valid.length;
    const complete = valid.length === expected;
    const sum = valid.reduce(function (acc, r) { return acc + r.value; }, 0);
    return {
      period: key, label: label, expected_days: expected, present_days: items.length, valid_days: valid.length, missing_days: expected - valid.length,
      null_days: missing, complete: complete,
      total_mm: complete ? Math.round(sum * 100) / 100 : null,
      partial_sum_mm: complete ? null : Math.round(sum * 100) / 100,
      wet_days: valid.filter(function (r) { return r.value >= 1; }).length,
      max_day_mm: valid.length ? Math.max.apply(null, valid.map(function (r) { return r.value; })) : null
    };
  }

  function byMonth(rows) {
    const data = clean(rows), groups = new Map();
    data.forEach(function (r) { const k = r.year + "-" + String(r.month).padStart(2, "0"); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); });
    return Array.from(groups.entries()).map(function (e) {
      const parts = e[0].split("-");
      return summarise(e[0], e[0], daysInMonth(+parts[0], +parts[1]), e[1]);
    });
  }

  function byYear(rows) {
    const data = clean(rows), groups = new Map();
    data.forEach(function (r) { const k = String(r.year); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); });
    return Array.from(groups.entries()).map(function (e) { return summarise(e[0], e[0], isLeap(+e[0]) ? 366 : 365, e[1]); });
  }

  // Whole window actually present (first..last date). Complete only if no gaps or nulls.
  function span(rows) {
    const data = clean(rows);
    if (!data.length) return null;
    const first = data[0].date, last = data[data.length - 1].date;
    const expected = Math.round((Date.parse(last + "T00:00:00Z") - Date.parse(first + "T00:00:00Z")) / 86400000) + 1;
    return Object.assign(summarise(first + "/" + last, first + " – " + last, expected, data), { first: first, last: last, last_valid_date: lastValid(data) });
  }

  function lastValid(data) {
    for (let i = data.length - 1; i >= 0; i--) if (data[i].value !== null) return data[i].date;
    return null;
  }

  // Spells: wet day = value >= threshold (default 1 mm, a common convention).
  // A missing day or a calendar gap ends the current spell; it is never counted as dry.
  function spells(rows, thresholdMm) {
    const threshold = Number.isFinite(thresholdMm) ? thresholdMm : 1;
    const data = clean(rows);
    const result = { threshold_mm: threshold, longest_dry: null, longest_wet: null, current: null, broken_by_missing: 0 };
    let run = null, prevDate = null;
    const close = function () {
      if (!run) return;
      const key = run.kind === "dry" ? "longest_dry" : "longest_wet";
      if (!result[key] || run.days > result[key].days) result[key] = { start: run.start, end: run.end, days: run.days };
      run = null;
    };
    data.forEach(function (r) {
      const contiguous = prevDate && Date.parse(r.date + "T00:00:00Z") - Date.parse(prevDate + "T00:00:00Z") === 86400000;
      if (!contiguous && run) { close(); result.broken_by_missing++; }
      prevDate = r.date;
      if (r.value === null) { if (run) result.broken_by_missing++; close(); return; }
      const kind = r.value >= threshold ? "wet" : "dry";
      if (run && run.kind === kind) { run.end = r.date; run.days++; }
      else { close(); run = { kind: kind, start: r.date, end: r.date, days: 1 }; }
    });
    if (run) result.current = { kind: run.kind, start: run.start, end: run.end, days: run.days };
    close();
    return result;
  }

  // One Arabic line per period; never prints a total for an incomplete period.
  function describePeriod(p) {
    if (p.complete) return p.label + ": " + p.total_mm.toFixed(1) + " ملم (" + arDays(p.expected_days) + " كاملة، أيام ممطرة ≥1 ملم: " + p.wet_days + ")";
    return p.label + ": جزئي — " + p.valid_days + " من " + p.expected_days + " يوماً متاحة؛ لا يُحسب مجموع للفترة" + (p.valid_days ? " (مجموع الأيام المتاحة فقط " + p.partial_sum_mm.toFixed(1) + " ملم)" : "");
  }

  return { clean, byMonth, byYear, span, spells, describePeriod, daysInMonth, arDays };
});
