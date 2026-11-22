(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.OpenMeteoAdapter = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  function buildCurrentUrl(location) {
    if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lon)) {
      throw new TypeError("A location with finite lat/lon is required");
    }
    const query = new URLSearchParams({
      latitude: String(location.lat),
      longitude: String(location.lon),
      current: "temperature_2m,relative_humidity_2m,precipitation,rain,showers,wind_speed_10m,apparent_temperature,weather_code,is_day",
      hourly: "temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,wind_speed_10m",
      daily: "weather_code,precipitation_sum,precipitation_probability_max,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max",
      past_days: "1",
      forecast_days: "7",
      timezone: "Asia/Riyadh"
    });
    return "https://api.open-meteo.com/v1/forecast?" + query.toString();
  }
  function numericOrNull(value, field) {
    if (value === null || value === undefined) return null;
    const number = Number(value);
    if (!Number.isFinite(number)) throw new TypeError("Invalid numeric field: " + field);
    return number;
  }
  function normalizeCurrent(payload, location, retrievedAt) {
    if (!payload || !payload.current || !payload.daily) {
      throw new TypeError("Open-Meteo response is missing current or daily data");
    }
    const current = payload.current;
    const measurements = [
      ["temperature", "temperature_2m", "°C"],
      ["apparent_temperature", "apparent_temperature", "°C"],
      ["relative_humidity", "relative_humidity_2m", "%"],
      ["precipitation", "precipitation", "mm"],
      ["wind_speed", "wind_speed_10m", "km/h"]
    ].map(([name, key, unit]) => ({ name, value: numericOrNull(current[key], key), unit }));
    const daily = payload.daily;
    const dailyTimes = Array.isArray(daily.time) ? daily.time : [];
    const dailyFields = ["weather_code", "precipitation_sum", "precipitation_probability_max", "temperature_2m_max", "temperature_2m_min", "sunrise", "sunset", "uv_index_max"];
    for (const key of dailyFields) {
      if (daily[key] !== undefined && (!Array.isArray(daily[key]) || daily[key].length !== dailyTimes.length)) {
        throw new TypeError("Daily field length mismatch: " + key);
      }
    }
    const hourly = payload.hourly || {};
    const hourlyTimes = Array.isArray(hourly.time) ? hourly.time : [];
    const hourlyFields = ["temperature_2m", "apparent_temperature", "precipitation_probability", "precipitation", "weather_code", "wind_speed_10m"];
    for (const key of hourlyFields) {
      if (hourly[key] !== undefined && (!Array.isArray(hourly[key]) || hourly[key].length !== hourlyTimes.length)) {
        throw new TypeError("Hourly field length mismatch: " + key);
      }
    }
    const dailyForecast = dailyTimes.map((date, index) => ({
      valid_date: date,
      weather_code: numericOrNull((daily.weather_code || [])[index], "weather_code"),
      precipitation: numericOrNull((daily.precipitation_sum || [])[index], "precipitation_sum"),
      precipitation_probability_max: numericOrNull((daily.precipitation_probability_max || [])[index], "precipitation_probability_max"),
      temperature_max: numericOrNull((daily.temperature_2m_max || [])[index], "temperature_2m_max"),
      temperature_min: numericOrNull((daily.temperature_2m_min || [])[index], "temperature_2m_min"),
      sunrise: (daily.sunrise || [])[index] ?? null,
      sunset: (daily.sunset || [])[index] ?? null,
      uv_index_max: numericOrNull((daily.uv_index_max || [])[index], "uv_index_max")
    }));
    const hourlyForecast = hourlyTimes.map((time, index) => ({
      valid_time: time,
      temperature: numericOrNull((hourly.temperature_2m || [])[index], "hourly.temperature_2m"),
      apparent_temperature: numericOrNull((hourly.apparent_temperature || [])[index], "hourly.apparent_temperature"),
      precipitation_probability: numericOrNull((hourly.precipitation_probability || [])[index], "hourly.precipitation_probability"),
      precipitation: numericOrNull((hourly.precipitation || [])[index], "hourly.precipitation"),
      weather_code: numericOrNull((hourly.weather_code || [])[index], "hourly.weather_code"),
      wind_speed: numericOrNull((hourly.wind_speed_10m || [])[index], "hourly.wind_speed_10m")
    }));
    return {
      schema_version: "1.1.0",
      service_id: "weather",
      provider_id: "open-meteo",
      product_id: "forecast-api",
      retrieved_at: retrievedAt || new Date().toISOString(),
      valid_time: current.time || null,
      current_weather_code: numericOrNull(current.weather_code, "current.weather_code"),
      is_day: current.is_day === 1 || current.is_day === true,
      location: location ? { id: location.id || null, name: location.name || null, latitude: location.lat, longitude: location.lon } : null,
      measurements,
      daily: dailyForecast,
      hourly: hourlyForecast,
      provenance: {
        source_url: "https://open-meteo.com/",
        license_status: "approved_with_conditions",
        attribution: "Weather data by Open-Meteo.com",
        methodology: "Numerical weather model output",
        limitations: ["Model output, not direct station observation", "Free API tier is subject to non-commercial use and published limits"]
      }
    };
  }
  return { buildCurrentUrl, normalizeCurrent };
});
