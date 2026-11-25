const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const page = fs.readFileSync('seasons/index.html', 'utf8');

test('traditional seasonal cycle remains present', () => {
  for (const name of ['الوسم','المربعانية','الشبط','العقارب','الحميمين','الذراعان','الكنة','الثريا','التويبع','الجوزاء الأولى','الجوزاء الثانية','المرزم','الكليبين','سهيل']) assert.ok(page.includes(name), name);
});

test('four climate seasons are separately defined', () => {
  for (const name of ['الشتاء','الربيع','الصيف','الخريف']) assert.ok(page.includes(name), name);
  assert.match(page, /ديسمبر – يناير – فبراير/);
  assert.match(page, /يونيو – يوليو – أغسطس/);
  assert.match(page, /سبتمبر – أكتوبر – نوفمبر/);
});

test('agricultural planner filters by month and Saudi region', () => {
  assert.match(page, /farmRegion/);
  assert.match(page, /farmMonth/);
  assert.match(page, /renderFarm/);
  assert.match(page, /عسير والباحة والطائف/);
  assert.match(page, /تبوك وحائل والجوف والشمالية/);
});

test('agricultural recommendations include crop, pruning, grafting and service tasks', () => {
  for (const name of ['العنب: التقليم الشتوي','الأشجار المتساقطة الأوراق','الرمان','الحمضيات','السدر','تطعيم وخدمة','البامية والملوخية واللوبيا']) assert.ok(page.includes(name), name);
});

test('agricultural source age and uncertainty are disclosed', () => {
  assert.match(page, /2018–2019/);
  assert.match(page, /نافذة شهرية إرشادية/);
  assert.match(page, /لا نعرض موعداً غير موثق/);
});

test('season and agricultural JavaScript parses without syntax errors', () => {
  const scripts = [...page.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m => m[1].trim()).filter(Boolean);
  assert.equal(scripts.length, 2);
  for (const script of scripts) new vm.Script(script, { filename: 'seasons/index.html' });
});

test('orchard calendar covers the farm fruit trees with source-aware caveats', () => {
  for (const name of ['العنب','الرمان','التين','الكمثرى','الخوخ والمشمش','الحمضيات والبرتقال','التوت']) assert.ok(page.includes(name), name);
  assert.match(page, /موسم حصاد 2024/);
  assert.match(page, /قبل تفتح البراعم/);
  assert.match(page, /لا نضع تاريخاً ثابتاً/);
  assert.match(page, /أبها ليست درجة مناخية واحدة/);
});

test('2026 astronomical season instants are converted to Saudi local time', () => {
  assert.match(page, /20 مارس 2026/);
  assert.match(page, /5:46 مساءً/);
  assert.match(page, /21 يونيو 2026/);
  assert.match(page, /11:24 صباحاً/);
  assert.match(page, /23 سبتمبر 2026/);
  assert.match(page, /3:05 صباحاً/);
  assert.match(page, /21 ديسمبر 2026/);
  assert.match(page, /11:50 مساءً/);
  assert.match(page, /UTC\+3/);
  assert.match(page, /USNO/);
});

test('Saudi current date uses explicit Riyadh timezone parts, not device timezone parsing', () => {
  assert.match(page, /function saudiNow\(\)\{var p=new Intl\.DateTimeFormat/);
  assert.match(page, /timeZone:"Asia\/Riyadh"/);
  assert.doesNotMatch(page, /toLocaleString\("en-US",\{timeZone:"Asia\/Riyadh"\}\)/);
});

test('orchard profile assistant exposes elevation, tree, stage and observed temperature inputs', () => {
  for (const id of ['farmElevation','farmTree','farmStage','farmMinTemp','farmProfileResult']) assert.ok(page.includes('id="'+id+'"'), id);
  for (const tree of ['grape','pomegranate','fig','pear','peach','apricot','mulberry','citrus']) assert.ok(page.includes(tree+':{'), tree);
  for (const stage of ['dormant','bud','flower','set','growth','harvest','postharvest']) assert.ok(page.includes(stage+':"'), stage);
  assert.match(page, /لا نحول هذا الرقم وحده إلى موعد زراعي/);
  assert.match(page, /تعامل معها كقراءة رصدية فقط/);
});

test('plant catalogue is integrated into the existing seasons page', () => {
  assert.match(page, /id="plant-catalogue"/);
  assert.match(page, /id="plantCatalogueGrid"/);
  assert.match(page, /id="plantSearch"/);
  assert.match(page, /id="plantCategory"/);
  assert.match(page, /src="\.\.\/src\/services\/agriculture\/plant-catalogue\.js"/);
  assert.match(page, /\.\.\/data\/agriculture\/plants\.json/);
  assert.match(page, /موسم توفر الثمار ليس موعد غرس أو تقليم/);
});

test('season page defines its DOM lookup helper before first use', () => {
  assert.match(page, /function \$\(id\)\{return document\.getElementById\(id\)\}/);
  assert.ok(page.indexOf('function $(id)') < page.indexOf('$("today")'));
});
