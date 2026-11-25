(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SaudiTime = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  // Asia/Riyadh is UTC+03:00 all year (no DST). Providers return local wall-clock
  // strings without an offset ("2026-11-24T23:00"); parsing them with new Date()
  // would use the *viewer's* time zone. Everything goes through this module.
  const OFFSET_MS = 3 * 3600 * 1000;
  const LOCAL = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/;

  function toDate(value) {
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
    if (typeof value === "number") return Number.isFinite(value) ? new Date(value) : null;
    return null;
  }

  // "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm[:ss]" in Saudi local time → Date (or null).
  // Strings that already carry an offset/Z are parsed as absolute instants.
  function parseSaudiLocal(text) {
    if (typeof text !== "string") return null;
    if (/(Z|[+-]\d{2}:?\d{2})$/.test(text)) {
      const absolute = new Date(text);
      return Number.isFinite(absolute.getTime()) ? absolute : null;
    }
    const m = LOCAL.exec(text);
    if (!m) return null;
    const [year, month, day, hour, minute, second] = [m[1], m[2], m[3], m[4] || 0, m[5] || 0, m[6] || 0].map(Number);
    const utc = Date.UTC(year, month - 1, day, hour, minute, second);
    const check = new Date(utc);
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day ||
        check.getUTCHours() !== hour || check.getUTCMinutes() !== minute) return null;
    return new Date(utc - OFFSET_MS);
  }

  function shifted(date) { return new Date(date.getTime() + OFFSET_MS); }

  // Saudi calendar date "YYYY-MM-DD" of an instant.
  function saudiDate(value) {
    const date = toDate(value === undefined ? new Date() : value);
    return date ? shifted(date).toISOString().slice(0, 10) : null;
  }
  // Saudi wall-clock "HH:mm".
  function saudiClock(value) {
    const date = toDate(value);
    return date ? shifted(date).toISOString().slice(11, 16) : null;
  }
  // 0 = Sunday … 6 = Saturday, for a Saudi calendar date string.
  function saudiWeekday(dateText) {
    const date = parseSaudiLocal(dateText);
    return date ? shifted(date).getUTCDay() : null;
  }
  // Whole Saudi calendar days from `fromDate` to `toDate` (strings or Dates).
  function daysBetween(from, to) {
    const a = typeof from === "string" ? from : saudiDate(from);
    const b = typeof to === "string" ? to : saudiDate(to);
    if (!a || !b) return null;
    return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
  }

  // Age of the data's valid time relative to `now`, in minutes, and a status.
  // maxAgeMinutes defines "stale". Future valid times (beyond 5 min) are flagged.
  function freshness(validTime, now, maxAgeMinutes) {
    const valid = typeof validTime === "string" ? parseSaudiLocal(validTime) : toDate(validTime);
    const reference = toDate(now === undefined ? new Date() : now);
    if (!valid || !reference) return { status: "unknown", age_minutes: null };
    const age = Math.round((reference.getTime() - valid.getTime()) / 60000);
    const limit = Number.isFinite(maxAgeMinutes) ? maxAgeMinutes : 90;
    const status = age < -5 ? "future" : age > limit ? "stale" : "fresh";
    return { status: status, age_minutes: age, valid_at: valid.toISOString() };
  }

  // Arabic count with the correct plural form: 1 → singular, 2 → dual, 3–10 → plural, 11+ → singular.
  function count(n, one, two, few, many) {
    if (n === 1) return one;
    if (n === 2) return two;
    if (n >= 3 && n <= 10) return n + " " + few;
    return n + " " + many;
  }
  // Arabic "منذ X" text for an age in minutes.
  function ageText(minutes) {
    if (!Number.isFinite(minutes)) return "عمر غير معروف";
    if (minutes < 0) return "بعد " + count(Math.abs(Math.round(minutes)), "دقيقة", "دقيقتين", "دقائق", "دقيقة");
    if (minutes < 1) return "الآن";
    if (minutes < 60) return "منذ " + count(Math.round(minutes), "دقيقة", "دقيقتين", "دقائق", "دقيقة");
    if (minutes < 48 * 60) return "منذ " + count(Math.round(minutes / 60), "ساعة", "ساعتين", "ساعات", "ساعة");
    return "منذ " + count(Math.round(minutes / 1440), "يوم", "يومين", "أيام", "يوماً");
  }

  return { OFFSET_MS, parseSaudiLocal, saudiDate, saudiClock, saudiWeekday, daysBetween, freshness, ageText };
});
