const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const page = fs.readFileSync('elevation/index.html', 'utf8');

test('elevation explorer is a standalone Arabic RTL route', () => {
  assert.match(page, /<html lang="ar" dir="rtl">/);
  assert.match(page, /قياس الارتفاع عن سطح البحر/);
  assert.ok(page.includes('href="../'));
});

test('elevation explorer uses Open-Meteo Elevation API with Copernicus attribution', () => {
  assert.match(page, /api\.open-meteo\.com\/v1\/elevation/);
  assert.match(page, /Copernicus DEM GLO-90/);
  assert.match(page, /CC BY 4\.0/);
  assert.match(page, /90 متر/);
});

test('map selection, coordinate entry, and opt-in geolocation are available', () => {
  assert.match(page, /map\.on\("click"/);
  assert.match(page, /getCurrentPosition/);
  assert.match(page, /id="coords"/);
  assert.match(page, /id="searchPoint"/);
});

test('elevation route JavaScript parses without syntax errors', () => {
  const scripts = [...page.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1].trim()).filter(Boolean);
  assert.equal(scripts.length, 1);
  for (const script of scripts) new vm.Script(script, { filename: 'elevation/index.html' });
});

test('terrain profile drawing, sampled elevation and result chart are wired into the page',()=>{
  assert.match(page,/id="pathStart"/);
  assert.match(page,/id="pathFinish"/);
  assert.match(page,/id="pathUndo"/);
  assert.match(page,/id="pathClear"/);
  assert.match(page,/ElevationProfile\.samplePath/);
  assert.match(page,/ElevationProfile\.elevationUrl/);
  assert.match(page,/ElevationProfile\.buildProfile/);
  assert.match(page,/id="profileChart"/);
  assert.match(page,/id="profileRows"/);
  assert.match(page,/بيانات مفقودة/);
});

test('terrain profile exposes cumulative ascent/descent and CSV export',()=>{
  assert.match(page,/id="profileAscent"/);
  assert.match(page,/id="profileDescent"/);
  assert.match(page,/id="profileMaxUp"/);
  assert.match(page,/id="profileMaxDown"/);
  assert.match(page,/id="profileCsv"/);
  assert.match(page,/marsed-terrain-profile\.csv/);
  assert.match(page,/lastProfile\.rows/);
});
