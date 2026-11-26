"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const page=fs.readFileSync(path.join(__dirname,"../air/index.html"),"utf8");

test("air traffic radar exposes live map, regional filters and manual refresh",()=>{
 for(const id of ["map","area","refresh","locate","count","airborne","ground","list","search","filter","airport","showAirport","detail"])assert.match(page,new RegExp('id="'+id+'"'));
 assert.match(page,/OpenSky Network/);
 assert.match(page,/states\/all/);
});
test("aircraft state fields are mapped from OpenSky state vectors",()=>{
 for(const field of ["icao24","callsign","origin_country","latitude","longitude","baro_altitude","geo_altitude","velocity","true_track","vertical_rate","on_ground","last_contact"])assert.match(page,new RegExp(field));
});
test("flight radar does not invent commercial schedules or airport gate data",()=>{
 assert.match(page,/جداول الوصول والمغادرة وأرقام البوابات تحتاج موصلاً مستقلاً/);
 assert.match(page,/لا تعرضها كتخمينات/);
 assert.match(page,/لا تستخدم هذه الصفحة للملاحة أو السلامة الجوية/);
});
test("anonymous OpenSky request limits broad geographic queries and handles rate limits",()=>{
 assert.match(page,/area>25\.5/);
 assert.match(page,/response\.status===429/);
 assert.match(page,/خمس دقائق/);\n assert.match(page,/setInterval\(\(\)=>\{if\(document\.visibilityState==="visible"\)refresh\(\)\},300000\)/);
});

test("OpenSky operational-use licensing gate is visible and documented",()=>{
 assert.match(page,/موافقة مكتوبة قبل دمج واجهة REST/);
 const docs=fs.readFileSync(path.join(__dirname,"../docs/AIR_TRAFFIC_RADAR.md"),"utf8");
 assert.match(docs,/مانع إطلاق/);
 assert.match(docs,/ترخيصاً كتابياً/);
});
