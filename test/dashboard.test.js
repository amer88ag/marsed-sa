const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');

test('Arabic RTL document and responsive viewport are present', () => {
  assert.match(html, /<html lang="ar" dir="rtl">/);
  assert.match(html, /name="viewport"/);
  assert.match(html, /@media\s*\(max-width:\s*850px\)/);
});

test('all configured Saudi cities have coordinates and labels', () => {
  const cityBlock = html.match(/var places=\{([\s\S]*?)\};/);
  assert.ok(cityBlock, 'city registry exists');
  const keys = [...cityBlock[1].matchAll(/([a-z]+):\{name:/g)].map(m => m[1]);
  assert.ok(keys.length >= 13, 'at least 13 Saudi cities are configured');
  for (const key of keys) {
    const entry = cityBlock[1].match(new RegExp(key + ':\\{name:"[^"]+",lat:([0-9.]+),lon:([0-9.]+)\\}'));
    assert.ok(entry, key + ' has numeric latitude and longitude');
    assert.ok(Number(entry[1]) >= 16 && Number(entry[1]) <= 33, key + ' latitude is within Saudi bounds');
    assert.ok(Number(entry[2]) >= 34 && Number(entry[2]) <= 56, key + ' longitude is within Saudi bounds');
  }
});

test('live data labels clearly distinguish model output from station observations', () => {
  assert.match(html, /نموذج جوي/);
  assert.match(html, /ليست قياسات مباشرة/);
  assert.match(html, /لا تمثل هذه القيم رصداً مباشراً/);
});

test('weather provider adapter builds explicit Riyadh-time requests and service handles failures', () => {
  const adapter = fs.readFileSync('src/providers/weather/open-meteo/adapter.js', 'utf8');
  const service = fs.readFileSync('src/services/weather/service.js', 'utf8');
  assert.match(adapter, /api\.open-meteo\.com\/v1\/forecast/);
  assert.match(adapter, /timezone: "Asia\/Riyadh"/);
  assert.match(service, /if \(!response\.ok\) throw new Error/);
  assert.match(html, /تعذر جلب البيانات/);
});

test('external links opened in new tabs include noopener', () => {
  const externalLinks = html.match(/<a\b[^>]*target="_blank"[^>]*>/g) || [];
  assert.ok(externalLinks.length >= 4);
  for (const link of externalLinks) assert.match(link, /rel="noopener"/);
});

test('inline application JavaScript parses without syntax errors', () => {
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1].trim()).filter(Boolean);
  assert.ok(scripts.length >= 1);
  for (const script of scripts) new vm.Script(script, { filename: 'index-inline.js' });
});

test('no credential-like API key is embedded in the browser page', () => {
  assert.doesNotMatch(html, /(?:api[_-]?key|access[_-]?token)\s*[:=]\s*["'][^"']{12,}["']/i);
});

test('CHIRPS city time-series panel is wired to the committed dataset artifact', () => {
  assert.match(html, /CHIRPS v3 DAILY SAT وDAILY RNL FINAL/);
  assert.match(html, /chirps_daily\.json/);
  assert.match(html, /chirpsState/);
  assert.match(html, /أقرب خلية شبكية/);
});

test('CHIRPS panel does not silently replace missing rainfall with zero', () => {
  assert.match(html, /row\.precipitation_mm===null/);
  assert.match(html, /لا توجد سجلات لهذه المدينة/);
});

test('CHIRPS extractor and manual workflow preserve the research-only branch', () => {
  const script = fs.readFileSync('scripts/chirps_extract.py', 'utf8');
  const workflow = fs.readFileSync('.github/workflows/chirps-city-series.yml', 'utf8');
  assert.match(script, /daily\/final\/\{product\}/);
  assert.match(script, /"sat", "rnl"/);
  assert.match(script, /not city-area mean/);
  assert.match(script, /not a uniform station observation window/);
  assert.match(workflow, /workflow_dispatch/);
  assert.match(workflow, /feature\/dashboard-quality-gates/);
  assert.doesNotMatch(workflow, /branches:\s*\[main\]/);
});

