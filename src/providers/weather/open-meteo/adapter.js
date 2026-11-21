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
      current: "temperature_2m,relative_humidity_2m,precipitation,rain,showers,wind_speed_10m",
      hourly: "precipitation",
      daily: "precipitation_sum,temperature_2m_max,temperature_2m_min",
      past_days: "7",
      forecast_days: "7",
      timezone: "Asia/Riyadh"
    });
    return "https://api.open-meteo.com/v1/forecast?" + query.toString();
  }
  function normalizeCurrent(payload, location, retrievedAt) {
    if (!payload || !payload.current || !payload.daily) {
      throw new TypeError("Open-Meteo response is missing current or daily data");
    }
    const current = payload.current;
    const required = ["temperature_2m", "relative_humidity_2m", "precipitation", "wind_speed_10m"];
    for (const key of required) {
      if (current[key] !== null && current[key] !== undefined && !Number.isFinite(Number(current[key]))) {
        throw new TypeError("Invalid numeric field: " + key);
      }
    }
    const times = Array.isArray(payload.daily.time) ? payload.daily.time : [];
    const rain = Array.isArray(payload.daily.precipitation_sum) ? payload.daily.precipitation_sum : [];
    if (times.length !== rain.length) throw new TypeError("Daily dates and precipitation arrays must have equal length");
    return {
      schema_version: "1.0.0",
      service_id: "weather",
      provider_id: "open-meteo",
      product_id: "forecast-api",
      retrieved_at: retrievedAt || new Date().toISOString(),
      valid_time: current.time || null,
      location: location ? { id: location.id || null, name: location.name || null, latitude: location.lat, longitude: location.lon } : null,
      measurements: [
        { name: "temperature", value: current.temperature_2m ?? null, unit: "°C" },
        { name: "relative_humidity", value: current.relative_humidity_2m ?? null, unit: "%" },
        { name: "precipitation", value: current.precipitation ?? null, unit: "mm" },
        { name: "wind_speed", value: current.wind_speed_10m ?? null, unit: "km/h" }
      ],
      daily: times.map((date, index) => ({
        valid_date: date,
        precipitation: rain[index] ?? null,
        unit: "mm/day"
      })),
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
