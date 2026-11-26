(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const gibs = node ? require("./nasa-gibs.js") : root && root.NasaGibsSatellite;
  const api = factory(gibs);
  if (node) module.exports = api;
  if (root) root.EarthMemory = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (G) {
  "use strict";
  // «ذاكرة الأرض»: compare the same place on two dates, and step through the
  // same calendar day across years, using the NASA GIBS daily archive.
  // Every date shown is an actual date listed by the layer's WMTS domain; when
  // the exact day is missing, the nearest listed day is used and the gap is reported.

  function dayOfYearDate(year, month, day) {
    // 29 Feb in a non-leap year falls back to 28 Feb (stated by `adjusted`).
    const d = new Date(Date.UTC(year, month - 1, day));
    if (d.getUTCMonth() !== month - 1) return { date: year + "-" + String(month).padStart(2, "0") + "-28", adjusted: true };
    return { date: d.toISOString().slice(0, 10), adjusted: false };
  }

  function daysBetween(a, b) { return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000); }

  // Nearest available date to `target` within ±maxGap days (prefers the earlier on a tie).
  function nearestAvailable(target, periods, cap, maxGap) {
    if (!G.validDate(target)) throw new TypeError("Invalid date");
    const limit = Number.isInteger(maxGap) ? maxGap : 7;
    if (G.isDateAvailable(target, periods) && (!cap || target <= cap)) return { date: target, gap_days: 0 };
    const before = G.adjacentAvailableDate(target, periods, -1, cap);
    const after = G.adjacentAvailableDate(target, periods, 1, cap);
    const candidates = [before, after].filter(Boolean).map(function (d) { return { date: d, gap_days: daysBetween(target, d) }; })
      .filter(function (c) { return Math.abs(c.gap_days) <= limit; })
      .sort(function (x, y) { return Math.abs(x.gap_days) - Math.abs(y.gap_days) || x.gap_days - y.gap_days; });
    return candidates[0] || null;
  }

  // The same month/day in every year from the layer's first year to the cap year.
  function sameDayAcrossYears(date, periods, cap, maxGap) {
    if (!G.validDate(date)) throw new TypeError("Invalid date");
    const first = G.earliestAvailableDate(periods);
    const last = G.latestAvailableOnOrBefore(periods, cap);
    if (!first || !last) return [];
    const month = Number(date.slice(5, 7)), day = Number(date.slice(8, 10));
    const out = [];
    for (let y = Number(first.slice(0, 4)); y <= Number(last.slice(0, 4)); y++) {
      const t = dayOfYearDate(y, month, day);
      if (t.date < first && daysBetween(t.date, first) > (maxGap || 7)) { out.push({ year: y, target: t.date, date: null, reason: "before_archive" }); continue; }
      if (t.date > last && daysBetween(last, t.date) > (maxGap || 7)) { out.push({ year: y, target: t.date, date: null, reason: "after_latest" }); continue; }
      const hit = nearestAvailable(t.date, periods, cap, maxGap);
      out.push(hit ? { year: y, target: t.date, date: hit.date, gap_days: hit.gap_days, adjusted_feb29: t.adjusted } : { year: y, target: t.date, date: null, reason: "no_image_near_date" });
    }
    return out;
  }

  // Date N years before `base` (same month/day), snapped to an available date.
  function yearsBefore(base, years, periods, cap, maxGap) {
    if (!G.validDate(base) || !Number.isInteger(years) || years < 1) throw new TypeError("Invalid base date or years");
    const t = dayOfYearDate(Number(base.slice(0, 4)) - years, Number(base.slice(5, 7)), Number(base.slice(8, 10)));
    const hit = nearestAvailable(t.date, periods, cap, maxGap);
    return hit ? Object.assign({ target: t.date }, hit) : null;
  }

  function describeGap(entry) {
    if (!entry || !entry.date) return "لا توجد صورة قريبة من هذا اليوم";
    if (!entry.gap_days) return entry.date;
    return entry.date + " (أقرب يوم متاح؛ " + (entry.gap_days > 0 ? "بعد" : "قبل") + " التاريخ المطلوب بـ " + Math.abs(entry.gap_days) + " يوم)";
  }

  return { nearestAvailable, sameDayAcrossYears, yearsBefore, describeGap, dayOfYearDate, daysBetween };
});