test('committed CHIRPS sample has complete SAT and RNL coverage with valid metadata', () => {
  const dataset = JSON.parse(fs.readFileSync('data/chirps_daily.json', 'utf8'));
  assert.equal(dataset.schema_version, 1);
  assert.equal(dataset.units, 'mm/day');
  assert.deepEqual(Object.keys(dataset.series).sort(), ['rnl', 'sat']);
  assert.equal(dataset.date_range.days, 3);
  assert.equal(dataset.date_range.start, '2026-09-01');
  assert.equal(dataset.date_range.end, '2026-09-03');
  assert.match(dataset.spatial_sampling, /nearest grid cell/);
  assert.match(dataset.date_semantics, /not a uniform station observation window/);
  assert.equal(Object.keys(dataset.cities).length, 13);
  for (const product of ['sat', 'rnl']) {
    assert.deepEqual(Object.keys(dataset.series[product]).sort(), Object.keys(dataset.cities).sort());
    for (const [city, rows] of Object.entries(dataset.series[product])) {
      assert.equal(rows.length, 3, city + ' has three daily samples');
      for (const row of rows) {
        assert.match(row.date, /^2026-09-0[1-3]$/);
        assert.ok(row.precipitation_mm === null ||
          (Number.isFinite(row.precipitation_mm) && row.precipitation_mm >= 0),
          city + ' contains only valid non-negative values or null');
      }
    }
  }
});

test('service and provider registries have unique ids and valid cross references', () => {
  const services = JSON.parse(fs.readFileSync('config/services.json', 'utf8'));
  const providers = JSON.parse(fs.readFileSync('config/providers.json', 'utf8'));
  const registry = require('../src/platform/registry/registry.js');
  const result = registry.validateRegistries(services, providers);
  assert.equal(result.valid, true, result.errors.join('; '));
  assert.equal(new Set(services.services.map(item => item.id)).size, services.services.length);
  assert.equal(new Set(providers.providers.map(item => item.id)).size, providers.providers.length);
});

test('registry separates active, research and planned services', () => {
  const services = JSON.parse(fs.readFileSync('config/services.json', 'utf8'));
  const registry = require('../src/platform/registry/registry.js');
  assert.ok(registry.getServices(services, { statuses: ['active'] }).some(item => item.id === 'weather'));
  assert.ok(registry.getServices(services, { statuses: ['research'] }).some(item => item.id === 'precipitation'));
  assert.ok(registry.getServices(services, { statuses: ['planned'] }).some(item => item.id === 'air-quality'));
});

test('provider registry does not treat unapproved sources as ready for public display', () => {
  const providers = JSON.parse(fs.readFileSync('config/providers.json', 'utf8'));
  const registry = require('../src/platform/registry/registry.js');
  const ncm = providers.providers.find(item => item.id === 'ncm');
  const openMeteo = providers.providers.find(item => item.id === 'open-meteo');
  assert.equal(registry.isProviderEligibleForPublicDisplay(ncm), false);
  assert.equal(registry.isProviderEligibleForPublicDisplay(openMeteo), true);
});

test('registry rejects unknown provider references', () => {
  const services = { registry_type: 'services', services: [{ id: 'bad', status: 'active', provider_ids: ['missing'] }] };
  const providers = { registry_type: 'providers', providers: [] };
  const registry = require('../src/platform/registry/registry.js');
  const result = registry.validateRegistries(services, providers);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /Unknown provider missing/);
});

test('Open-Meteo adapter builds a Riyadh-time request and normalizes model output', () => {
  const adapter = require('../src/providers/weather/open-meteo/adapter.js');
  const url = new URL(adapter.buildCurrentUrl({ id: 'abha', name: 'أبها', lat: 18.2164, lon: 42.5053 }));
  assert.equal(url.hostname, 'api.open-meteo.com');
  assert.equal(url.searchParams.get('timezone'), 'Asia/Riyadh');
  assert.equal(url.searchParams.get('latitude'), '18.2164');
  const normalized = adapter.normalizeCurrent({
    current: { time: '2026-11-21T12:00', temperature_2m: 21, relative_humidity_2m: 40, precipitation: 0, wind_speed_10m: 8 },
    daily: { time: ['2026-11-21'], precipitation_sum: [0.2] }
  }, { id: 'abha', name: 'أبها', lat: 18.2164, lon: 42.5053 }, '2026-11-21T12:05:00Z');
  assert.equal(normalized.provider_id, 'open-meteo');
  assert.equal(normalized.location.id, 'abha');
  assert.equal(normalized.measurements.find(item => item.name === 'temperature').value, 21);
  assert.equal(normalized.daily[0].precipitation, 0.2);
  assert.match(normalized.provenance.methodology, /Numerical weather model/);
});

