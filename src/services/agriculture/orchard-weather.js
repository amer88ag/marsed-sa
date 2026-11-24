(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.OrchardWeather = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const DAILY_FIELDS = "temperature_2m_min,temperature_2m_max,precipitation_sum,precipitation_probability_max,et0_fao_evapotranspiration";
  function validLocation(location) {
    return !!location && Number.isFinite(Number(location.lat)) && Number.isFinite(Number(location.lon)) &&
      Number(location.lat) >= -90 && Number(location.lat) <= 90 &&
      Number(location.lon) >= -180 && Number(location.lon) <= 180;
  }
  function buildForecastUrl(location) {
    if (!validLocation(location)) throw new TypeError("Valid orchard latitude and longitude are required");
    const q = new URLSearchParams({
      latitude: String(Number(location.lat)), longitude: String(Number(location.lon)),
      daily: DAILY_FIELDS, hourly: "soil_moisture_0_to_7cm,soil_temperature_0_to_7cm",
      forecast_days: "7", timezone: "Asia/Riyadh"
    });
    return "https://api.open-meteo.com/v1/forecast?" + q.toString();
  }
  function shiftDate(dateText, days) {
    const date = new Date(dateText + "T12:00:00Z");
    if (!Number.isFinite(date.getTime())) throw new TypeError("Invalid ISO date");
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }
  function buildArchiveUrl(location, endDate) {
    if (!validLocation(location)) throw new TypeError("Valid orchard latitude and longitude are required");
    const end = endDate || new Date().toISOString().slice(0, 10);
    const start = shiftDate(end, -7);
    const q = new URLSearchParams({
      latitude: String(Number(location.lat)), longitude: String(Number(location.lon)),
      start_date: start, end_date: shiftDate(end, -1), daily: DAILY_FIELDS,
      timezone: "Asia/Riyadh"
    });
    return "https://archive-api.open-meteo.com/v1/archive?" + q.toString();
  }
  function finiteOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  function normalizeDaily(payload) {
    if (!payload || !payload.daily || !Array.isArray(payload.daily.time)) {
      throw new TypeError("Weather response has no daily series");
    }
    const d = payload.daily, dates = d.time;
    const fields = ["temperature_2m_min", "temperature_2m_max", "precipitation_sum",
      "precipitation_probability_max", "et0_fao_evapotranspiration"];
    fields.forEach(function (key) {
      if (d[key] !== undefined && (!Array.isArray(d[key]) || d[key].length !== dates.length)) {
        throw new TypeError("Daily field length mismatch: " + key);
      }
    });
    return dates.map(function (date, i) {
      return {
        date: date,
        min: finiteOrNull((d.temperature_2m_min || [])[i]),
        max: finiteOrNull((d.temperature_2m_max || [])[i]),
        precipitation: finiteOrNull((d.precipitation_sum || [])[i]),
        precipitationProbability: finiteOrNull((d.precipitation_probability_max || [])[i]),
        et0: finiteOrNull((d.et0_fao_evapotranspiration || [])[i])
      };
    });
  }
  function classifyDay(day, stage) {
    const alerts = [];
    if (day.min !== null && day.min <= 0) {
      alerts.push({ level: "high", type: "cold", text: "توقع النموذج حرارة دنيا عند أو دون الصفر؛ احتمال تجمد جوي. افحص الموقع والحساس محلياً واحمِ الأجزاء الحساسة وفق إرشاد زراعي." });
    } else if (day.min !== null && day.min <= 2) {
      alerts.push({ level: "watch", type: "cold", text: "برودة شديدة نسبياً متوقعة؛ قد تتضرر الأزهار أو النموات الحديثة بحسب النوع والصنف ومدة البرودة." });
    }
    if (day.max !== null && day.max >= 40) {
      alerts.push({ level: "high", type: "heat", text: "حرارة عظمى مرتفعة جداً في توقع النموذج؛ راقب الذبول وحرارة التربة وتوفر الماء، ولا ترفع الري آلياً دون فحص." });
    } else if (day.max !== null && day.max >= 35) {
      alerts.push({ level: "watch", type: "heat", text: "إجهاد حراري محتمل؛ تزداد أهمية المتابعة أثناء الإزهار ونمو الثمار." });
    }
    if (day.precipitation !== null && day.et0 !== null && day.et0 - day.precipitation >= 5) {
      alerts.push({ level: "watch", type: "water", text: "الفقد المرجعي المتوقع بالتبخر-نتح أعلى من المطر المتوقع بفارق ملحوظ؛ هذا مؤشر متابعة للماء وليس حساباً لكمية الري." });
    }
    if (stage === "flower" && day.min !== null && day.min <= 5) {
      alerts.push({ level: "watch", type: "stage", text: "الشجرة في مرحلة الإزهار حسب إدخالك؛ تابع البرودة محلياً لأن حساسية الأزهار تختلف بين الأنواع والأصناف." });
    }
    return alerts;
  }
  function evaluate(days, stage) {
    return (Array.isArray(days) ? days : []).map(function (day) {
      return { day: day, alerts: classifyDay(day, stage || "") };
    });
  }
  return { buildForecastUrl, buildArchiveUrl, normalizeDaily, evaluate, shiftDate, validLocation };
});
