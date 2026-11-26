'use strict';
// Weather panel review: every requested metric reaches its UI element with the
// right value and unit; missing or wrong-unit values show "—", never 0.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { runDashboard } = require('../test-support/weather-fixture.js');
const Adapter = require('../src/providers/weather/open-meteo/adapter.js');
const { FIELD_UNITS } = require('../src/platform/quality/units.js');

const NOW = '2026-11-24T21:00:00Z'; // 00:00 Saudi; valid time 23:45 → fresh
const VALUES = {
  temperature_2m: 18.4, apparent_temperature: 16.2, relative_humidity_2m: 41, dew_point_2m: 5.1, precipitation: 0.2,
  pressure_msl: 1016.2, surface_pressure: 945.1, cloud_cover: 37, visibility: 18500, wind_speed_10m: 12, wind_gusts_10m: 27,
  wind_direction_10m: 315, cape: 140, freezing_level_height: 4200, weather_code: 1, is_day: 0
};

function fullPayload(overrides, unitOverrides) {
  const url = new URL(Adapter.buildCurrentUrl({ id: 'riyadh', lat: 24.71, lon: 46.68 }));
  const fields = url.searchParams.get('current').split(',');
  const current = { time: '2026-11-24T23:45', interval: 900 }, units = { time: 'iso8601', interval: 'seconds' };
  for (const f of fields) {
    current[f] = f in (overrides || {}) ? overrides[f] : (f in VALUES ? VALUES[f] : 1);
    units[f] = unitOverrides && f in unitOverrides ? unitOverrides[f] : (FIELD_UNITS[f] !== undefined ? FIELD_UNITS[f] : '');
  }
  const dl = url.searchParams.get('daily').split(',');
  const daily = { time: ['2026-11-24', '2026-11-25'] }, daily_units = { time: 'iso8601' };
  for (const f of dl) { daily[f] = f === 'sunrise' || f === 'sunset' ? ['2026-11-24T06:20', '2026-11-25T06:21'] : f === 'uv_index_max' ? [6.3, 6.1] : [3, 4]; daily_units[f] = FIELD_UNITS[f] !== undefined ? FIELD_UNITS[f] : ''; }
  return { latitude: 24.71, longitude: 46.68, elevation: 612, timezone: 'Asia/Riyadh', utc_offset_seconds: 10800, current_units: units, current, daily_units, daily, hourly: { time: [] } };
}
const text = (page, id) => page.$(id).textContent;

test('every weather metric reaches its element with the source value', async () => {
  const page = await runDashboard(NOW, fullPayload());
  const expected = { temp: '18.4', feels: '16.2', humidity: '41', dewPoint: '5.1', rain: '0.2', pressureMsl: '1016.2', surfacePressure: '945.1',
    cloudCover: '37', visibility: '18.5', wind: '12', windGusts: '27', windDirection: 'شمال غربي · 315°', cape: '140', freezingLevel: '4200', uvIndex: '6.3', elevation: '612' };
  for (const [id, value] of Object.entries(expected)) assert.equal(text(page, id), value, id);
});

test('each metric label states its unit (cloud cover not double-%)', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const unitOf = id => (html.match(new RegExp('<strong id="' + id + '"[^>]*>[^<]*</strong><em>([^<]*)</em>')) || [])[1] || '';
  const units = { temp: /°م/, feels: /°م/, pressureMsl: /hPa/, surfacePressure: /hPa/, humidity: /%/, dewPoint: /°م/, visibility: /كم/, cloudCover: /%/, wind: /كم\/ساعة/, windGusts: /كم\/ساعة/, rain: /ملم/, cape: /J\/kg/, freezingLevel: /متر/ };
  for (const [id, re] of Object.entries(units)) assert.match(unitOf(id), re, id);
  assert.doesNotMatch(html, /number\(measurement\("cloud_cover"\),0\)\+"٪"/);
});

test('missing values show "—", and a valid zero shows 0', async () => {
  const page = await runDashboard(NOW, fullPayload({ visibility: null, cape: null, wind_gusts_10m: null, precipitation: 0, cloud_cover: 0 }));
  assert.equal(text(page, 'visibility'), '—');
  assert.equal(text(page, 'cape'), '—');
  assert.equal(text(page, 'windGusts'), '—');
  assert.equal(text(page, 'rain'), '0.0');
  assert.equal(text(page, 'cloudCover'), '0');
});

test('a value declared in the wrong unit is withheld, not converted or shown', async () => {
  const page = await runDashboard(NOW, fullPayload({ temperature_2m: 65 }, { temperature_2m: '°F', pressure_msl: 'Pa' }));
  assert.equal(text(page, 'temp'), '—');
  assert.equal(text(page, 'pressureMsl'), '—');
  assert.equal(text(page, 'humidity'), '41', 'other fields unaffected');
});

test('valid time is shown in Saudi local time and the state is fresh', async () => {
  const page = await runDashboard(NOW, fullPayload());
  assert.match(text(page, 'updated'), /23:45/);
  assert.equal(page.$('dataState').getAttribute ? page.$('dataState').getAttribute('data-state') : page.$('dataState')['data-state'], 'fresh');
});

test('forecast rainfall chart: zero is a visible mark labelled 0, missing is a grey ×, values match the source', async () => {
  const page = await runDashboard(NOW, fullPayload());
  const svg = page.$('rainChart').innerHTML;
  // fullPayload daily: precipitation_sum = [3, 4] for the two days (see VALUES above); add a zero/missing case:
  const p = fullPayload(); p.daily.precipitation_sum = [0, null];
  const svg2 = (await runDashboard(NOW, p)).$('rainChart').innerHTML;
  assert.match(svg2, /height="2\.0"/, 'zero drawn with a visible height');
  assert.match(svg2, />0<\/text>/, 'zero labelled');
  assert.match(svg2, /2026-11-25: قيمة غير متاحة \(ليست صفراً\)<\/title>×/, 'missing marked, not zero');
  assert.match(svg, /2026-11-24: 3\.0 ملم/);
});