test('Open-Meteo adapter rejects malformed coordinates and mismatched daily arrays', () => {
  const adapter = require('../src/providers/weather/open-meteo/adapter.js');
  assert.throws(() => adapter.buildCurrentUrl({ lat: NaN, lon: 42 }), /finite lat\/lon/);
  assert.throws(() => adapter.normalizeCurrent({
    current: {}, daily: { time: ['2026-01-01'], precipitation_sum: [] }
  }, null), /Daily field length mismatch/);
});

test('CHIRPS adapter preserves SAT and RNL product identity and null values', () => {
  const adapter = require('../src/providers/precipitation/chirps/adapter.js');
  const dataset = JSON.parse(fs.readFileSync('data/chirps_daily.json', 'utf8'));
  const sat = adapter.normalizeCitySeries(dataset, 'jazan', 'sat');
  const rnl = adapter.normalizeCitySeries(dataset, 'jazan', 'rnl');
  assert.equal(sat.provider_id, 'chirps-v3');
  assert.equal(sat.product_id, 'DAILY-SAT-FINAL');
  assert.equal(rnl.product_id, 'DAILY-RNL');
  assert.equal(sat.location.id, 'jazan');
  assert.equal(sat.observations.length, 3);
  assert.equal(sat.observations[0].unit, 'mm/day');
  assert.match(sat.provenance.methodology, /IMERG Late V07/);
  assert.match(rnl.provenance.methodology, /ERA5/);
});

test('CHIRPS adapter rejects unsupported products and invalid values', () => {
  const adapter = require('../src/providers/precipitation/chirps/adapter.js');
  const dataset = JSON.parse(fs.readFileSync('data/chirps_daily.json', 'utf8'));
  assert.throws(() => adapter.normalizeCitySeries(dataset, 'jazan', 'forecast'), /Unsupported CHIRPS product/);
  const invalid = JSON.parse(JSON.stringify(dataset));
  invalid.series.sat.jazan[0].precipitation_mm = -1;
  assert.throws(() => adapter.normalizeCitySeries(invalid, 'jazan', 'sat'), /Invalid CHIRPS precipitation/);
});

test('service management center loads the central registries and is explicit about read-only mode', () => {
  const admin = fs.readFileSync('admin/index.html', 'utf8');
  assert.match(admin, /\.\.\/config\/services\.json/);
  assert.match(admin, /\.\.\/config\/providers\.json/);
  assert.match(admin, /وضع المركز الحالي: قراءة ومراقبة السجل فقط/);
  assert.match(admin, /تفعيل وتعطيل الخدمات أو تغيير المصدر/);
  const scripts = [...admin.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1].trim()).filter(Boolean);
  assert.ok(scripts.length > 0);
  for (const script of scripts) new vm.Script(script, { filename: 'admin-inline.js' });
});

test('dashboard links to the service management center', () => {
  assert.match(html, /href="admin\/"/);
  assert.match(html, /مركز إدارة الخدمات والمصادر/);
});

test('weather service fetches through the provider adapter and returns normalized data', async () => {
  const service = require('../src/services/weather/service.js');
  const fakeAdapter = {
    buildCurrentUrl: location => 'https://provider.test/weather?city=' + location.id,
    normalizeCurrent: (payload, location, retrievedAt) => ({ provider: 'test', city: location.id, value: payload.value, retrievedAt })
  };
  const result = await service.fetchWeather({ id: 'abha', lat: 18, lon: 42 }, {
    adapter: fakeAdapter,
    retrievedAt: '2026-11-21T00:00:00Z',
    fetch: async url => ({ ok: url.includes('city=abha'), json: async () => ({ value: 23 }) })
  });
  assert.deepEqual(result, { provider: 'test', city: 'abha', value: 23, retrievedAt: '2026-11-21T00:00:00Z' });
});

test('weather service surfaces provider HTTP failures', async () => {
  const service = require('../src/services/weather/service.js');
  await assert.rejects(
    service.fetchWeather({ id: 'abha', lat: 18, lon: 42 }, {
      adapter: { buildCurrentUrl: () => 'https://provider.test', normalizeCurrent: () => ({}) },
      fetch: async () => ({ ok: false, status: 503 })
    }),
    /HTTP 503/
  );
});

