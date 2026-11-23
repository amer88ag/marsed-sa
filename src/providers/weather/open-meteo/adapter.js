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
      current: "temperature_2m,relative_humidity_2m,dew_point_2m,precipitation,rain,showers,wind_speed_10m,wind_direction_10m,wind_gusts_10m,apparent_temperature,weather_code,is_day,cloud_cover,pressure_msl,surface_pressure",
      hourly: "temperature_2m,apparent_temperature,dew_point_2m,relative_humidity_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover,pressure_msl,surface_pressure,visibility,uv_index,shortwave_radiation",
      daily: "weather_code,precipitation_sum,precipitation_probability_max,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max",
      past_days: "0",
      forecast_days: "7",
      timezone: "Asia/Riyadh"
    });
    return "https://api.open-meteo.com/v1/forecast?" + query.toString();
  }
  function buildOverviewUrl(location) {
    if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lon)) {
      throw new TypeError("A location with finite lat/lon is required");
    }
    const query = new URLSearchParams({
      latitude: String(location.lat),
      longitude: String(location.lon),
      current: "temperature_2m,precipitation,rain,showers,wind_speed_10m,weather_code",
      daily: "precipitation_sum,precipitation_probability_max",
      forecast_days: "1",
      timezone: "Asia/Riyadh"
    });
    return "https://api.open-meteo.com/v1/forecast?" + query.toString();
  }
  function buildOverviewBatchUrl(locations) {
    if (!Array.isArray(locations) || locations.length === 0 ||
        locations.some(location => !location || !Number.isFinite(location.lat) || !Number.isFinite(location.lon))) {
      throw new TypeError("A non-empty list of locations with finite lat/lon is required");
    }
    const query = new URLSearchParams({
      latitude: locations.map(location => String(location.lat)).join(","),
      longitude: locations.map(location => String(location.lon)).join(","),
      current: "temperature_2m,precipitation,rain,showers,wind_speed_10m,weather_code",
      daily: "precipitation_sum,precipitation_probability_max",
      forecast_days: "1",
      timezone: locations.map(() => "Asia/Riyadh").join(",")
    });
    return "https://api.open-meteo.com/v1/forecast?" + query.toString();
  }
  function normalizeOverviewBatch(payload, locations, retrievedAt) {
    if (!Array.isArray(payload) || payload.length !== locations.length) {
      throw new TypeError("Open-Meteo multi-location response length mismatch");
    }
    return payload.map((item, index) => {
      const location = locations[index];
      try {
        return { location_id: location.id, data: normalizeOverview(item, location, retrievedAt), error: null };
      } catch (error) {
        return { location_id: location.id, data: null, error: error.message };
      }
    });
  }
  function buildRouteWeatherBatchUrl(locations) {
    if (!Array.isArray(locations) || locations.length === 0 ||
        locations.some(location => !location || !Number.isFinite(location.lat) || !Number.isFinite(location.lon))) {
      throw new TypeError("A non-empty list of route points with finite lat/lon is required");
    }
    const query = new URLSearchParams({
      latitude: locations.map(location => String(location.lat)).join(","),
      longitude: locations.map(location => String(location.lon)).join(","),
      hourly: "temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m",
      forecast_days: "2",
      timezone: locations.map(() => "Asia/Riyadh").join(",")
    });
    return "https://api.open-meteo.com/v1/forecast?" + query.toString();
  }
  function normalizeRouteWeatherBatch(payload, locations, retrievedAt) {
    if (!Array.isArray(payload) || payload.length !== locations.length) {
      throw new TypeError("Open-Meteo route weather response length mismatch");
    }
    return payload.map((item, index) => {
      const hourly = item && item.hourly;
      if (!hourly || !Array.isArray(hourly.time)) {
        return { location_id: locations[index].id, hourly: null, error: "Hourly forecast unavailable" };
      }
      const times = hourly.time;
      const fields = ["temperature_2m", "precipitation_probability", "precipitation", "weather_code", "wind_speed_10m"];
      for (const key of fields) {
        if (hourly[key] !== undefined && (!Array.isArray(hourly[key]) || hourly[key].length !== times.length)) {
          return { location_id: locations[index].id, hourly: null, error: "Hourly field length mismatch: " + key };
        }
      }
      try {
        const rows = times.map((time, rowIndex) => ({
          valid_time: time,
          temperature: numericOrNull((hourly.temperature_2m || [])[rowIndex], "hourly.temperature_2m"),
          precipitation_probability: numericOrNull((hourly.precipitation_probability || [])[rowIndex], "hourly.precipitation_probability"),
          precipitation: numericOrNull((hourly.precipitation || [])[rowIndex], "hourly.precipitation"),
          weather_code: numericOrNull((hourly.weather_code || [])[rowIndex], "hourly.weather_code"),
          wind_speed: numericOrNull((hourly.wind_speed_10m || [])[rowIndex], "hourly.wind_speed_10m")
        }));
        return {
          location_id: locations[index].id,
          hourly: rows,
          retrieved_at: retrievedAt || new Date().toISOString(),
          provider_id: "open-meteo",
          error: null
        };
      } catch (error) {
        return { location_id: locations[index].id, hourly: null, error: error.message };
      }
    });
  }
  function normalizeOverview(payload, location, retrievedAt) {
    if (!payload || !payload.current || !payload.daily || !Array.isArray(payload.daily.time) || !payload.daily.time.length) {
      throw new TypeError("Open-Meteo overview response is incomplete");
    }
    const current = payload.current, daily = payload.daily;
    return {
      provider_id: "open-meteo",
      retrieved_at: retrievedAt || new Date().toISOString(),
      valid_time: current.time || null,
      location: { id: location.id, name: location.name, latitude: location.lat, longitude: location.lon, elevation_m: numericOrNull(payload.elevation, "elevation") },
      current: {
        temperature: numericOrNull(current.temperature_2m, "temperature_2m"),
        precipitation: numericOrNull(current.precipitation, "precipitation"),
        rain: numericOrNull(current.rain, "rain"),
        showers: numericOrNull(current.showers, "showers"),
        wind_speed: numericOrNull(current.wind_speed_10m, "wind_speed_10m"),
        wind_direction: numericOrNull(current.wind_direction_10m, "wind_direction_10m"),
        wind_gusts: numericOrNull(current.wind_gusts_10m, "wind_gusts_10m"),
        dew_point: numericOrNull(current.dew_point_2m, "dew_point_2m"),
        cloud_cover: numericOrNull(current.cloud_cover, "cloud_cover"),
        pressure_msl: numericOrNull(current.pressure_msl, "pressure_msl"),
        surface_pressure: numericOrNull(current.surface_pressure, "surface_pressure"),
        weather_code: numericOrNull(current.weather_code, "weather_code")
      },
      today: {
        date: daily.time[0],
        precipitation: numericOrNull((daily.precipitation_sum || [])[0], "precipitation_sum"),
        precipitation_probability_max: numericOrNull((daily.precipitation_probability_max || [])[0], "precipitation_probability_max")
      },
      provenance: {
        source_url: "https://open-meteo.com/",
        attribution: "Weather data by Open-Meteo.com",
        methodology: "Numerical weather model output",
        limitations: ["Model output, not direct station observation", "Not an official warning"]
      }
    };
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
      ["wind_speed", "wind_speed_10m", "km/h"],
      ["wind_direction", "wind_direction_10m", "°"],
      ["wind_gusts", "wind_gusts_10m", "km/h"],
      ["dew_point", "dew_point_2m", "°C"],
      ["cloud_cover", "cloud_cover", "%"],
      ["pressure_msl", "pressure_msl", "hPa"],
      ["surface_pressure", "surface_pressure", "hPa"]
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
    const hourlyFields = ["temperature_2m", "apparent_temperature", "dew_point_2m", "relative_humidity_2m", "precipitation_probability", "precipitation", "weather_code", "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m", "cloud_cover", "pressure_msl", "surface_pressure", "visibility", "uv_index", "shortwave_radiation"];
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
      wind_speed: numericOrNull((hourly.wind_speed_10m || [])[index], "hourly.wind_speed_10m"),
      dew_point: numericOrNull((hourly.dew_point_2m || [])[index], "hourly.dew_point_2m"),
      relative_humidity: numericOrNull((hourly.relative_humidity_2m || [])[index], "hourly.relative_humidity_2m"),
      wind_direction: numericOrNull((hourly.wind_direction_10m || [])[index], "hourly.wind_direction_10m"),
      wind_gusts: numericOrNull((hourly.wind_gusts_10m || [])[index], "hourly.wind_gusts_10m"),
      cloud_cover: numericOrNull((hourly.cloud_cover || [])[index], "hourly.cloud_cover"),
      pressure_msl: numericOrNull((hourly.pressure_msl || [])[index], "hourly.pressure_msl"),
      surface_pressure: numericOrNull((hourly.surface_pressure || [])[index], "hourly.surface_pressure"),
      visibility: numericOrNull((hourly.visibility || [])[index], "hourly.visibility"),
      uv_index: numericOrNull((hourly.uv_index || [])[index], "hourly.uv_index"),
      shortwave_radiation: numericOrNull((hourly.shortwave_radiation || [])[index], "hourly.shortwave_radiation")
    }));
    return {
      schema_version: "1.1.0",
      service_id: "weather",
      provider_id: "open-meteo",
      product_id: "forecast-api",
      retrieved_at: retrievedAt || new Date().toISOString(),
      valid_time: current.time || null,
      current_weather_code: numericOrNull(current.weather_code, "current.weather_code"),
      is_day: current.is_day === 1 || current.is_day === true ? true : current.is_day === 0 || current.is_day === false ? false : null,
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
  return { buildCurrentUrl, normalizeCurrent, buildOverviewUrl, normalizeOverview, buildOverviewBatchUrl, normalizeOverviewBatch, buildRouteWeatherBatchUrl, normalizeRouteWeatherBatch };
});
