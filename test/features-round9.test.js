'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const A = require('../src/platform/time/astro-seasons.js');
const OM = require('../src/providers/weather/open-meteo/adapter.js');
const Catalog = require('../src/platform/quality/indicators.js');

// Reference: US National Weather Service table (weather.gov/media/ind/seasons.pdf),
// derived from USNO data, retrieved 2026-11-26. Times in UTC, to the minute.
const REFERENCE = {
  2026: { march: '2026-03-20T14:46Z', june: '2026-06-21T08:24Z', september: '2026-09-23T00:05Z', december: '2026-12-21T20:50Z' },
  2027: { march: '2027-03-20T20:25Z', june: '2027-06-21T14:11Z', september: '2027-09-23T06:02Z', december: '2027-12-22T02:42Z' }
};

test('equinoxes and solstices match the NWS/USNO reference within 2 minutes', () => {
  for (const [year, events] of Object.entries(REFERENCE)) {
    for (const e of A.events(Number(year))) {
      const diff = Math.abs(e.utc.getTime() - Date.parse(events[e.id])) / 60000;
      assert.ok(diff <= 2, `${year} ${e.id}: ${e.utc.toISOString()} vs ${events[e.id]} (${diff} min)`);
    }
  }
});

test('astronomical dates reject years outside the algorithm range', () => {
  assert.throws(() => A.events(1999), RangeError);
  assert.throws(() => A.events(2026.5), RangeError);
});

test('Saudi local date of the December 2026 solstice is 21 December, 23:50', () => {
  const dec = A.events(2026).find(e => e.id === 'december').utc;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Riyadh', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(dec);
  assert.equal(parts, '21/12, 23:50');
});

test('seasons page separates astronomical dates from folk seasons and names its method', () => {
  const page = fs.readFileSync('seasons/index.html', 'utf8');
  assert.match(page, /astro-seasons\.js/);
  assert.match(page, /Jean Meeus/);
  assert.match(page, /وليست بدايات المواسم الشعبية/);
});

test('route weather keeps the model terrain elevation of each route point', () => {
  const payload = [{ elevation: 612, hourly_units: { time: 'iso8601', temperature_2m: '°C', precipitation_probability: '%', precipitation: 'mm', weather_code: 'wmo code', wind_speed_10m: 'km/h' }, hourly: { time: ['2026-11-26T12:00'], temperature_2m: [20], precipitation_probability: [0], precipitation: [0], weather_code: [0], wind_speed_10m: [10] } }];
  const [row] = OM.normalizeRouteWeatherBatch(payload, [{ id: 'p0' }]);
  assert.equal(row.elevation_m, 612);
  const [missing] = OM.normalizeRouteWeatherBatch([{ ...payload[0], elevation: null }], [{ id: 'p0' }]);
  assert.equal(missing.elevation_m, null);
});

test('current visibility is emitted with its unit and catalogued as a model value', () => {
  const entry = Catalog.get('visibility');
  assert.ok(entry, 'visibility in catalogue');
  assert.equal(entry.unit, 'm');
  const html = fs.readFileSync('index.html', 'utf8');
  assert.match(html, /id="visibility"/);
  assert.match(html, /ليس قياس مطار/);
});

test('overview request includes the fields used by the city comparison table', () => {
  const url = new URL(OM.buildOverviewBatchUrl([{ id: 'a', lat: 24.7, lon: 46.7 }]));
  for (const f of ['relative_humidity_2m', 'wind_gusts_10m', 'pressure_msl']) assert.match(url.searchParams.get('current'), new RegExp(f));
  for (const f of ['temperature_2m_max', 'temperature_2m_min']) assert.match(url.searchParams.get('daily'), new RegExp(f));
  const html = fs.readFileSync('index.html', 'utf8');
  assert.match(html, /id="compareBody"/);
  assert.match(html, /«—» تعني قيمة غير متاحة ولا تُعد صفراً/);
});