test('precipitation service validates and loads the dataset through injected fetch', async () => {
  const service = require('../src/services/precipitation/service.js');
  const dataset = JSON.parse(fs.readFileSync('data/chirps_daily.json', 'utf8'));
  const loaded = await service.fetchDataset('https://data.test/chirps.json', {
    fetch: async () => ({ ok: true, json: async () => dataset })
  });
  assert.equal(loaded.schema_version, 1);
  const normalized = service.getCitySeries(loaded, 'abha', 'sat', require('../src/providers/precipitation/chirps/adapter.js'));
  assert.equal(normalized.product_id, 'DAILY-SAT-FINAL');
  await assert.rejects(service.fetchDataset('https://data.test/bad.json', {
    fetch: async () => ({ ok: true, json: async () => ({ schema_version: 99 }) })
  }), /Unsupported CHIRPS dataset schema/);
});

test('dashboard uses the provider adapters and service orchestration modules', () => {
  assert.match(html, /src\/providers\/weather\/open-meteo\/adapter\.js/);
  assert.match(html, /src\/providers\/precipitation\/chirps\/adapter\.js/);
  assert.match(html, /src\/services\/weather\/service\.js/);
  assert.match(html, /src\/services\/precipitation\/service\.js/);
  assert.match(html, /WeatherService\.fetchWeather/);
  assert.match(html, /PrecipitationService\.fetchDataset/);
});

test('admin validates central registries before rendering', () => {
  const admin = fs.readFileSync('admin/index.html', 'utf8');
  assert.match(admin, /src="\.\.\/src\/platform\/registry\/registry\.js"/);
  assert.match(admin, /MarsedRegistry\.validateRegistries/);
  assert.match(admin, /السجلات غير صالحة/);
});

test('admin only renders provider links with HTTPS protocol', () => {
  const admin = fs.readFileSync('admin/index.html', 'utf8');
  assert.match(admin, /function safeHttpsUrl/);
  assert.match(admin, /url\.protocol==="https:"/);
  assert.match(admin, /noopener noreferrer/);
  assert.match(admin, /رابط رسمي غير صالح/);
});

test('weather refresh clears stale values and rejects out-of-order city responses', () => {
  assert.ok(html.includes('var weatherRequestId=0;'));
  assert.ok(html.includes('var requestId=++weatherRequestId;'));
  assert.ok(html.includes('if(requestId!==weatherRequestId||requestedKey!==activeKey)return;'));
  assert.ok(html.includes('function clearWeatherDisplay()'));
  assert.ok(html.includes('["temp","feels","rain","humidity","wind","condition","daylight","weatherInsight"].forEach'));
  assert.ok(html.includes('if(requestId===weatherRequestId)$("refresh").disabled=false;'));
});


function createDashboardHarness() {
  const elements = new Map();
  const requests = [];
  const listeners = {};
  const getElementById = id => {
    if (!elements.has(id)) elements.set(id, {
      id, textContent: '', innerHTML: '', disabled: false, value: 'riyadh',
      classList: { add() {}, remove() {} },
      addEventListener(type, callback) { listeners[id + ':' + type] = callback; }
    });
    return elements.get(id);
  };
  const deferred = () => {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };
  const marker = { addTo() { return this; }, setLatLng() { return this; }, setPopupContent() { return this; }, bindPopup() { return this; }, on() { return this; }, openPopup() { return this; } };
  const map = { setView() { return this; } };
  const leaflet = {
    map() { return map; },
    tileLayer() { return { addTo() {} }; },
    marker() { return marker; }
  };
  const document = { getElementById };
  const window = { L: leaflet };
  const context = {
    document, window, L: leaflet, console, Date, Math, Number, isFinite,
    URL,
    WeatherService: {
      fetchWeather() {
        const item = deferred();
        requests.push(item);
        return item.promise;
      }
    },
    PrecipitationService: {
      fetchDataset: async () => { throw new Error('offline test fixture'); }
    }
  };
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1].trim()).filter(Boolean);
  assert.equal(scripts.length, 1, 'one inline dashboard application script is expected');
  vm.runInNewContext(scripts[0], context, { filename: 'dashboard-race-test.js' });
  return { elements, requests, listeners };
}

