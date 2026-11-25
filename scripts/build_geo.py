#!/usr/bin/env python3
"""Build the observatory's geographic reference files from Natural Earth.

Inputs (Natural Earth 1:10m GeoJSON, public domain, https://github.com/nvkelso/natural-earth-vector):
  --countries-sau  ne_10m_admin_0_countries_sau.geojson   (Saudi Arabia point-of-view boundaries)
  --admin1         ne_10m_admin_1_states_provinces.geojson
  --places         ne_10m_populated_places_simple.geojson

Outputs:
  data/geo/saudi_boundary.geojson   simplified national outline (illustrative, not an official GEOSA boundary)
  data/geo/saudi_regions.geojson    simplified 13 administrative regions (illustrative)
  config/cities.json                annotated in place: region_id + Natural Earth reference coordinate and distance
  src/platform/geo/cities.js        browser/Node module generated from config/cities.json

The canonical city coordinates in config/cities.json are NEVER changed by this script;
it only records the reference and the distance so discrepancies are visible and reviewable.
Pure Python, no third-party dependencies.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
from pathlib import Path

REGION_IDS = {
    "Ar Riyad": "riyadh", "Makkah": "makkah", "Al Madinah": "madinah", "Al Quassim": "qassim",
    "Ash Sharqiyah": "eastern", "`Asir": "asir", "Tabuk": "tabuk", "Ha'il": "hail",
    "Al Hudud ash Shamaliyah": "northern_borders", "Jizan": "jazan", "Najran": "najran",
    "Al Bahah": "albaha", "Al Jawf": "jawf",
}
SOURCE = {
    "name": "Natural Earth 1:10m (v5.x)",
    "url": "https://www.naturalearthdata.com/",
    "repository": "https://github.com/nvkelso/natural-earth-vector",
    "license": "Public domain",
}


def perpendicular(point, start, end):
    if start == end:
        return math.dist(point, start)
    (x, y), (x1, y1), (x2, y2) = point, start, end
    return abs((y2 - y1) * x - (x2 - x1) * y + x2 * y1 - y2 * x1) / math.hypot(x2 - x1, y2 - y1)


def simplify(points, tolerance):
    """Iterative Douglas-Peucker on an open polyline."""
    if len(points) < 3:
        return list(points)
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        first, last = stack.pop()
        index, distance = None, tolerance
        for i in range(first + 1, last):
            d = perpendicular(points[i], points[first], points[last])
            if d > distance:
                index, distance = i, d
        if index is not None:
            keep[index] = True
            stack.extend([(first, index), (index, last)])
    return [p for p, k in zip(points, keep) if k]


def simplify_ring(ring, tolerance):
    out = simplify(ring, tolerance)
    if out[0] != out[-1]:
        out.append(out[0])
    return [[round(x, 4), round(y, 4)] for x, y in out] if len(out) >= 4 else None


def simplify_geometry(geometry, tolerance, min_area=0.0):
    polygons = geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]
    result = []
    for polygon in polygons:
        if min_area and abs(ring_area(polygon[0])) < min_area:
            continue
        rings = [simplify_ring(r, tolerance) for r in polygon]
        if rings[0] is None:
            continue
        result.append([r for r in rings if r is not None])
    return {"type": "MultiPolygon", "coordinates": result}


def ring_area(ring):
    return sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(ring, ring[1:])) / 2


def point_in_ring(lon, lat, ring):
    inside = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        if (y1 > lat) != (y2 > lat) and lon < (x2 - x1) * (lat - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def point_in_geometry(lon, lat, geometry):
    polygons = geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]
    for polygon in polygons:
        if point_in_ring(lon, lat, polygon[0]) and not any(point_in_ring(lon, lat, hole) for hole in polygon[1:]):
            return True
    return False


def haversine_km(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 6371.0088 * 2 * math.asin(math.sqrt(a))


def count_points(geometry):
    return sum(len(r) for polygon in geometry["coordinates"] for r in polygon)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--countries-sau", required=True)
    parser.add_argument("--admin1", required=True)
    parser.add_argument("--places", required=True)
    parser.add_argument("--root", default=".")
    parser.add_argument("--boundary-tolerance", type=float, default=0.01)
    parser.add_argument("--region-tolerance", type=float, default=0.02)
    args = parser.parse_args()
    root = Path(args.root)
    today = dt.date.today().isoformat()

    countries = json.loads(Path(args.countries_sau).read_text(encoding="utf-8"))
    sau = next(f for f in countries["features"] if f["properties"].get("ADM0_A3") == "SAU")
    boundary = simplify_geometry(sau["geometry"], args.boundary_tolerance, min_area=0.0005)
    admin1 = json.loads(Path(args.admin1).read_text(encoding="utf-8"))
    regions = [f for f in admin1["features"] if f["properties"].get("adm0_a3") == "SAU"]
    if len(regions) != 13:
        raise SystemExit("expected 13 Saudi regions, found %d" % len(regions))

    meta = dict(SOURCE, generated_on=today, worldview="Saudi Arabia point of view (admin_0_countries_sau)",
                disclaimer="Illustrative cartographic boundary. Not an official boundary of the General Authority "
                           "for Survey and Geospatial Information (GEOSA).")
    geo_dir = root / "data" / "geo"
    geo_dir.mkdir(parents=True, exist_ok=True)
    (geo_dir / "saudi_boundary.geojson").write_text(json.dumps({
        "type": "FeatureCollection", "metadata": dict(meta, simplification_tolerance_deg=args.boundary_tolerance,
                                                       source_points=sum(len(r) for p in sau["geometry"]["coordinates"] for r in p),
                                                       output_points=count_points(boundary)),
        "features": [{"type": "Feature", "properties": {"id": "SAU", "name_ar": "المملكة العربية السعودية",
                                                         "wikidata": sau["properties"].get("WIKIDATAID")},
                      "geometry": boundary}]}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    region_features = []
    for feature in regions:
        props = feature["properties"]
        region_id = REGION_IDS[props["name"]]
        region_features.append({"type": "Feature", "properties": {
            "id": region_id, "name_ar": props.get("name_ar"), "name_en": props["name"], "iso_3166_2": props.get("iso_3166_2")},
            "geometry": simplify_geometry(feature["geometry"], args.region_tolerance, min_area=0.0005)})
    region_features.sort(key=lambda f: f["properties"]["id"])
    (geo_dir / "saudi_regions.geojson").write_text(json.dumps({
        "type": "FeatureCollection", "metadata": dict(meta, simplification_tolerance_deg=args.region_tolerance),
        "features": region_features}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # Annotate the city registry (canonical coordinates are left untouched).
    places = json.loads(Path(args.places).read_text(encoding="utf-8"))
    reference = [f["properties"] for f in places["features"] if f["properties"].get("adm0_a3") == "SAU"]
    registry_path = root / "config" / "cities.json"
    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    for city in registry["cities"]:
        lat, lon = city["lat"], city["lon"]
        city["inside_boundary"] = point_in_geometry(lon, lat, sau["geometry"])
        city["region_id"] = next((REGION_IDS[f["properties"]["name"]] for f in regions
                                  if point_in_geometry(lon, lat, f["geometry"])), None)
        match = next((p for p in reference if p["name"] == city.get("natural_earth_name")), None)
        city["reference"] = None if match is None else {
            "source": "Natural Earth populated places", "name": match["name"],
            "lat": round(match["latitude"], 5), "lon": round(match["longitude"], 5),
            "distance_km": round(haversine_km(lat, lon, match["latitude"], match["longitude"]), 1)}
    registry["reference_checked_on"] = today
    registry_path.write_text(json.dumps(registry, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    module = root / "src" / "platform" / "geo" / "cities.js"
    module.parent.mkdir(parents=True, exist_ok=True)
    module.write_text(render_module(registry), encoding="utf-8")
    print("boundary points: %d, regions: %d, cities: %d" % (count_points(boundary), len(region_features), len(registry["cities"])))


def render_module(registry):
    data = json.dumps(registry, ensure_ascii=False, indent=2)
    return """// GENERATED by scripts/build_geo.py from config/cities.json — do not edit by hand.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CityRegistry = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const REGISTRY = %s;
  const byId = {};
  REGISTRY.cities.forEach(function (city) { byId[city.id] = city; });
  function get(id) { return byId[id] || null; }
  function inGroup(group) { return REGISTRY.cities.filter(function (city) { return city.groups.indexOf(group) !== -1; }); }
  // {id: {name, lat, lon}} in registry order, as used by the dashboard pages.
  function placesFor(group) {
    const places = {};
    inGroup(group).forEach(function (city) { places[city.id] = { name: city.name_ar, lat: city.lat, lon: city.lon }; });
    return places;
  }
  function pointsFor(group) {
    return inGroup(group).map(function (city) {
      return { id: city.id, name: city.name_ar, lat: city.lat, lon: city.lon, region_id: city.region_id };
    });
  }
  function region(id) { return REGISTRY.regions.filter(function (item) { return item.id === id; })[0] || null; }
  return { REGISTRY: REGISTRY, BOUNDS: REGISTRY.map_bounds, get: get, inGroup: inGroup, placesFor: placesFor, pointsFor: pointsFor, region: region };
});
""" % data


if __name__ == "__main__":
    main()
