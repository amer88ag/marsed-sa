(function (root, factory) {
  const time = (typeof module === "object" && module.exports) ? require("../time/saudi-time.js") : root && root.SaudiTime;
  const api = factory(time);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FreshnessPolicy = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (T) {
  "use strict";
  // Staleness is judged per data type, never with one universal threshold.
  const POLICY = Object.freeze({
    current_weather: Object.freeze({
      mode: "max_age", max_age_minutes: 90,
      basis: "حد تشغيلي مبدئي قابل للمراجعة (قرار المالك 2026-11-25)، يقاس من وقت صلاحية القيمة لا من وقت الجلب"
    }),
    forecast: Object.freeze({
      mode: "validity_window",
      basis: "لا يُعدّ التوقع قديماً لمرور وقت على جلبه؛ يُعرض وقت صلاحيته (أول وآخر فترة) ووقت جلبه"
    }),
    satellite_imagery: Object.freeze({
      mode: "product_date",
      basis: "يُعتمد تاريخ المنتج الفعلي (يوم UTC) كما تعلنه NASA GIBS، لا وقت تحميل الصفحة؛ لا حد بالدقائق"
    }),
    chirps_final: Object.freeze({
      mode: "release_cycle", release_day_of_following_month: 21, margin_days: 7,
      basis: "CHC: المنتج النهائي يصدر مرة شهرياً، عادةً في الأسبوع الثالث من الشهر التالي؛ أُضيف هامش 7 أيام (اختيار تشغيلي)"
    })
  });

  function utcDate(value) {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
  }
  function lastDayOfMonth(year, monthIndex) { // monthIndex may be negative / overflow
    return new Date(Date.UTC(year, monthIndex + 1, 0)).toISOString().slice(0, 10);
  }

  // Current weather values: stale after max_age_minutes from their valid time.
  function currentWeather(validTime, now) {
    const result = T.freshness(validTime, now, POLICY.current_weather.max_age_minutes);
    return Object.assign({ policy: "current_weather", basis: POLICY.current_weather.basis }, result);
  }

  // Forecast rows: never "stale"; report the validity window and fetch time.
  function forecastWindow(rows, field, fetchedAt) {
    const times = (Array.isArray(rows) ? rows : []).map(function (row) { return row && row[field]; }).filter(Boolean).sort();
    return {
      policy: "forecast", status: "not_applicable", basis: POLICY.forecast.basis,
      valid_from: times.length ? times[0] : null,
      valid_to: times.length ? times[times.length - 1] : null,
      fetched_at: fetchedAt instanceof Date ? fetchedAt.toISOString() : fetchedAt || null
    };
  }

  // Satellite product: age in whole UTC days between the product date and now.
  function satelliteProduct(productDate, now) {
    const today = utcDate(now === undefined ? new Date() : now);
    const days = today && typeof productDate === "string" ? T.daysBetween(productDate, today) : null;
    return { policy: "satellite_imagery", status: days === null ? "unknown" : "dated", product_date: productDate || null, age_days_utc: days, basis: POLICY.satellite_imagery.basis };
  }

  // Latest day a CHIRPS final release is expected to cover on `now` (UTC):
  // month M-1 once the release day (+ margin) of month M has passed, else month M-2.
  function chirpsExpectedLatest(now) {
    const today = utcDate(now === undefined ? new Date() : now);
    if (!today) return null;
    const [year, month, day] = today.split("-").map(Number);
    const p = POLICY.chirps_final;
    const released = day >= p.release_day_of_following_month + p.margin_days;
    return lastDayOfMonth(year, (month - 1) - (released ? 1 : 2));
  }
  function chirpsSample(endDate, now) {
    const expected = chirpsExpectedLatest(now);
    if (typeof endDate !== "string" || !T.parseSaudiLocal(endDate) || !expected) {
      return { policy: "chirps_final", status: "unknown", expected_latest: expected, basis: POLICY.chirps_final.basis };
    }
    const behind = T.daysBetween(endDate, expected);
    return {
      policy: "chirps_final", status: behind > 0 ? "behind_release_cycle" : "current_for_cycle",
      sample_end: endDate, expected_latest: expected, days_behind: Math.max(0, behind), basis: POLICY.chirps_final.basis
    };
  }

  return { POLICY, currentWeather, forecastWindow, satelliteProduct, chirpsExpectedLatest, chirpsSample };
});