test('weather UI keeps the newest city response when requests resolve out of order', async () => {
  const harness = createDashboardHarness();
  assert.equal(harness.requests.length, 1, 'initial Riyadh request starts');
  const changeCity = harness.listeners['place:change'];
  assert.equal(typeof changeCity, 'function');

  changeCity({ target: { value: 'abha' } });
  assert.equal(harness.requests.length, 2, 'Abha request starts after city selection');

  harness.requests[1].resolve({
    measurements: [
      { name: 'temperature', value: 19 },
      { name: 'apparent_temperature', value: 18 },
      { name: 'precipitation', value: 1.2 },
      { name: 'relative_humidity', value: 55 },
      { name: 'wind_speed', value: 7 }
    ],
    daily: [{ valid_date: '2026-11-22', precipitation: 1.2 }]
  });
  await harness.requests[1].promise;
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(harness.elements.get('placeName').textContent, 'أبها');
  assert.equal(harness.elements.get('temp').textContent, '19.0');

  harness.requests[0].resolve({
    measurements: [
      { name: 'temperature', value: 35 },
      { name: 'apparent_temperature', value: 34 },
      { name: 'precipitation', value: 0 },
      { name: 'relative_humidity', value: 20 },
      { name: 'wind_speed', value: 15 }
    ],
    daily: [{ valid_date: '2026-11-22', precipitation: 0 }]
  });
  await harness.requests[0].promise;
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(harness.elements.get('placeName').textContent, 'أبها');
  assert.equal(harness.elements.get('temp').textContent, '19.0',
    'late Riyadh response must not overwrite Abha values');
  assert.equal(harness.elements.get('humidity').textContent, '55');
  assert.equal(harness.elements.get('refresh').disabled, false,
    'only the current request controls refresh button state');
});

test('Open-Meteo adapter normalizes practical hourly and seven-day weather context', () => {
  const adapter = require('../src/providers/weather/open-meteo/adapter.js');
  const normalized = adapter.normalizeCurrent({
    current: { time: '2026-11-22T10:00', temperature_2m: 27, apparent_temperature: 30, relative_humidity_2m: 35, precipitation: 0, wind_speed_10m: 12, weather_code: 1, is_day: 1 },
    hourly: {
      time: ['2026-11-22T10:00'],
      temperature_2m: [27], apparent_temperature: [30], precipitation_probability: [20],
      precipitation: [0], weather_code: [1], wind_speed_10m: [12]
    },
    daily: {
      time: ['2026-11-22'], weather_code: [1], precipitation_sum: [0.5],
      precipitation_probability_max: [35], temperature_2m_max: [31], temperature_2m_min: [19],
      sunrise: ['2026-11-22T06:10'], sunset: ['2026-11-22T17:20'], uv_index_max: [7]
    }
  }, { id: 'riyadh', name: 'الرياض', lat: 24.7, lon: 46.6 });
  assert.equal(normalized.measurements.find(x => x.name === 'apparent_temperature').value, 30);
  assert.equal(normalized.current_weather_code, 1);
  assert.equal(normalized.is_day, true);
  assert.equal(normalized.hourly[0].precipitation_probability, 20);
  assert.equal(normalized.daily[0].temperature_max, 31);
  assert.equal(normalized.daily[0].temperature_min, 19);
  assert.equal(normalized.daily[0].uv_index_max, 7);
});

test('Open-Meteo adapter rejects mismatched hourly forecast arrays', () => {
  const adapter = require('../src/providers/weather/open-meteo/adapter.js');
  assert.throws(() => adapter.normalizeCurrent({
    current: {}, hourly: { time: ['2026-11-22T10:00'], temperature_2m: [] },
    daily: { time: [], precipitation_sum: [] }
  }, null), /Hourly field length mismatch/);
});

test('daily weather experience includes practical context and hourly/daily forecast sections', () => {
  assert.match(html, /ماذا يعني هذا لك؟/);
  assert.match(html, /hourlyForecast/);
  assert.match(html, /dailyForecast/);
  assert.match(html, /apparent_temperature/);
  assert.match(html, /precipitation_probability_max/);
  assert.match(html, /ليس تنبيهاً رسمياً/);
});

test('Open-Meteo adapter requests seven forecast days without prepending yesterday', () => {
  const adapter = require('../src/providers/weather/open-meteo/adapter.js');
  const url = new URL(adapter.buildCurrentUrl({ lat: 24.7, lon: 46.6 }));
  assert.equal(url.searchParams.get('past_days'), '0');
  assert.equal(url.searchParams.get('forecast_days'), '7');
});

test('Open-Meteo adapter preserves unavailable day/night state instead of assuming night', () => {
  const adapter = require('../src/providers/weather/open-meteo/adapter.js');
  const normalized = adapter.normalizeCurrent({
    current: { temperature_2m: 22 },
    daily: { time: ['2026-11-22'], precipitation_sum: [null] }
  }, null);
  assert.equal(normalized.is_day, null);
  assert.equal(normalized.daily[0].precipitation, null);
});

