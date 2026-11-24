const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const page = fs.readFileSync('seasons/index.html', 'utf8');

test('season calendar contains the traditional seasonal cycle', () => {
  for (const name of ['الوسم','المربعانية','الشبط','العقارب','الحميمين','الذراعان','الكنة','الثريا','التويبع','الجوزاء الأولى','الجوزاء الثانية','المرزم','الكليبين','سهيل']) {
    assert.ok(page.includes(name), 'missing season: ' + name);
  }
});

test('season calendar identifies current season in Saudi local time', () => {
  assert.match(page, /Asia\/Riyadh/);
  assert.match(page, /activeAt/);
  assert.match(page, /الموسم الحالي/);
});

test('season calendar documents traditional date uncertainty and regional differences', () => {
  assert.match(page, /تواريخ تقريبية/);
  assert.match(page, /تختلف بعض التقاويم/);
  assert.match(page, /ليست مواعيد رسمية/);
});

test('season calendar JavaScript parses without syntax errors', () => {
  const scripts = [...page.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1].trim()).filter(Boolean);
  assert.equal(scripts.length, 1);
  for (const script of scripts) new vm.Script(script, { filename: 'seasons/index.html' });
});
