#!/usr/bin/env python3
"""Discover and optionally download public Copernicus DEM GLO-90 COG tiles.

This utility only fetches source files. It does not interpret raster pixels,
mosaic, reproject, or make hydrological claims.
"""
from __future__ import annotations

import argparse
import os
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

BUCKET = "copernicus-dem-90m"
BASE_URL = f"https://{BUCKET}.s3.eu-central-1.amazonaws.com"
RESOLUTION_CODE = "30"  # arc-seconds: GLO-90, not 30 metres
USER_AGENT = "SaudiObservatory-DEM-research/1.0"


def _hemisphere(value: int, positive: str, negative: str, width: int) -> str:
    return f"{positive if value >= 0 else negative}{abs(value):0{width}d}_00"


def tile_prefix(latitude: float, longitude: float) -> str:
    """Return the documented 1x1-degree GLO-90 tile prefix for a point."""
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        raise ValueError("latitude/longitude outside valid geographic bounds")
    # At the north/east outer limits, use the last intersecting 1-degree cell.
    south = min(int(latitude // 1), 89)
    west = min(int(longitude // 1), 179)
    northing = _hemisphere(south, "N", "S", 2)
    easting = _hemisphere(west, "E", "W", 3)
    return f"Copernicus_DSM_COG_{RESOLUTION_CODE}_{northing}_{easting}_DEM"


def tile_object_key(prefix: str) -> str:
    """Return the canonical COG key inside its one-degree tile folder."""
    if not prefix.startswith("Copernicus_DSM_COG_30_") or not prefix.endswith("_DEM"):
        raise ValueError("expected a Copernicus GLO-90 tile prefix")
    return f"{prefix}/{prefix}.tif"


def _request(url: str):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    return urllib.request.urlopen(request, timeout=45)


def discover_tile(prefix: str) -> str:
    """Resolve the actual TIFF object key from public S3 ListObjectsV2 XML."""
    query = urllib.parse.urlencode({"list-type": "2", "prefix": prefix + "/"})
    with _request(f"{BASE_URL}/?{query}") as response:
        payload = response.read()
    root = ET.fromstring(payload)
    ns = {"s3": "http://s3.amazonaws.com/doc/2006-03-01/"}
    keys = [node.text for node in root.findall(".//s3:Contents/s3:Key", ns) if node.text]
    expected = tile_object_key(prefix)
    if expected not in keys:
        raise FileNotFoundError(f"Primary DEM COG not listed for tile prefix: {prefix}")
    return expected


def download_object(key: str, destination: Path) -> tuple[int, str]:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".part")
    import hashlib
    digest = hashlib.sha256()
    size = 0
    header = bytearray()
    try:
        with _request(f"{BASE_URL}/{urllib.parse.quote(key, safe='/')}") as response, temporary.open("wb") as output:
            content_length = response.headers.get("Content-Length")
            expected_size = int(content_length) if content_length and content_length.isdigit() else None
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                if len(header) < 4:
                    header.extend(chunk[:4 - len(header)])
                output.write(chunk)
                digest.update(chunk)
                size += len(chunk)
        if size == 0:
            raise IOError("Downloaded object is empty")
        # TIFF classic and BigTIFF signatures, little- and big-endian.
        if bytes(header) not in (b"II*\x00", b"MM\x00*", b"II+\x00", b"MM\x00+"):
            raise IOError("Downloaded object does not have a valid TIFF/BigTIFF signature")
        if expected_size is not None and size != expected_size:
            raise IOError(f"Downloaded size mismatch: expected {expected_size} bytes, received {size}")
        os.replace(temporary, destination)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise
    return size, digest.hexdigest()


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lat", type=float, required=True)
    parser.add_argument("--lon", type=float, required=True)
    parser.add_argument("--output", type=Path, default=Path("data/dem/copernicus-glo90"))
    parser.add_argument("--list-only", action="store_true", help="resolve and print the public object key without downloading")
    args = parser.parse_args(argv)
    prefix = tile_prefix(args.lat, args.lon)
    key = discover_tile(prefix)
    print(f"source=Copernicus DEM GLO-90")
    print(f"bucket={BUCKET}")
    print(f"prefix={prefix}")
    print(f"object_key={key}")
    print(f"source_url={BASE_URL}/{urllib.parse.quote(key, safe='/')}")
    if args.list_only:
        return 0
    destination = args.output / Path(key).name
    size, sha256 = download_object(key, destination)
    print(f"downloaded={destination}")
    print(f"bytes={size}")
    print(f"sha256={sha256}")
    print("notice=Downloaded source COG only; raster validation and reprojection are not performed.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(2)
