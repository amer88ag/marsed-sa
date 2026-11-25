#!/usr/bin/env python3
"""Extract CHIRPS v3 daily final/sat precipitation at configured Saudi city points.

The output is a compact JSON time series. Values are grid-cell estimates at city
coordinates, not municipal area averages and not rain-gauge observations.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

REGISTRY_PATH = Path(__file__).resolve().parent.parent / "config" / "cities.json"


def load_cities(path: Path = REGISTRY_PATH) -> dict:
    """CHIRPS sampling points from the unified city registry (group "chirps").

    The registry is the single source of truth for city coordinates. Changing a
    coordinate there requires re-extracting data/chirps_daily.json.
    """
    registry = json.loads(path.read_text(encoding="utf-8"))
    return {
        city["id"]: {"name": city["name_ar"], "lat": city["lat"], "lon": city["lon"]}
        for city in registry["cities"]
        if "chirps" in city["groups"]
    }


CITIES = load_cities()

def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", required=True, help="First date YYYY-MM-DD")
    parser.add_argument("--end", required=True, help="Last date YYYY-MM-DD")
    parser.add_argument("--output", default="data/chirps_daily.json")
    parser.add_argument("--max-days", type=int, default=14)
    return parser.parse_args()


def date_range(start: str, end: str, max_days: int = 14):
    first = dt.date.fromisoformat(start)
    last = dt.date.fromisoformat(end)
    if last < first:
        raise ValueError("end date must be on or after start date")
    count = (last - first).days + 1
    if count > max_days:
        raise ValueError(f"date range exceeds the {max_days}-day safety limit")
    if last >= dt.date.today():
        raise ValueError("CHIRPS final data dates must be in the past")
    return [first + dt.timedelta(days=i) for i in range(count)]


def file_url(day: dt.date, product: str = "sat") -> str:
    if product not in {"sat", "rnl"}:
        raise ValueError("product must be 'sat' or 'rnl'")
    return f"https://data.chc.ucsb.edu/products/CHIRPS/v3.0/daily/final/{product}/{day.year}/chirps-v3.0.{product}.{day:%Y.%m.%d}.tif"


def download(url: str, destination: Path, max_attempts: int = 6):
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "marsed-sa/0.1 (research; contact: project repository)",
            "Accept": "image/tiff,application/octet-stream,*/*",
        },
    )
    for attempt in range(max_attempts):
        try:
            with urllib.request.urlopen(request, timeout=180) as response, destination.open("wb") as target:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    target.write(chunk)
            # Be polite to the shared CHC public data server.
            time.sleep(2)
            return
        except urllib.error.HTTPError as exc:
            destination.unlink(missing_ok=True)
            retryable = exc.code in {429, 500, 502, 503, 504}
            if not retryable or attempt == max_attempts - 1:
                raise
            retry_after = exc.headers.get("Retry-After")
            try:
                delay = min(120, max(2, int(retry_after))) if retry_after else min(120, 2 ** (attempt + 1))
            except (TypeError, ValueError):
                delay = min(120, 2 ** (attempt + 1))
            time.sleep(delay)
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            destination.unlink(missing_ok=True)
            if attempt == max_attempts - 1:
                raise
            # Network timeouts and transient connection resets are retried
            # separately from HTTP status errors, with capped exponential backoff.
            time.sleep(min(120, 2 ** (attempt + 1)))


def clean_precipitation(value):
    """Return a valid non-negative precipitation depth, or None for missing/invalid cells."""
    try:
        import numpy as np
        if np.ma.is_masked(value):
            return None
        number = float(value)
    except (ImportError, TypeError, ValueError):
        try:
            number = float(value)
        except (TypeError, ValueError):
            return None
    if not math.isfinite(number) or number < 0:
        return None
    return round(number, 2)


def extract_values(tif_path: Path):
    try:
        import rasterio
    except ImportError as exc:
        raise RuntimeError("Install rasterio before running the CHIRPS extractor") from exc

    result = {}
    with rasterio.open(tif_path) as dataset:
        if dataset.count < 1:
            raise ValueError(f"No raster bands found in {tif_path}")
        for key, city in CITIES.items():
            sample = next(dataset.sample([(city["lon"], city["lat"])], masked=True))
            result[key] = clean_precipitation(sample[0])
    return result


def build_dataset(days, downloader=download, extractor=extract_values):
    series = {product: {key: [] for key in CITIES} for product in ("sat", "rnl")}
    with tempfile.TemporaryDirectory(prefix="chirps-sa-") as temp_dir:
        raster = Path(temp_dir) / "daily.tif"
        for product in ("sat", "rnl"):
            for day in days:
                url = file_url(day, product)
                try:
                    downloader(url, raster)
                    values = extractor(raster)
                except urllib.error.HTTPError as exc:
                    if exc.code == 404:
                        values = {key: None for key in CITIES}
                    else:
                        raise
                for key in CITIES:
                    series[product][key].append({"date": day.isoformat(), "precipitation_mm": values.get(key)})
                raster.unlink(missing_ok=True)

    for product in ("sat", "rnl"):
        if not any(
            row["precipitation_mm"] is not None
            for city_rows in series[product].values()
            for row in city_rows
        ):
            raise RuntimeError(
                f"No valid {product.upper()} pixels were extracted; refusing to publish an all-missing dataset"
            )

    return {
        "schema_version": 1,
        "source": "CHIRPS v3.0 DAILY SAT FINAL and DAILY RNL FINAL",
        "date_range": {"start": days[0].isoformat(), "end": days[-1].isoformat(), "days": len(days)},
        "source_url": "https://www.chc.ucsb.edu/data/chirps3",
        "units": "mm/day",
        "products": {
            "sat": "daily final; pentad totals disaggregated using NASA IMERG Late V07",
            "rnl": "daily final; pentad totals disaggregated using ECMWF ERA5",
        },
        "spatial_sampling": "nearest grid cell at city coordinates; not city-area mean",
        "date_semantics": "daily labels assigned during pentad disaggregation; not a uniform station observation window",
        "generated_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
        "cities": CITIES,
        "series": series,
    }


def main():
    args = parse_args()
    days = date_range(args.start, args.end, args.max_days)
    payload = build_dataset(days)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Wrote {output} for {len(days)} dates and {len(CITIES)} city grid points")


if __name__ == "__main__":
    main()
