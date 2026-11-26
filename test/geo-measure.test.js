"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Geo = require("../src/platform/geo/measure.js");

const square = [
  {lat:0,lon:0},{lat:0,lon:0.01},{lat:0.01,lon:0.01},{lat:0.01,lon:0}
];

test("polygon area and perimeter are positive and close to expected small-square values", () => {
  const area = Geo.area(square), perimeter = Geo.perimeter(square);
  assert.ok(area > 120000 && area < 125000, "area " + area);
  assert.ok(perimeter > 4400 && perimeter < 4500, "perimeter " + perimeter);
});

test("area is invariant to ring start and winding direction", () => {
  const rotated = square.slice(2).concat(square.slice(0,2));
  const reversed = square.slice().reverse();
  assert.ok(Math.abs(Geo.area(square) - Geo.area(rotated)) < 0.01);
  assert.ok(Math.abs(Geo.area(square) - Geo.area(reversed)) < 0.01);
});

test("invalid coordinates, blank values and fewer than three points are rejected", () => {
  assert.equal(Geo.area([{lat:1,lon:2},{lat:2,lon:3}]), null);
  assert.equal(Geo.area([{lat:"",lon:2},{lat:2,lon:3},{lat:3,lon:4}]), null);
  assert.equal(Geo.perimeter([{lat:1,lon:2},{lat:2,lon:3},{lat:91,lon:4}]), null);
  assert.equal(Geo.area([{lat:true,lon:2},{lat:2,lon:3},{lat:3,lon:4}]), null);
});

test("duplicate closing vertex is normalized without changing area", () => {
  const closed = square.concat([{lat:0,lon:0}]);
  assert.equal(Geo.normalize(closed).length, 4);
  assert.ok(Math.abs(Geo.area(closed) - Geo.area(square)) < 0.01);
});

test("area formatting selects square metres, hectares and square kilometres", () => {
  assert.deepEqual(Geo.formatArea(850), {value:850,unit:"م²"});
  assert.deepEqual(Geo.formatArea(25000), {value:2.5,unit:"هكتار"});
  assert.deepEqual(Geo.formatArea(2000000), {value:2,unit:"كم²"});
  assert.equal(Geo.formatArea(-1), null);
});
