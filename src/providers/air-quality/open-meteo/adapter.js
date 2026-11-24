(function (root, factory) {
  const api = factory();
  if (root) root.OpenMeteoAirQualityAdapter = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const FIELDS = ["european_aqi", "us_aqi", "pm2_5", "pm10", "dust", "ozone", "nitrogen_dioxide", "sulphur_dioxide", "carbon_monoxide"];
  function validateLocation(location) {
    if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lon)) {
      throw new TypeError("A location with finite lat/lon is required");
    }
  }
  function buildUrl(location) {
    validateLocation(location);
    const query = new URLSearchParams({
      latitude: String(location.lat),
      longitude: String(location.lon),
      current: FIELDS.join(","),
      hourly: FIELDS.join(","),
      forecast_days: "5",
      timezone: "Asia/Riyadh",
      domains: "cams_global"
    });
    return "https://air-quality-api.open-meteo.com/v1/air-quality?" + query.toString();
  }
  function value(source, key) {
    const raw = source && source[key];
    return raw === null || raw === undefined || raw === "" || !Number.isFinite(Number(raw)) ? null : Number(raw);
  }
  function normalize(payload, location, retrievedAt) {
    if (!payload || !payload.current || !payload.hourly || !Array.isArray(payload.hourly.time)) {
      throw new TypeError("Air quality response is missing current or hourly data");
    }
    const current = {};
    FIELDS.forEach(key => { current[key] = value(payload.current, key); });
    const hourly = payload.hourly;
    FIELDS.forEach(key => {
      if (hourly[key] !== undefined && (!Array.isArray(hourly[key]) || hourly[key].length !== hourly.time.length)) {
        throw new TypeError("Air quality hourly field length mismatch: " + key);
      }
    });
    const forecast = hourly.time.map((time, index) => {
      const row = { valid_time: time };
      FIELDS.forEach(key => { row[key] = value({ [key]: (hourly[key] || [])[index] }, key); });
      return row;
    });
    return {
      schema_version: "1.0.0",
      service_id: "air-quality",
      provider_id: "open-meteo",
      product_id: "cams-global-air-quality",
      retrieved_at: retrievedAt || new Date().toISOString(),
      valid_time: payload.current.time || null,
      location: location ? { id: location.id || null, name: location.name || null, latitude: location.lat, longitude: location.lon } : null,
      current,
      hourly: forecast,
      provenance: {
        source_url: "https://open-meteo.com/en/docs/air-quality-api",
        model: "CAMS Global",
        classification: "model_forecast_not_station_observation",
        attribution: "Air quality data by Open-Meteo.com",
        license_status: "approved_with_conditions"
      }
    };
  }
  return { buildUrl, normalize, fields: FIELDS.slice() };
});
