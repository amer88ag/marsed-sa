"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const page=fs.readFileSync(path.join(__dirname,"../air/index.html"),"utf8");
const proxy=fs.readFileSync(path.join(__dirname,"../api/aircraft.js"),"utf8");
const docs=fs.readFileSync(path.join(__dirname,"../docs/AIR_TRAFFIC_RADAR.md"),"utf8");

test("air traffic radar exposes live map, regional filters and manual refresh",()=>{
 for(const id of ["map","area","refresh","locate","count","airborne","ground","list","search","filter","airport","showAirport","detail"])assert.match(page,new RegExp('id="'+id+'"'));
 assert.match(page,/FlyItalyADSB/);
 assert.match(page,/api\/aircraft/);
});
test("server proxy keeps provider key out of browser code and validates bounds",()=>{
 assert.match(proxy,/process\.env\.FLYITALYADSB_API_KEY/);
 assert.match(proxy,/X-Api-Key/);
 assert.doesNotMatch(page,/FLYITALYADSB_API_KEY/);
 assert.match(proxy,/invalid_bounds/);
 assert.match(proxy,/api\.flyitalyadsb\.com\/v2\/box/);
});
test("provider fields are normalized and converted to display units",()=>{
 for(const field of ["icao24","callsign","latitude","longitude","altitude_feet","speed_knots","vertical_rate_fpm","seen_seconds"])assert.match(proxy,new RegExp(field));
 assert.match(page,/0\.3048/);
 assert.match(page,/0\.514444/);
 assert.match(page,/0\.00508/);
});
test("required provider attribution and share-alike licence are visible and documented",()=>{
 assert.match(page,/CC BY-SA 4\.0/);
 assert.match(page,/flyitalyadsb\.com/);
 assert.match(docs,/FLYITALYADSB_API_KEY/);
 assert.match(docs,/CC BY-SA 4\.0/);
});
test("commercial schedules, delays and gates are not fabricated",()=>{
 assert.match(page,/جداول الوصول والمغادرة وأرقام البوابات تحتاج موصلاً مستقلاً/);
 assert.match(page,/لا تعرضها كتخمينات/);
 assert.match(page,/لا تستخدم هذه الصفحة للملاحة أو السلامة الجوية/);
});
test("rate limits and refresh policy are handled",()=>{
 assert.match(proxy,/429/);
 assert.match(page,/response\.status===429/);
 assert.match(page,/setInterval\(\(\)=>\{if\(document\.visibilityState==="visible"\)refresh\(\)\},300000\)/);
});
