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

test('weather API request has explicit units/timezone and handles failed responses', () => {
  assert.match(html, /api\.open-meteo\.com\/v1\/forecast/);
  assert.match(html, /timezone=Asia%2FRiyadh/);
  assert.match(html, /if\(!response\.ok\)throw new Error/);
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

test('CHIRPS city time-series panel is wired to the branch data artifact', () => {
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
  }, null), /equal length/);
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
  const scripts = [...admin.matchAll(/<script(?:\\s[^>]*)?>([\\s\\S]*?)<\\/script>/gi)]
    .map(match => match[1].trim()).filter(Boolean);
  assert.ok(scripts.length > 0);
  for (const script of scripts) new vm.Script(script, { filename: 'admin-inline.js' });
});

test('dashboard links to the service management center', () => {
  assert.match(html, /href="admin\/"/);
  assert.match(html, /مركز إدارة الخدمات والمصادر/);
});
