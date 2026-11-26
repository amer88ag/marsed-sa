"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const Profile=require("../src/platform/geo/elevation-profile.js");

const line=[{lat:24.7,lon:46.6},{lat:24.8,lon:46.8}];

test("samples a path at bounded, evenly spaced cumulative distances",()=>{
  const samples=Profile.samplePath(line,9);
  assert.equal(samples.length,9);
  assert.equal(samples[0].distanceM,0);
  assert.ok(samples[8].distanceM>20000);
  for(let i=1;i<samples.length;i++)assert.ok(samples[i].distanceM>samples[i-1].distanceM);
  assert.ok(Math.abs(samples[0].lat-line[0].lat)<1e-8);
  assert.ok(Math.abs(samples[8].lon-line[1].lon)<1e-8);
});

test("supports multi-vertex paths and caps requests at forty samples",()=>{
  const samples=Profile.samplePath([line[0],{lat:24.75,lon:46.7},line[1]],100);
  assert.equal(samples.length,40);
  assert.ok(Math.abs(samples[0].lat-line[0].lat)<1e-8);
  assert.ok(Math.abs(samples[39].lon-line[1].lon)<1e-8);
});

test("rejects invalid, repeated and underspecified paths",()=>{
  assert.equal(Profile.samplePath([{lat:1,lon:2}],10),null);
  assert.equal(Profile.samplePath([{lat:"",lon:2},{lat:2,lon:3}],10),null);
  assert.equal(Profile.samplePath([{lat:1,lon:2},{lat:1,lon:2}],10),null);
  assert.equal(Profile.samplePath([{lat:true,lon:2},{lat:2,lon:3}],10),null);
});

test("builds an Open-Meteo multi-coordinate request without exceeding sample limit",()=>{
  const samples=Profile.samplePath(line,5);
  const url=Profile.elevationUrl(samples);
  assert.ok(url.startsWith("https://api.open-meteo.com/v1/elevation?"));
  assert.match(url,/latitude=/);
  assert.match(url,/longitude=/);
  assert.equal(Profile.elevationUrl(Array.from({length:41},(_,i)=>({lat:24+i/1000,lon:46+i/1000}))),null);
  assert.equal(Profile.elevationUrl([{lat:91,lon:0},{lat:0,lon:0}]),null);
});

test("profile computes extrema, net elevation change and segment grades",()=>{
  const samples=Profile.samplePath(line,3);
  const profile=Profile.buildProfile(samples,[500,550,600]);
  assert.equal(profile.minElevationM,500);
  assert.equal(profile.maxElevationM,600);
  assert.equal(profile.elevationDifferenceM,100);
  assert.equal(profile.validSampleCount,3);
  assert.ok(profile.averageGradePercent>0);
  assert.ok(profile.rows[1].gradePercent>0);
});

test("missing DEM samples remain null and are never converted to zero",()=>{
  const samples=Profile.samplePath(line,4);
  const profile=Profile.buildProfile(samples,[100,null,undefined,80]);
  assert.equal(profile.rows[1].elevationM,null);
  assert.equal(profile.rows[2].elevationM,null);
  assert.equal(profile.minElevationM,80);
  assert.equal(profile.maxElevationM,100);
  assert.equal(profile.validSampleCount,2);
  assert.equal(profile.missingSampleCount,2);
  assert.equal(profile.elevationDifferenceM,-20);
});

test("no-data and malformed API arrays are handled explicitly",()=>{
  const samples=Profile.samplePath(line,3);
  const none=Profile.buildProfile(samples,[null,null,null]);
  assert.equal(none.minElevationM,null);
  assert.equal(none.averageGradePercent,null);
  assert.equal(none.validSampleCount,0);
  assert.equal(Profile.buildProfile(samples,[100,200]),null);
  assert.equal(Profile.buildProfile(samples,null),null);
});


test("calculates cumulative ascent and descent without bridging missing samples",()=>{
  const samples=Profile.samplePath(line,5);
  const profile=Profile.buildProfile(samples,[100,130,120,null,150]);
  assert.equal(profile.cumulativeAscentM,40);
  assert.equal(profile.cumulativeDescentM,10);
  assert.equal(profile.maxUphillGradePercent,profile.rows[1].gradePercent);
  assert.equal(profile.maxDownhillGradePercent,profile.rows[2].gradePercent);
});

test("returns zero cumulative movement and null extrema when no elevations exist",()=>{
  const samples=Profile.samplePath(line,3);
  const profile=Profile.buildProfile(samples,[null,null,null]);
  assert.equal(profile.cumulativeAscentM,0);
  assert.equal(profile.cumulativeDescentM,0);
  assert.equal(profile.maxUphillGradePercent,null);
  assert.equal(profile.maxDownhillGradePercent,null);
});
