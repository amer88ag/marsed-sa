(function (root, factory) {
  const units = (typeof module === "object" && module.exports)
    ? require("../../../platform/quality/units.js")
    : root && root.UnitPolicy;
  const api = factory(units);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.OpenMeteoAdapter = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (units) {
  "use strict";
  function buildCurrentUrl(location) {
    if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lon)) {
      throw new TypeError("A location with finite lat/lon is required");
    }
    const query = new URLSearchParams({
      latitude: String(location.lat),
      longitude: String(location.lon),
      current: "temperature_2m,relative_humidity_2m,dew_point_2m,precipitation,rain,showers,wind_speed_10m,wind_direction_10m,wind_gusts_10m,apparent_temperature,weather_code,is_day,cloud_cover,pressure_msl,surface_pressure,wet_bulb_temperature_2m,cape,freezing_level_height,boundary_layer_height,soil_temperature_0_to_7cm,soil_moisture_0_to_7cm,wind_speed_80m,wind_speed_100m,wind_direction_80m,wind_direction_100m,shortwave_radiation,direct_radiation,diffuse_radiation,visibility,uv_index",
      hourly: "temperature_2m,apparent_temperature,dew_point_2m,relative_humidity_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover,pressure_msl,surface_pressure,visibility,uv_index,shortwave_radiation,wet_bulb_temperature_2m,cape,freezing_level_height,boundary_layer_height,evapotranspiration,soil_temperature_0_to_7cm,soil_temperature_7_to_28cm,soil_temperature_28_to_100cm,soil_temperature_100_to_255cm,soil_moisture_0_to_7cm,soil_moisture_7_to_28cm,soil_moisture_28_to_100cm,soil_moisture_100_to_255cm,wind_speed_80m,wind_speed_100m,wind_direction_80m,wind_direction_100m,direct_radiation,diffuse_radiation",
      daily: "weather_code,precipitation_sum,precipitation_probability_max,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,et0_fao_evapotranspiration",
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
      current: "temperature_2m,relative_humidity_2m,precipitation,rain,showers,wind_speed_10m,wind_gusts_10m,cloud_cover,pressure_msl,weather_code",
      daily: "precipitation_sum,precipitation_probability_max,temperature_2m_max,temperature_2m_min",
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
      current: "temperature_2m,relative_humidity_2m,precipitation,rain,showers,wind_speed_10m,wind_gusts_10m,cloud_cover,pressure_msl,weather_code",
      daily: "precipitation_sum,precipitation_probability_max,temperature_2m_max,temperature_2m_min",
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
  // Route forecasts must cover now + 48 h. Open-Meteo `forecast_days` counts Saudi
  // calendar days from today 00:00, so 2 days is NOT a rolling 48 h window.
  // Callers pass RouteItinerary.requiredForecastDays(now); the default (4) always
  // covers 48 h plus the 30-minute ETA matching tolerance.
  const ROUTE_FORECAST_DAYS_DEFAULT = 4;
  function buildRouteWeatherBatchUrl(locations, options) {
    const forecastDays = options && options.forecastDays !== undefined ? Number(options.forecastDays) : ROUTE_FORECAST_DAYS_DEFAULT;
    if (!Number.isInteger(forecastDays) || forecastDays < 1 || forecastDays > 16) {
      throw new RangeError("forecastDays must be an integer between 1 and 16");
    }
    if (!Array.isArray(locations) || locations.length === 0 ||
        locations.some(location => !location || !Number.isFinite(location.lat) || !Number.isFinite(location.lon))) {
      throw new TypeError("A non-empty list of route points with finite lat/lon is required");
    }
    const query = new URLSearchParams({
      latitude: locations.map(location => String(location.lat)).join(","),
      longitude: locations.map(location => String(location.lon)).join(","),
      hourly: "temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m",
      forecast_days: String(forecastDays),
      timezone: locations.map(() => "Asia/Riyadh").join(",")
    });
    return "https://api.open-meteo.com/v1/forecast?" + query.toString();
  }
  function normalizeRouteWeatherBatch(payload, locations, retrievedAt) {
    if (!Array.isArray(payload) || payload.length !== locations.length) {
      throw new TypeError("Open-Meteo route weather response length mismatch");
    }
    return payload.map((item, index) => {
      const quality = newQuality();
      const hourly = guardBlock(item && item.hourly, item && item.hourly_units, quality, "hourly");
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
          unit_mismatches: quality.unit_mismatches,
          unverified_units: quality.unverified_units,
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
    const quality = newQuality();
    const current = guardBlock(payload.current, payload.current_units, quality, "current");
    const daily = guardBlock(payload.daily, payload.daily_units, quality, "daily");
    return {
      provider_id: "open-meteo",
      retrieved_at: retrievedAt || new Date().toISOString(),
      valid_time: current.time || null,
      valid_interval_seconds: numericOrNull(current.interval, "current.interval"),
      quality: quality,
      location: { id: location.id, name: location.name, latitude: location.lat, longitude: location.lon, elevation_m: numericOrNull(payload.elevation, "elevation") },
      current: {
        temperature: numericOrNull(current.temperature_2m, "temperature_2m"),
        relative_humidity: numericOrNull(current.relative_humidity_2m, "relative_humidity_2m"),
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
        precipitation_probability_max: numericOrNull((daily.precipitation_probability_max || [])[0], "precipitation_probability_max"),
        temperature_max: numericOrNull((daily.temperature_2m_max || [])[0], "temperature_2m_max"),
        temperature_min: numericOrNull((daily.temperature_2m_min || [])[0], "temperature_2m_min")
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
  // Units policy lives in src/platform/quality/units.js (shared with the orchard service).
  const { FIELD_UNITS, unitStatus, guardBlock, newQuality } = units;
  function normalizeCurrent(payload, location, retrievedAt) {
    if (!payload || !payload.current || !payload.daily) {
      throw new TypeError("Open-Meteo response is missing current or daily data");
    }
    const quality = newQuality();
    const current = guardBlock(payload.current, payload.current_units, quality, "current");
    const measurements = [
      ["temperature", "temperature_2m", "°C"],
      ["apparent_temperature", "apparent_temperature", "°C"],
      ["relative_humidity", "relative_humidity_2m", "%"],
      ["precipitation", "precipitation", "mm"],
      ["wind_speed", "wind_speed_10m", "km/h"],
      ["wind_direction", "wind_direction_10m", "°"],
      ["wind_gusts", "wind_gusts_10m", "km/h"],
      ["wet_bulb_temperature", "wet_bulb_temperature_2m", "°C"],
      ["cape", "cape", "J/kg"],
      ["freezing_level_height", "freezing_level_height", "m"],
      ["boundary_layer_height", "boundary_layer_height", "m"],
      ["soil_temperature_0_7cm", "soil_temperature_0_to_7cm", "°C"],
      ["soil_moisture_0_7cm", "soil_moisture_0_to_7cm", "m³/m³"],
      ["wind_speed_80m", "wind_speed_80m", "km/h"],
      ["wind_speed_100m", "wind_speed_100m", "km/h"],
      ["wind_direction_80m", "wind_direction_80m", "°"],
      ["wind_direction_100m", "wind_direction_100m", "°"],
      ["shortwave_radiation", "shortwave_radiation", "W/m²"],
      ["direct_radiation", "direct_radiation", "W/m²"],
      ["diffuse_radiation", "diffuse_radiation", "W/m²"],
      ["dew_point", "dew_point_2m", "°C"],
      ["cloud_cover", "cloud_cover", "%"],
      ["pressure_msl", "pressure_msl", "hPa"],
      ["surface_pressure", "surface_pressure", "hPa"]
    ].map(([name, key, unit]) => ({
      name, unit, value: numericOrNull(current[key], key), unit_status: unitStatus(payload.current_units, key)
    }));
    const daily = guardBlock(payload.daily, payload.daily_units, quality, "daily");
    const dailyTimes = Array.isArray(daily.time) ? daily.time : [];
    const dailyFields = ["weather_code", "precipitation_sum", "precipitation_probability_max", "temperature_2m_max", "temperature_2m_min", "sunrise", "sunset", "uv_index_max", "et0_fao_evapotranspiration"];
    for (const key of dailyFields) {
      if (daily[key] !== undefined && (!Array.isArray(daily[key]) || daily[key].length !== dailyTimes.length)) {
        throw new TypeError("Daily field length mismatch: " + key);
      }
    }
    const hourly = guardBlock(payload.hourly || {}, payload.hourly_units, quality, "hourly");
    const hourlyTimes = Array.isArray(hourly.time) ? hourly.time : [];
    const hourlyFields = ["temperature_2m", "apparent_temperature", "dew_point_2m", "relative_humidity_2m", "precipitation_probability", "precipitation", "weather_code", "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m", "cloud_cover", "pressure_msl", "surface_pressure", "visibility", "uv_index", "shortwave_radiation", "wet_bulb_temperature_2m", "cape", "freezing_level_height", "boundary_layer_height", "evapotranspiration", "soil_temperature_0_to_7cm", "soil_temperature_7_to_28cm", "soil_temperature_28_to_100cm", "soil_temperature_100_to_255cm", "soil_moisture_0_to_7cm", "soil_moisture_7_to_28cm", "soil_moisture_28_to_100cm", "soil_moisture_100_to_255cm", "wind_speed_80m", "wind_speed_100m", "wind_direction_80m", "wind_direction_100m", "direct_radiation", "diffuse_radiation"];
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
      uv_index_max: numericOrNull((daily.uv_index_max || [])[index], "uv_index_max"),
      et0_fao_evapotranspiration: numericOrNull((daily.et0_fao_evapotranspiration || [])[index], "et0_fao_evapotranspiration")
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
      shortwave_radiation: numericOrNull((hourly.shortwave_radiation || [])[index], "hourly.shortwave_radiation"),
      wet_bulb_temperature: numericOrNull((hourly.wet_bulb_temperature_2m || [])[index], "hourly.wet_bulb_temperature_2m"),
      cape: numericOrNull((hourly.cape || [])[index], "hourly.cape"),
      freezing_level_height: numericOrNull((hourly.freezing_level_height || [])[index], "hourly.freezing_level_height"),
      boundary_layer_height: numericOrNull((hourly.boundary_layer_height || [])[index], "hourly.boundary_layer_height"),
      evapotranspiration: numericOrNull((hourly.evapotranspiration || [])[index], "hourly.evapotranspiration"),
      soil_temperature_0_7cm: numericOrNull((hourly.soil_temperature_0_to_7cm || [])[index], "hourly.soil_temperature_0_to_7cm"),
      soil_temperature_7_28cm: numericOrNull((hourly.soil_temperature_7_to_28cm || [])[index], "hourly.soil_temperature_7_to_28cm"),
      soil_temperature_28_100cm: numericOrNull((hourly.soil_temperature_28_to_100cm || [])[index], "hourly.soil_temperature_28_to_100cm"),
      soil_temperature_100_255cm: numericOrNull((hourly.soil_temperature_100_to_255cm || [])[index], "hourly.soil_temperature_100_to_255cm"),
      soil_moisture_0_7cm: numericOrNull((hourly.soil_moisture_0_to_7cm || [])[index], "hourly.soil_moisture_0_to_7cm"),
      soil_moisture_7_28cm: numericOrNull((hourly.soil_moisture_7_to_28cm || [])[index], "hourly.soil_moisture_7_to_28cm"),
      soil_moisture_28_100cm: numericOrNull((hourly.soil_moisture_28_to_100cm || [])[index], "hourly.soil_moisture_28_to_100cm"),
      soil_moisture_100_255cm: numericOrNull((hourly.soil_moisture_100_to_255cm || [])[index], "hourly.soil_moisture_100_to_255cm"),
      wind_speed_80m: numericOrNull((hourly.wind_speed_80m || [])[index], "hourly.wind_speed_80m"),
      wind_speed_100m: numericOrNull((hourly.wind_speed_100m || [])[index], "hourly.wind_speed_100m"),
      wind_direction_80m: numericOrNull((hourly.wind_direction_80m || [])[index], "hourly.wind_direction_80m"),
      wind_direction_100m: numericOrNull((hourly.wind_direction_100m || [])[index], "hourly.wind_direction_100m"),
      direct_radiation: numericOrNull((hourly.direct_radiation || [])[index], "hourly.direct_radiation"),
      diffuse_radiation: numericOrNull((hourly.diffuse_radiation || [])[index], "hourly.diffuse_radiation")
    }));
    return {
      schema_version: "1.1.0",
      service_id: "weather",
      provider_id: "open-meteo",
      product_id: "forecast-api",
      retrieved_at: retrievedAt || new Date().toISOString(),
      valid_time: current.time || null,
      // Length of the period the "current" values describe (Open-Meteo: 900 s).
      valid_interval_seconds: numericOrNull(current.interval, "current.interval"),
      time_zone: payload.timezone || null,
      // Local time strings are parsed as UTC+03:00; record what the provider used.
      utc_offset_seconds: numericOrNull(payload.utc_offset_seconds, "utc_offset_seconds"),
      quality: quality,
      current_weather_code: numericOrNull(current.weather_code, "current.weather_code"),
      is_day: current.is_day === 1 || current.is_day === true ? true : current.is_day === 0 || current.is_day === false ? false : null,
      location: location ? { id: location.id || null, name: location.name || null, latitude: location.lat, longitude: location.lon, elevation_m: numericOrNull(payload.elevation, "elevation") } : null,
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
  return { FIELD_UNITS, unitStatus, ROUTE_FORECAST_DAYS_DEFAULT, buildCurrentUrl, normalizeCurrent, buildOverviewUrl, normalizeOverview, buildOverviewBatchUrl, normalizeOverviewBatch, buildRouteWeatherBatchUrl, normalizeRouteWeatherBatch };
});
