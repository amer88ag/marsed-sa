const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const page = fs.readFileSync("satellite/index.html", "utf8");

test("satellite page exposes date and layer controls with Saudi coverage", () => {
  for (const id of ["satMap", "layer", "imageDate", "previousDay", "nextDay", "refreshImage"]) {
    assert.ok(page.includes('id="' + id + '"'), id);
  }
  assert.match(page, /NASA GIBS/);
  assert.match(page, /السعودية/);
  assert.match(page, /المركز الوطني للأرصاد/);
  assert.match(page, /لا تمثل هذه الصور تحذيراً رسمياً/);
});

test("satellite viewer loads the dedicated service before its controller", () => {
  assert.ok(page.indexOf('src="../src/services/satellite/nasa-gibs.js"') < page.indexOf("(function(){"));
  assert.match(page, /NasaGibsSatellite\.buildTileUrl/);
});

test("inline satellite page script parses without syntax errors", () => {
  const scripts = [...page.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1].trim()).filter(Boolean);
  assert.equal(scripts.length, 1);
  for (const script of scripts) new vm.Script(script, { filename: "satellite/index.html" });
});

test("satellite viewer preserves incomplete tile coverage and ignores stale layer events", () => {
  assert.match(page, /renderRequestId=0/);
  assert.match(page, /if\(renderId!==renderRequestId\)return/);
  assert.match(page, /currentTileErrors\+\+/);
  assert.match(page, /تغطية غير مكتملة/);
  assert.match(page, /currentTileErrors>0/);
});

test("satellite viewer links to the spatial tile diagnostic", () => {
  assert.match(page, /href="\.\/coverage\.html"/);
  assert.match(page, /latestAtOrBeforeToday/);
});
