(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.IndicatorCatalog = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  // Unified catalogue of every indicator the observatory shows. Data types:
  //   model      — numerical weather model value for the current interval (not an observation)
  //   forecast   — model forecast for a future time
  //   reanalysis — model reconstruction of the past (ERA5 and successors)
  //   estimate   — satellite/station blended estimate (CHIRPS)
  //   imagery    — satellite imagery (visual product, not a measured quantity)
  //   terrain    — digital elevation model
  //   derived    — computed by the observatory from other indicators
  // No indicator in this site is a ground station observation.
  const TYPE_LABELS = {
    model: "ناتج نموذج (الفترة الحالية)", forecast: "توقع نموذجي", reanalysis: "إعادة تحليل",
    estimate: "تقدير (أقمار صناعية + محطات)", imagery: "صورة أقمار صناعية", terrain: "نموذج تضاريس", derived: "قيمة مشتقة"
  };
  const OM = "Open-Meteo Forecast API";
  const OM_GRID = "شبكة النموذج الذي يختاره Open-Meteo تلقائياً (best_match)؛ لا تذكر الاستجابة اسم النموذج ولا دقته";
  const CURRENT_TIME = "قيمة الفترة الحالية (طول الفترة من current.interval، عادة 15 دقيقة) بتوقيت السعودية";

  function om(id, key, nameAr, nameEn, unit, limits, extra) {
    return Object.assign({
      id: id, provider_key: key, name_ar: nameAr, name_en: nameEn, unit: unit, data_type: "model", source: OM,
      time_semantics: CURRENT_TIME, spatial_resolution: OM_GRID, temporal_resolution: "15 دقيقة (current)", limits: limits
    }, extra || {});
  }

  const CURRENT = [
    om("temperature", "temperature_2m", "درجة حرارة الهواء", "Air temperature (2 m)", "°C", "حرارة الهواء على ارتفاع 2 م وليست حرارة سطح الأرض أو التربة"),
    om("apparent_temperature", "apparent_temperature", "الحرارة المحسوسة", "Apparent temperature", "°C", "مؤشر راحة حرارية من الحرارة والرطوبة والرياح والإشعاع؛ ليست حرارة البصيلة الرطبة"),
    om("relative_humidity", "relative_humidity_2m", "الرطوبة النسبية", "Relative humidity (2 m)", "%", "رطوبة الهواء وليست رطوبة التربة"),
    om("precipitation", "precipitation", "الهطول خلال الفترة الحالية", "Precipitation (current interval)", "mm", "مجموع الفترة الحالية فقط (عادة 15 دقيقة)، لا مجموع اليوم؛ ناتج نموذج وليس مقياس مطر"),
    om("wind_speed", "wind_speed_10m", "سرعة الرياح السطحية", "Wind speed (10 m)", "km/h", "على ارتفاع 10 م؛ تختلف عن رياح 80/100/120 م"),
    om("wind_direction", "wind_direction_10m", "اتجاه الرياح", "Wind direction (10 m)", "°", "الاتجاه القادم منه الهواء"),
    om("wind_gusts", "wind_gusts_10m", "هبات الرياح", "Wind gusts (10 m)", "km/h", "أقصى هبة في الفترة السابقة (15 دقيقة) وفق النموذج، لا أقصى هبة لليوم"),
    om("wet_bulb_temperature", "wet_bulb_temperature_2m", "حرارة البصيلة الرطبة", "Wet-bulb temperature (2 m)", "°C", "تختلف عن الحرارة المحسوسة؛ ليست مؤشر إجهاد حراري رسمياً"),
    om("cape", "cape", "طاقة الحمل الحراري المتاحة", "CAPE", "J/kg", "مؤشر قابلية الحمل، لا يعني حدوث عواصف"),
    om("freezing_level_height", "freezing_level_height", "ارتفاع مستوى التجمد", "Freezing level height", "m", "فوق مستوى سطح البحر"),
    om("boundary_layer_height", "boundary_layer_height", "ارتفاع الطبقة الحدية", "Boundary layer height", "m", "فوق سطح الأرض؛ يتغير بقوة خلال اليوم"),
    om("soil_temperature_0_7cm", "soil_temperature_0_to_7cm", "حرارة التربة 0–7 سم", "Soil temperature 0–7 cm", "°C", "حرارة التربة في النموذج، ليست حرارة الهواء ولا حرارة سطح الأرض الفضائية (LST)"),
    om("soil_moisture_0_7cm", "soil_moisture_0_to_7cm", "رطوبة التربة 0–7 سم", "Soil moisture 0–7 cm", "m³/m³", "محتوى مائي حجمي في النموذج؛ ليست الرطوبة النسبية ولا قياس حساس تربة"),
    om("wind_speed_80m", "wind_speed_80m", "سرعة الرياح على 80 م", "Wind speed (80 m)", "km/h", "ليست رياح السطح (10 م)"),
    om("wind_speed_100m", "wind_speed_100m", "سرعة الرياح على 100 م", "Wind speed (100 m)", "km/h", "ليست رياح السطح (10 م)"),
    om("wind_direction_80m", "wind_direction_80m", "اتجاه الرياح على 80 م", "Wind direction (80 m)", "°", "غير معروض حالياً في الواجهة"),
    om("wind_direction_100m", "wind_direction_100m", "اتجاه الرياح على 100 م", "Wind direction (100 m)", "°", "غير معروض حالياً في الواجهة"),
    om("shortwave_radiation", "shortwave_radiation", "الإشعاع الشمسي الكلي", "Shortwave radiation (GHI)", "W/m²", "متوسط الفترة السابقة (15 دقيقة في القيم الحالية) في النموذج"),
    om("direct_radiation", "direct_radiation", "الإشعاع المباشر", "Direct radiation", "W/m²", "على سطح أفقي"),
    om("diffuse_radiation", "diffuse_radiation", "الإشعاع المنتشر", "Diffuse radiation", "W/m²", "على سطح أفقي"),
    om("dew_point", "dew_point_2m", "نقطة الندى", "Dew point (2 m)", "°C", "مؤشر رطوبة مطلقة، ليست حرارة الهواء"),
    om("cloud_cover", "cloud_cover", "الغطاء السحابي", "Cloud cover", "%", "نسبة السماء المغطاة في النموذج"),
    om("pressure_msl", "pressure_msl", "الضغط المختزل إلى مستوى سطح البحر", "Mean sea-level pressure", "hPa", "قيمة مختزلة للمقارنة بين المواقع؛ ليست الضغط الفعلي في الموقع المرتفع"),
    om("surface_pressure", "surface_pressure", "الضغط عند سطح الموقع", "Surface pressure", "hPa", "الضغط الفعلي عند ارتفاع تضاريس النموذج؛ أقل بكثير في المرتفعات ولا يقارن بضغط مستوى البحر")
  ];

  const DAILY = [
    { id: "daily_precipitation_sum", provider_key: "precipitation_sum", name_ar: "مجموع الهطول اليومي المتوقع", name_en: "Daily precipitation sum", unit: "mm", data_type: "forecast", source: OM, time_semantics: "يوم تقويمي سعودي (00:00–24:00 Asia/Riyadh)", spatial_resolution: OM_GRID, temporal_resolution: "يومي", limits: "توقع نموذجي وليس رصداً؛ لا يقارن مباشرة بتقدير CHIRPS" },
    { id: "daily_precipitation_probability_max", provider_key: "precipitation_probability_max", name_ar: "أعلى احتمال هطول في اليوم", name_en: "Max precipitation probability", unit: "%", data_type: "forecast", source: OM + " (نماذج مجموعات)", time_semantics: "يوم تقويمي سعودي", spatial_resolution: "نماذج مجموعات بدقة 0.25° (~27 كم)", temporal_resolution: "يومي", limits: "احتمال من مجموعة نماذج، ليس كمية" },
    { id: "daily_temperature_max", provider_key: "temperature_2m_max", name_ar: "العظمى اليومية", name_en: "Daily max temperature", unit: "°C", data_type: "forecast", source: OM, time_semantics: "يوم تقويمي سعودي", spatial_resolution: OM_GRID, temporal_resolution: "يومي", limits: "حرارة هواء 2 م" },
    { id: "daily_temperature_min", provider_key: "temperature_2m_min", name_ar: "الصغرى اليومية", name_en: "Daily min temperature", unit: "°C", data_type: "forecast", source: OM, time_semantics: "يوم تقويمي سعودي", spatial_resolution: OM_GRID, temporal_resolution: "يومي", limits: "حرارة هواء 2 م؛ ليست حرارة سطح النبات" },
    { id: "daily_uv_index_max", provider_key: "uv_index_max", name_ar: "أقصى مؤشر للأشعة فوق البنفسجية", name_en: "Max UV index", unit: "index", data_type: "forecast", source: OM, time_semantics: "يوم تقويمي سعودي", spatial_resolution: OM_GRID, temporal_resolution: "يومي", limits: "بلا وحدة" },
    { id: "daily_et0", provider_key: "et0_fao_evapotranspiration", name_ar: "البخر-نتح المرجعي ET₀", name_en: "Reference evapotranspiration (FAO-56)", unit: "mm", data_type: "forecast", source: OM, time_semantics: "يوم تقويمي سعودي", spatial_resolution: OM_GRID, temporal_resolution: "يومي", limits: "قيمة مرجعية لعشب قصير؛ ليست كمية ري فعلية" }
  ];

  const OTHER = [
    { id: "chirps_sat", provider_key: "DAILY-SAT-FINAL", name_ar: "أمطار CHIRPS (SAT)", name_en: "CHIRPS v3 daily SAT final", unit: "mm/day", data_type: "estimate", source: "CHIRPS v3.0 (Climate Hazards Center, UCSB)", time_semantics: "تسمية يومية ناتجة عن توزيع مجاميع الخماسية باستخدام IMERG Late V07؛ ليست نافذة رصد محطة", spatial_resolution: "0.05° (أقرب خلية لإحداثيات المدينة)", temporal_resolution: "يومي مشتق من الخماسية", limits: "عينة محفوظة قصيرة؛ ليست متوسط المدينة ولا قراءة محطة ولا تغطية وطنية" },
    { id: "chirps_rnl", provider_key: "DAILY-RNL", name_ar: "أمطار CHIRPS (RNL)", name_en: "CHIRPS v3 daily RNL final", unit: "mm/day", data_type: "estimate", source: "CHIRPS v3.0 (Climate Hazards Center, UCSB)", time_semantics: "توزيع يومي باستخدام ERA5", spatial_resolution: "0.05° (أقرب خلية)", temporal_resolution: "يومي مشتق من الخماسية", limits: "منتج مستقل عن SAT ولا يُدمج معه" },
    { id: "orchard_forecast", provider_key: "forecast-api/daily", name_ar: "توقعات مساعد البستان", name_en: "Orchard 7-day forecast", unit: "°C, mm", data_type: "forecast", source: OM, time_semantics: "أيام تقويمية سعودية قادمة", spatial_resolution: OM_GRID, temporal_resolution: "يومي", limits: "نقطة شبكة النموذج لا المزرعة" },
    { id: "orchard_reanalysis", provider_key: "archive-api/daily", name_ar: "الأيام السابقة في مساعد البستان", name_en: "Orchard past 7 days", unit: "°C, mm", data_type: "reanalysis", source: "Open-Meteo Historical Weather API", time_semantics: "أيام تقويمية سعودية سابقة؛ الأحدث قد يكون غير متاح بعد", spatial_resolution: "شبكة إعادة التحليل (لا تذكرها الاستجابة)", temporal_resolution: "يومي", limits: "إعادة تحليل وليست قياس محطة" },
    { id: "elevation_dem", provider_key: "elevation", name_ar: "ارتفاع التضاريس", name_en: "Terrain elevation", unit: "m", data_type: "terrain", source: "Copernicus DEM GLO-90 عبر Open-Meteo Elevation API", time_semantics: "نموذج ثابت (إصدار 2021)", spatial_resolution: "~90 م", temporal_resolution: "ثابت", limits: "ليس مسحاً ميدانياً ولا ارتفاع مبانٍ" },
    { id: "downscaling_elevation", provider_key: "elevation (forecast payload)", name_ar: "الارتفاع المستخدم في تصحيح النموذج", name_en: "Downscaling elevation", unit: "m", data_type: "terrain", source: OM + " (نموذج تضاريس 90 م)", time_semantics: "ثابت", spatial_resolution: "~90 م عند الإحداثيات المطلوبة", temporal_resolution: "ثابت", limits: "ارتفاع DEM عند الإحداثيات وليس متوسط ارتفاع خلية النموذج؛ ليس مسحاً ميدانياً" },
    { id: "gibs_true_color", provider_key: "CorrectedReflectance_TrueColor", name_ar: "صور الألوان الطبيعية", name_en: "Corrected reflectance true colour", unit: "—", data_type: "imagery", source: "NASA GIBS (VIIRS SNPP، MODIS Terra/Aqua)", time_semantics: "تاريخ المنتج اليومي (UTC)، يجمع ممرات نهارية متعددة", spatial_resolution: "بلاطات GoogleMapsCompatible_Level9 (~306 م/بكسل عند خط الاستواء)", temporal_resolution: "يومي", limits: "صورة مرئية لا قيمة فيزيائية؛ قد تحتوي فجوات مرور" },
    { id: "gibs_721", provider_key: "CorrectedReflectance_Bands721", name_ar: "ألوان زائفة 7-2-1", name_en: "Bands 7-2-1", unit: "—", data_type: "imagery", source: "NASA GIBS (MODIS Terra)", time_semantics: "تاريخ المنتج اليومي (UTC)", spatial_resolution: "~306 م/بكسل (Level9)", temporal_resolution: "يومي", limits: "تمثيل لوني تفسيري" },
    { id: "route_duration", provider_key: "osrm/route", name_ar: "زمن القيادة التقديري", name_en: "Estimated driving time", unit: "s (يُعرض ساعات/دقائق)", data_type: "derived", source: "OSRM (خادم تجريبي) على بيانات OpenStreetMap", time_semantics: "لا يرتبط بوقت؛ بلا مرور حي", spatial_resolution: "شبكة الطرق في OSM", temporal_resolution: "—", limits: "لا ازدحام ولا حوادث ولا إغلاقات" },
    { id: "route_eta_weather", provider_key: "forecast-api/hourly", name_ar: "الطقس عند الوصول لنقاط الطريق", name_en: "Weather at route ETA", unit: "°C, %, mm, km/h", data_type: "forecast", source: OM, time_semantics: "أقرب ساعة توقع خلال 30 دقيقة من وقت الوصول المقدّر", spatial_resolution: OM_GRID, temporal_resolution: "ساعي", limits: "«غير متاح» خارج نافذة 48 ساعة أو دون ساعة مطابقة" }
  ];

  const ALL = CURRENT.concat(DAILY, OTHER);
  const byId = {};
  ALL.forEach(function (item) { byId[item.id] = item; });

  // Canonical spellings for unit strings the providers return.
  const UNIT_ALIASES = { "°c": "°C", "c": "°C", "km/h": "km/h", "kmh": "km/h", "mm": "mm", "%": "%", "hpa": "hPa", "°": "°",
    "w/m²": "W/m²", "w/m2": "W/m²", "m³/m³": "m³/m³", "m3/m3": "m³/m³", "j/kg": "J/kg", "m": "m", "": "index" };
  function canonicalUnit(unit) {
    if (unit === null || unit === undefined) return null;
    const key = String(unit).trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(UNIT_ALIASES, key) ? UNIT_ALIASES[key] : String(unit).trim();
  }
  // Compares the unit a provider declared with the unit the observatory labels.
  // Returns null when they agree or no unit was declared, otherwise a description.
  function unitMismatch(expected, declared) {
    if (declared === null || declared === undefined) return null;
    return canonicalUnit(expected) === canonicalUnit(declared) ? null : { expected: expected, declared: declared };
  }

  return { TYPE_LABELS, CURRENT, DAILY, OTHER, ALL, get: function (id) { return byId[id] || null; }, canonicalUnit, unitMismatch };
});
