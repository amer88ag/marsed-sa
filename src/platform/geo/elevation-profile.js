(function (root, factory) {
  const deps = (typeof module === "object" && module.exports)
    ? { geo: require("./measure.js") }
    : { geo: root && root.GeoMeasure };
  const api = factory(deps);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ElevationProfile = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (deps) {
  "use strict";
  const MAX_SAMPLES = 40;
  const EARTH_RADIUS_M = 6371008.8;
  const geo = deps.geo;

  function validPath(points) {
    if (!geo || !Array.isArray(points) || points.length < 2) return null;
    const result = [];
    for (const item of points) {
      const point = geo.validPoint(item);
      if (!point) return null;
      if (!result.length || geo.distance(result[result.length - 1], point) > 0.5) result.push(point);
    }
    return result.length >= 2 ? result : null;
  }

  function interpolateGreatCircle(a, b, fraction) {
    const rad = Math.PI / 180;
    const lat1 = a.lat * rad, lon1 = a.lon * rad;
    const lat2 = b.lat * rad, lon2 = b.lon * rad;
    const vector = function (lat, lon) {
      return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
    };
    const va = vector(lat1, lon1), vb = vector(lat2, lon2);
    const dot = Math.max(-1, Math.min(1, va[0]*vb[0] + va[1]*vb[1] + va[2]*vb[2]));
    const omega = Math.acos(dot);
    if (omega < 1e-12) return { lat: a.lat, lon: a.lon };
    const sinOmega = Math.sin(omega);
    if (Math.abs(sinOmega) < 1e-12) return null;
    const left = Math.sin((1-fraction)*omega)/sinOmega;
    const right = Math.sin(fraction*omega)/sinOmega;
    const x = left*va[0] + right*vb[0];
    const y = left*va[1] + right*vb[1];
    const z = left*va[2] + right*vb[2];
    return { lat: Math.atan2(z, Math.sqrt(x*x+y*y))/rad, lon: Math.atan2(y,x)/rad };
  }

  function samplePath(points, requestedCount) {
    const path = validPath(points);
    const count = Number.isInteger(requestedCount) ? Math.max(2, Math.min(MAX_SAMPLES, requestedCount)) : 24;
    if (!path) return null;
    const lengths = [];
    let total = 0;
    for (let i=1;i<path.length;i++) {
      const length = geo.distance(path[i-1], path[i]);
      if (!Number.isFinite(length) || length <= 0) return null;
      lengths.push(length); total += length;
    }
    if (!Number.isFinite(total) || total <= 0) return null;
    const samples = [];
    for (let index=0; index<count; index++) {
      const target = total * index / (count-1);
      let cumulative = 0, segment = lengths.length-1, fraction = 1;
      for (let i=0;i<lengths.length;i++) {
        if (target <= cumulative + lengths[i] || i === lengths.length-1) {
          segment = i;
          fraction = Math.max(0, Math.min(1, (target-cumulative)/lengths[i]));
          break;
        }
        cumulative += lengths[i];
      }
      const point = interpolateGreatCircle(path[segment], path[segment+1], fraction);
      if (!point) return null;
      samples.push({ lat: point.lat, lon: point.lon, distanceM: target });
    }
    return samples;
  }

  function elevationUrl(samples) {
    if (!Array.isArray(samples) || samples.length < 2 || samples.length > MAX_SAMPLES) return null;
    const valid = samples.every(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lon) &&
      p.lat >= -90 && p.lat <= 90 && p.lon >= -180 && p.lon <= 180);
    if (!valid) return null;
    const lat = samples.map(p => String(Number(p.lat.toFixed(6)))).join(",");
    const lon = samples.map(p => String(Number(p.lon.toFixed(6)))).join(",");
    return "https://api.open-meteo.com/v1/elevation?latitude=" +
      encodeURIComponent(lat) + "&longitude=" + encodeURIComponent(lon);
  }

  function buildProfile(samples, elevations) {
    if (!Array.isArray(samples) || !Array.isArray(elevations) ||
        samples.length < 2 || samples.length !== elevations.length) return null;
    const rows = [];
    for (let i=0;i<samples.length;i++) {
      const p=samples[i];
      if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon) ||
          !Number.isFinite(p.distanceM) || p.distanceM < 0) return null;
      const raw=elevations[i];
      const elevation=raw === null || raw === undefined || raw === "" ? null :
        (typeof raw === "boolean" ? null : Number(raw));
      rows.push({ lat:p.lat, lon:p.lon, distanceM:p.distanceM,
        elevationM:Number.isFinite(elevation) ? elevation : null, gradePercent:null });
    }
    for (let i=1;i<rows.length;i++) {
      const previous=rows[i-1], current=rows[i];
      const delta=current.distanceM-previous.distanceM;
      if (delta > 0 && previous.elevationM !== null && current.elevationM !== null) {
        current.gradePercent=(current.elevationM-previous.elevationM)/delta*100;
      }
    }
    const known=rows.filter(row=>row.elevationM !== null);
    const totalDistanceM=rows[rows.length-1].distanceM;
    let cumulativeAscentM=0,cumulativeDescentM=0,maxUphillGradePercent=null,maxDownhillGradePercent=null;
    for(let i=1;i<rows.length;i++){
      const previous=rows[i-1],current=rows[i];
      // Never bridge a missing DEM sample: only adjacent known samples contribute.
      if(previous.elevationM===null||current.elevationM===null)continue;
      const delta=current.elevationM-previous.elevationM;
      if(delta>0)cumulativeAscentM+=delta;
      else if(delta<0)cumulativeDescentM+=Math.abs(delta);
      if(current.gradePercent!==null){
        if(current.gradePercent>0)maxUphillGradePercent=maxUphillGradePercent===null?current.gradePercent:Math.max(maxUphillGradePercent,current.gradePercent);
        if(current.gradePercent<0)maxDownhillGradePercent=maxDownhillGradePercent===null?current.gradePercent:Math.min(maxDownhillGradePercent,current.gradePercent);
      }
    }
    if (!known.length) return { rows, totalDistanceM,
      minElevationM:null,maxElevationM:null,elevationDifferenceM:null,averageGradePercent:null,
      cumulativeAscentM:0,cumulativeDescentM:0,maxUphillGradePercent:null,maxDownhillGradePercent:null,
      validSampleCount:0,missingSampleCount:rows.length };
    const values=known.map(row=>row.elevationM);
    const first=rows[0].elevationM, last=rows[rows.length-1].elevationM;
    return { rows,totalDistanceM,minElevationM:Math.min(...values),maxElevationM:Math.max(...values),
      elevationDifferenceM:first===null||last===null?null:last-first,
      averageGradePercent:first===null||last===null||totalDistanceM<=0?null:(last-first)/totalDistanceM*100,
      cumulativeAscentM,cumulativeDescentM,maxUphillGradePercent,maxDownhillGradePercent,
      validSampleCount:known.length,missingSampleCount:rows.length-known.length };
  }

  return { MAX_SAMPLES, validPath, interpolateGreatCircle, samplePath, elevationUrl, buildProfile };
});
