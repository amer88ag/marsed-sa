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
