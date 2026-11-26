(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.GoogleGeoLinks = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  function point(lat, lon) {
    const latitude = Number(lat), longitude = Number(lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
        latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
    return { lat: latitude, lon: longitude };
  }
  function mapsSearchUrl(lat, lon) {
    const p = point(lat, lon);
    return p ? "https://www.google.com/maps/search/?api=1&query=" +
      encodeURIComponent(p.lat + "," + p.lon) : null;
  }
  function earthSearchUrl(lat, lon) {
    const p = point(lat, lon);
    return p ? "https://earth.google.com/web/search/" +
      encodeURIComponent(p.lat + "," + p.lon) : null;
  }
  function directionsUrl(origin, destination) {
    const a = origin && point(origin.lat, origin.lon);
    const b = destination && point(destination.lat, destination.lon);
    return a && b ? "https://www.google.com/maps/dir/?api=1&origin=" +
      encodeURIComponent(a.lat + "," + a.lon) + "&destination=" +
      encodeURIComponent(b.lat + "," + b.lon) + "&travelmode=driving" : null;
  }
  function xml(value) {
    return String(value == null ? "" : value).replace(/&/g, "&amp;")
      .replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  }
  function toKml(points) {
    const valid = (Array.isArray(points) ? points : []).filter(function (item) {
      return item && point(item.lat, item.lon);
    });
    const placemarks = valid.map(function (item) {
      const p = point(item.lat, item.lon);
      return "<Placemark><name>" + xml(item.name || item.id || "موقع") +
        "</name><description>" + xml(item.id || "") +
        "</description><Point><coordinates>" + p.lon + "," + p.lat +
        ",0</coordinates></Point></Placemark>";
    }).join("");
    return '<?xml version="1.0" encoding="UTF-8"?>' +
      '<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>مرصد السعودية - مواقع المدن</name>' +
      placemarks + "</Document></kml>";
  }
  return { point: point, mapsSearchUrl: mapsSearchUrl, earthSearchUrl: earthSearchUrl,
    directionsUrl: directionsUrl, toKml: toKml };
});
