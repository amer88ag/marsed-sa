#!/usr/bin/env python3
"""Inspect a downloaded Copernicus GLO-90 GeoTIFF before hydrology processing.

Requires rasterio (optional local research dependency). No reprojection or
hydrologic conditioning is performed by this command.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path


def validate_metadata(meta: dict, expected_bounds: dict | None = None) -> dict:
    required = ("width", "height", "count", "crs", "bounds", "transform", "dtype", "nodata")
    missing = [key for key in required if key not in meta]
    if missing:
        raise ValueError("missing raster metadata: " + ", ".join(missing))
    if meta["width"] < 100 or meta["height"] < 100:
        raise ValueError("raster dimensions are unexpectedly small for a one-degree DEM tile")
    if meta["count"] != 1:
        raise ValueError("expected one elevation band")
    if not meta["crs"]:
        raise ValueError("raster CRS is missing")
    if meta["crs"] != "EPSG:4326":
        raise ValueError("expected EPSG:4326 source grid; explicit reprojection is required")
    if not isinstance(meta["nodata"], (int, float)) or not math.isfinite(meta["nodata"]):
        raise ValueError("explicit finite NoData value is required")
    bounds = meta["bounds"]
    if not (bounds["left"] < bounds["right"] and bounds["bottom"] < bounds["top"]):
        raise ValueError("invalid raster bounds")
    if not (-180 <= bounds["left"] < bounds["right"] <= 180 and
            -90 <= bounds["bottom"] < bounds["top"] <= 90):
        raise ValueError("EPSG:4326 raster bounds fall outside longitude/latitude limits")
    if expected_bounds is not None:
        for edge in ("left", "bottom", "right", "top"):
            if edge not in expected_bounds or not math.isclose(
                float(bounds[edge]), float(expected_bounds[edge]), rel_tol=0, abs_tol=1e-6
            ):
                raise ValueError(f"raster {edge} bound does not match the requested DEM tile footprint")
    transform = meta["transform"]
    if len(transform) < 6 or transform[0] <= 0 or transform[4] >= 0:
        raise ValueError("unexpected north-up raster affine transform")
    if abs(transform[1]) > 1e-12 or abs(transform[3]) > 1e-12:
        raise ValueError("rotated or skewed raster grid is not supported")
    expected_right = transform[2] + meta["width"] * transform[0]
    expected_bottom = transform[5] + meta["height"] * transform[4]
    tolerance = max(abs(transform[0]), abs(transform[4])) * 1e-6
    if (abs(bounds["left"] - transform[2]) > tolerance or
            abs(bounds["top"] - transform[5]) > tolerance or
            abs(bounds["right"] - expected_right) > tolerance or
            abs(bounds["bottom"] - expected_bottom) > tolerance):
        raise ValueError("raster bounds do not match affine transform and dimensions")
    if not str(meta["dtype"]).startswith(("float", "int", "uint")):
        raise ValueError("elevation band must use a numeric raster dtype")
    return {
        "width": int(meta["width"]),
        "height": int(meta["height"]),
        "band_count": int(meta["count"]),
        "crs": meta["crs"],
        "bounds": bounds,
        "pixel_size_degrees": [abs(float(transform[0])), abs(float(transform[4]))],
        "dtype": str(meta["dtype"]),
        "nodata": float(meta["nodata"]),
    }


def inspect_file(path: Path) -> dict:
    try:
        import rasterio
    except ImportError as exc:
        raise RuntimeError("rasterio is required; install it in a local GIS environment (pip install rasterio)") from exc
    with rasterio.open(path) as ds:
        crs = ds.crs.to_string() if ds.crs else None
        meta = {
            "width": ds.width,
            "height": ds.height,
            "count": ds.count,
            "crs": crs,
            "bounds": {"left": ds.bounds.left, "bottom": ds.bounds.bottom,
                       "right": ds.bounds.right, "top": ds.bounds.top},
            "transform": tuple(ds.transform),
            "dtype": ds.dtypes[0] if ds.count else None,
            "nodata": ds.nodata,
        }
        validated = validate_metadata(meta)
        # Read only band 1 as a masked array; exclude declared NoData.
        band = ds.read(1, masked=True)
        values = band.compressed()
        if values.size == 0:
            raise ValueError("raster contains no valid elevation pixels")
        validated.update({
            "valid_pixels": int(values.size),
            "nodata_pixels": int(band.size - values.size),
            "elevation_min_m": float(values.min()),
            "elevation_max_m": float(values.max()),
            "elevation_mean_m": float(values.mean()),
            "tags": ds.tags(),
            "image_structure": ds.tags(ns="IMAGE_STRUCTURE"),
        })
        if not all(math.isfinite(validated[k]) for k in
                   ("elevation_min_m", "elevation_max_m", "elevation_mean_m")):
            raise ValueError("raster contains non-finite elevation statistics")
        if validated["elevation_min_m"] < -500 or validated["elevation_max_m"] > 9000:
            raise ValueError("elevation range is outside broad sanity bounds; inspect source and NoData")
        return validated


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("raster", type=Path)
    parser.add_argument(
        "--expected-bounds", metavar="LEFT,BOTTOM,RIGHT,TOP",
        help="optional expected geographic tile footprint, e.g. 42,18,43,19",
    )
    args = parser.parse_args(argv)
    if not args.raster.is_file():
        parser.error(f"file not found: {args.raster}")
    report = inspect_file(args.raster)
    if args.expected_bounds:
        try:
            values = [float(part) for part in args.expected_bounds.split(",")]
            if len(values) != 4 or not all(math.isfinite(value) for value in values):
                raise ValueError
        except ValueError:
            parser.error("--expected-bounds must contain four finite comma-separated numbers")
        expected = dict(zip(("left", "bottom", "right", "top"), values))
        # Reopen only for metadata validation against the caller-supplied tile footprint.
        import rasterio
        with rasterio.open(args.raster) as ds:
            validate_metadata({
                "width": ds.width, "height": ds.height, "count": ds.count,
                "crs": ds.crs.to_string() if ds.crs else None,
                "bounds": {"left": ds.bounds.left, "bottom": ds.bounds.bottom,
                           "right": ds.bounds.right, "top": ds.bounds.top},
                "transform": tuple(ds.transform), "dtype": ds.dtypes[0] if ds.count else None,
                "nodata": ds.nodata,
            }, expected_bounds=expected)
        report["expected_tile_bounds"] = expected
    print(json.dumps(report, ensure_ascii=False, indent=2))
    print("status=metadata_and_value_sanity_passed; COG conformance and hydrological suitability are not certified")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(2)
