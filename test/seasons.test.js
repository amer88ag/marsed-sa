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
  assert.equal(scripts.length, 1);
  for (const script of scripts) new vm.Script(script, { filename: 'seasons/index.html' });
});
