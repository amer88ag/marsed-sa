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


def validate_metadata(meta: dict) -> dict:
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
    transform = meta["transform"]
    if len(transform) < 6 or transform[1] <= 0 or transform[5] >= 0:
        raise ValueError("unexpected north-up raster affine transform")
    return {
        "width": int(meta["width"]),
        "height": int(meta["height"]),
        "band_count": int(meta["count"]),
        "crs": meta["crs"],
        "bounds": bounds,
        "pixel_size_degrees": [abs(float(transform[1])), abs(float(transform[5]))],
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
    args = parser.parse_args(argv)
    if not args.raster.is_file():
        parser.error(f"file not found: {args.raster}")
    report = inspect_file(args.raster)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    print("status=metadata_and_value_sanity_passed; COG conformance and hydrological suitability are not certified")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(2)
