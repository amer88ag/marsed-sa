(function (root, factory) {
  const http = (typeof module === "object" && module.exports)
    ? require("../../platform/http/client.js")
    : (root && root.HttpClient) || null;
  const api = factory(http);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.OrchardWeather = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (http) {
  "use strict";

  const DAILY_FIELDS = "temperature_2m_min,temperature_2m_max,precipitation_sum,precipitation_probability_max,et0_fao_evapotranspiration";
  const ARCHIVE_FIELDS = "temperature_2m_min,temperature_2m_max,precipitation_sum";

  function validLocation(location) {
    return !!location &&
      Number.isFinite(Number(location.lat)) &&
      Number.isFinite(Number(location.lon)) &&
      Number(location.lat) >= -90 && Number(location.lat) <= 90 &&
      Number(location.lon) >= -180 && Number(location.lon) <= 180;
  }

  function buildForecastUrl(location) {
    if (!validLocation(location)) throw new TypeError("Valid orchard latitude and longitude are required");
    const q = new URLSearchParams({
      latitude: String(Number(location.lat)),
      longitude: String(Number(location.lon)),
      daily: DAILY_FIELDS,
      hourly: "soil_moisture_0_to_7cm,soil_temperature_0_to_7cm",
      forecast_days: "7",
      timezone: "Asia/Riyadh"
    });
    return "https://api.open-meteo.com/v1/forecast?" + q.toString();
  }

  function shiftDate(dateText, days) {
    if (typeof dateText !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateText) || !Number.isInteger(days)) {
      throw new TypeError("A valid ISO date and integer day offset are required");
    }
    const date = new Date(dateText + "T12:00:00Z");
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== dateText) {
      throw new TypeError("Invalid ISO date");
    }
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function saudiToday(now) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Riyadh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(now || new Date()).reduce(function (out, part) {
      if (part.type !== "literal") out[part.type] = part.value;
      return out;
    }, {});
    return parts.year + "-" + parts.month + "-" + parts.day;
  }

  function buildArchiveUrl(location, endDate) {
    if (!validLocation(location)) throw new TypeError("Valid orchard latitude and longitude are required");
    const end = endDate || saudiToday();
    const start = shiftDate(end, -7);
    const q = new URLSearchParams({
      latitude: String(Number(location.lat)),
      longitude: String(Number(location.lon)),
      start_date: start,
      end_date: shiftDate(end, -1),
      daily: ARCHIVE_FIELDS,
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
    const daily = payload.daily;
    const dates = daily.time;
    const fields = [
      "temperature_2m_min",
      "temperature_2m_max",
      "precipitation_sum",
      "precipitation_probability_max",
      "et0_fao_evapotranspiration"
    ];
    fields.forEach(function (key) {
      if (daily[key] !== undefined && (!Array.isArray(daily[key]) || daily[key].length !== dates.length)) {
        throw new TypeError("Daily field length mismatch: " + key);
      }
    });
    return dates.map(function (date, index) {
      return {
        date: date,
        min: finiteOrNull((daily.temperature_2m_min || [])[index]),
        max: finiteOrNull((daily.temperature_2m_max || [])[index]),
        precipitation: finiteOrNull((daily.precipitation_sum || [])[index]),
        precipitationProbability: finiteOrNull((daily.precipitation_probability_max || [])[index]),
        et0: finiteOrNull((daily.et0_fao_evapotranspiration || [])[index])
      };
    });
  }

  const MODEL_LIMIT = "قيمة نموذجية عند نقطة شبكة النموذج وليست قراءة حساس المزرعة";
  // Each alert carries: level, type, text, basis (why it fired), limits, source.
  // These are monitoring signals, not frost warnings or verified cultivar tolerance limits.
  function alert(level, type, text, basis, limits, source) {
    return { level: level, type: type, text: text, basis: basis, limits: limits, source: source };
  }
  function classifyDay(day, stage, sourceLabel) {
    const alerts = [];
    const source = sourceLabel || "Open-Meteo";
    if (day.min !== null && day.min <= 0) {
      alerts.push(alert("high", "cold", "مؤشر برودة شديدة: الصغرى في النموذج عند أو دون الصفر. ليس إنذار صقيع رسمياً؛ تحقق بقراءة محلية قرب الأرض واتبع إرشاداً زراعياً لحماية الأجزاء الحساسة.",
        "الحرارة الدنيا " + day.min + "°م ≤ 0°م", MODEL_LIMIT + "؛ حرارة سطح النبات قد تختلف عن حرارة الهواء على ارتفاع 2 م، وحد التضرر يختلف بحسب النوع والصنف والمرحلة ومدة البرودة.", source));
    } else if (day.min !== null && day.min <= 2) {
      alerts.push(alert("watch", "cold", "مؤشر برودة: قد تتأثر الأزهار أو النموات الحديثة بحسب النوع والصنف ومدة البرودة.",
        "الحرارة الدنيا " + day.min + "°م ≤ 2°م", MODEL_LIMIT + "؛ ليس حد تحمل معتمداً لأي صنف.", source));
    }
    if (day.max !== null && day.max >= 40) {
      alerts.push(alert("high", "heat", "مؤشر حرارة مرتفعة جداً؛ راقب الذبول وحرارة التربة وتوفر الماء، ولا ترفع الري آلياً دون فحص.",
        "الحرارة العظمى " + day.max + "°م ≥ 40°م", MODEL_LIMIT + "؛ ليس حداً مؤكداً لتحمل الصنف.", source));
    } else if (day.max !== null && day.max >= 35) {
      alerts.push(alert("watch", "heat", "مؤشر إجهاد حراري محتمل؛ تزداد أهمية المتابعة أثناء الإزهار ونمو الثمار.",
        "الحرارة العظمى " + day.max + "°م ≥ 35°م", MODEL_LIMIT + ".", source));
    }
    if (day.precipitation !== null && day.et0 !== null && day.et0 - day.precipitation >= 5) {
      alerts.push(alert("watch", "water", "الفقد المرجعي بالتبخر-نتح أعلى من المطر بفارق ملحوظ؛ هذا مؤشر متابعة للماء وليس حساباً لكمية الري.",
        "ET₀ " + day.et0 + " ملم − الهطول " + day.precipitation + " ملم ≥ 5 ملم",
        "ET₀ قيمة مرجعية لعشب قصير (FAO-56)؛ تحويلها إلى كمية ري يحتاج معامل المحصول ونظام الري وكفاءته ورطوبة التربة. لا يحسب المرصد كمية الري.", source));
    }
    if (stage === "flower" && day.min !== null && day.min <= 5) {
      alerts.push(alert("watch", "stage", "الشجرة في مرحلة الإزهار حسب إدخالك؛ تابع البرودة محلياً لأن حساسية الأزهار تختلف بين الأنواع والأصناف.",
        "مرحلة الإزهار (من إدخال المستخدم) والصغرى " + day.min + "°م ≤ 5°م", MODEL_LIMIT + "؛ المرحلة من إدخالك وليست مرصودة.", source));
    }
    return alerts;
  }

  function evaluate(days, stage, sourceLabel) {
    return (Array.isArray(days) ? days : []).map(function (day) {
      return { day: day, alerts: classifyDay(day, stage || "", sourceLabel) };
    });
  }

  // Describes where a result came from: kind, provider, grid point, model
  // elevation and date range. `kind` is "forecast" or "reanalysis".
  function describeSource(payload, kind, rows, retrievedAt) {
    const isForecast = kind === "forecast";
    const dates = (Array.isArray(rows) ? rows : []).map(function (row) { return row.date; }).filter(Boolean);
    return {
      kind: isForecast ? "forecast" : "reanalysis",
      label: isForecast ? "توقع نموذجي" : "إعادة تحليل",
      provider: isForecast ? "Open-Meteo Forecast API (نماذج طقس عددية)" : "Open-Meteo Historical Weather API (إعادة تحليل ERA5 وما يتبعها)",
      attribution: "Weather data by Open-Meteo.com",
      grid_latitude: finiteOrNull(payload && payload.latitude),
      grid_longitude: finiteOrNull(payload && payload.longitude),
      model_elevation_m: finiteOrNull(payload && payload.elevation),
      date_start: dates.length ? dates[0] : null,
      date_end: dates.length ? dates[dates.length - 1] : null,
      retrieved_at: retrievedAt || new Date().toISOString(),
      limitations: isForecast
        ? ["ناتج نموذج وليس رصداً", "قيمة نقطة شبكة النموذج وليست قراءة المزرعة"]
        : ["إعادة تحليل وليست قياس محطة", "قد تكون الأيام الأحدث غير متاحة بعد بسبب تأخر الأرشيف؛ تُعرض «غير متاحة» ولا تُستبدل بأصفار"]
    };
  }

  // Compares the user's farm elevation with the model grid elevation. Never
  // derives a planting/pruning date from elevation.
  function elevationContext(farmElevation, modelElevation) {
    const farm = finiteOrNull(farmElevation), model = finiteOrNull(modelElevation);
    if (farm === null && model === null) return { available: false, text: "لا يتوفر ارتفاع المزرعة ولا ارتفاع نقطة النموذج." };
    if (farm === null) return { available: true, farm_m: null, model_m: model, difference_m: null, text: "ارتفاع نقطة شبكة النموذج نحو " + Math.round(model) + " م. أدخل ارتفاع المزرعة للمقارنة." };
    if (model === null) return { available: true, farm_m: farm, model_m: null, difference_m: null, text: "ارتفاع المزرعة المُدخل " + Math.round(farm) + " م؛ لم تُرجع الخدمة ارتفاع نقطة النموذج." };
    const diff = farm - model;
    const significant = Math.abs(diff) >= 100;
    return {
      available: true, farm_m: farm, model_m: model, difference_m: Math.round(diff), significant: significant,
      text: "ارتفاع المزرعة المُدخل " + Math.round(farm) + " م وارتفاع نقطة النموذج نحو " + Math.round(model) + " م (فرق " + Math.round(diff) + " م)." +
        (significant ? " الفرق كبير؛ قد تختلف الحرارة الفعلية في المزرعة عن قيم النموذج، فاعتمد قراءة محلية قبل أي قرار." : " الفرق محدود، لكن القيم تبقى نموذجية.") +
        " لا يُستنتج من الارتفاع وحده موعد زراعي."
    };
  }

  async function fetchDaily(url, kind, config) {
    const payload = await http.request(url, { fetch: config.fetch, headers: { Accept: "application/json" }, signal: config.signal, timeoutMs: config.timeoutMs });
    const rows = normalizeDaily(payload);
    return { ok: true, rows: rows, source: describeSource(payload, kind, rows, config.retrievedAt), error: null };
  }

  // Fetches forecast and reanalysis independently: one failing never hides the other.
  async function fetchOrchardData(location, options) {
    const config = Object.assign({}, options || {});
    if (!http) throw new Error("HTTP client is unavailable");
    if (!validLocation(location)) throw new TypeError("Valid orchard latitude and longitude are required");
    const settled = await Promise.allSettled([
      fetchDaily(buildForecastUrl(location), "forecast", config),
      fetchDaily(buildArchiveUrl(location, config.endDate), "reanalysis", config)
    ]);
    const toResult = function (entry) {
      return entry.status === "fulfilled" ? entry.value : { ok: false, rows: [], source: null, error: entry.reason };
    };
    return { forecast: toResult(settled[0]), archive: toResult(settled[1]) };
  }

  return { buildForecastUrl, buildArchiveUrl, normalizeDaily, evaluate, describeSource, elevationContext, fetchOrchardData, shiftDate, validLocation, saudiToday };
});