test('daily weather summary handles missing model values without inventing zeroes or clear skies', () => {
  assert.match(html, /لا تتوفر بيانات كافية لتكوين ملخص عملي موثوق/);
  assert.match(html, /if\(code===null\|\|code===undefined\|\|code===""\)return "غير متاح"/);
  assert.match(html, /data\.is_day===true\?"نهار":data\.is_day===false\?"ليل"/);
});

test('map renders a selectable marker for every configured Saudi city', () => {
  assert.match(html, /Object\.keys\(places\)\.forEach\(function\(key\)/);
  assert.match(html, /L\.marker\(\[p\.lat,p\.lon\]\)/);
  assert.match(html, /cityMarker\.on\("click",function\(\)\{selectCity\(key\)\}\)/);
  assert.match(html, /function selectCity\(key\)/);
  assert.match(html, /cityMarkers\[requestedKey\]\.openPopup\(\)/);
});

\ntest('national life radar requests lightweight model summaries for city points', () => {
  const adapter = require('../src/providers/weather/open-meteo/adapter.js');
  const url = new URL(adapter.buildOverviewUrl({ id: 'abha', name: 'أبها', lat: 18.2164, lon: 42.5053 }));
  assert.equal(url.hostname, 'api.open-meteo.com');
  assert.equal(url.searchParams.get('forecast_days'), '1');
  assert.equal(url.searchParams.get('timezone'), 'Asia/Riyadh');
  assert.match(url.searchParams.get('current'), /precipitation/);
  assert.match(url.searchParams.get('daily'), /precipitation_probability_max/);
});

test('national radar normalization preserves missing values and source provenance', () => {
  const adapter = require('../src/providers/weather/open-meteo/adapter.js');
  const item = adapter.normalizeOverview({
    current: { time: '2026-11-22T12:00', temperature_2m: 22, precipitation: null, weather_code: 3 },
    daily: { time: ['2026-11-22'], precipitation_sum: [null], precipitation_probability_max: [45] }
  }, { id: 'abha', name: 'أبها', lat: 18.2164, lon: 42.5053 }, '2026-11-22T09:00:00Z');
  assert.equal(item.location.id, 'abha');
  assert.equal(item.current.precipitation, null);
  assert.equal(item.today.precipitation, null);
  assert.equal(item.today.precipitation_probability_max, 45);
  assert.match(item.provenance.methodology, /Numerical weather model/);
});

test('national radar rejects incomplete provider responses and invalid numeric values', () => {
  const adapter = require('../src/providers/weather/open-meteo/adapter.js');
  assert.throws(() => adapter.normalizeOverview({}, { id: 'abha', name: 'أبها', lat: 18, lon: 42 }), /incomplete/);
  assert.throws(() => adapter.normalizeOverview({
    current: { temperature_2m: 'bad' }, daily: { time: ['2026-11-22'] }
  }, { id: 'abha', name: 'أبها', lat: 18, lon: 42 }), /Invalid numeric field/);
});

test('weather service fetches and normalizes lightweight national radar data', async () => {
  const service = require('../src/services/weather/service.js');
  const fakeAdapter = {
    buildOverviewUrl: location => 'https://provider.test/overview?city=' + location.id,
    normalizeOverview: (payload, location) => ({ city: location.id, value: payload.value })
  };
  const result = await service.fetchOverview({ id: 'abha', lat: 18, lon: 42 }, {
    adapter: fakeAdapter,
    fetch: async url => ({ ok: url.includes('city=abha'), json: async () => ({ value: 5 }) })
  });
  assert.deepEqual(result, { city: 'abha', value: 5 });
});

test('dashboard provides selectable current-weather and daily-rain map layers', () => {
  assert.match(html, /id="radarMode"/);
  assert.match(html, /الطقس الحالي حسب النموذج/);
  assert.match(html, /الأمطار المتوقعة اليوم/);
  assert.match(html, /function loadRadar\(\)/);
  assert.match(html, /WeatherService\.fetchOverview/);
  assert.match(html, /L\.circleMarker/);
  assert.match(html, /لم تُستبدل بياناتها بقيم صفرية/);
  assert.match(html, /ليس رصداً أرضياً أو تنبيهاً رسمياً/);
});
