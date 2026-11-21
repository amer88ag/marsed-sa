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
import os
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

CITIES = {
    "riyadh": {"name": "الرياض", "lat": 24.7136, "lon": 46.6753},
    "abha": {"name": "أبها", "lat": 18.2164, "lon": 42.5053},
    "jeddah": {"name": "جدة", "lat": 21.4858, "lon": 39.1925},
    "dammam": {"name": "الدمام", "lat": 26.4207, "lon": 50.0888},
    "tabuk": {"name": "تبوك", "lat": 28.3838, "lon": 36.5550},
    "hail": {"name": "حائل", "lat": 27.5114, "lon": 41.7208},
    "buraidah": {"name": "بريدة", "lat": 26.3260, "lon": 43.9750},
    "madinah": {"name": "المدينة المنورة", "lat": 24.5247, "lon": 39.5692},
    "makkah": {"name": "مكة المكرمة", "lat": 21.3891, "lon": 39.8579},
    "jazan": {"name": "جازان", "lat": 16.8892, "lon": 42.5511},
    "najran": {"name": "نجران", "lat": 17.5650, "lon": 44.2289},
    "arar": {"name": "عرعر", "lat": 30.9753, "lon": 41.0381},
    "sakaka": {"name": "سكاكا", "lat": 29.9697, "lon": 40.2064},
}

BASE = "https://data.chc.ucsb.edu/products/CHIRPS/v3.0/daily/final/sat"


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


def file_url(day: dt.date) -> str:
    return f"{BASE}/{day.year}/chirps-v3.0.sat.{day:%Y.%m.%d}.tif"


def download(url: str, destination: Path):
    request = urllib.request.Request(url, headers={"User-Agent": "marsed-sa/0.1 data-research"})
    with urllib.request.urlopen(request, timeout=90) as response, destination.open("wb") as target:
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            target.write(chunk)


def extract_values(tif_path: Path):
    try:
        import rasterio
    except ImportError as exc:
        raise RuntimeError("Install rasterio before running the CHIRPS extractor") from exc

    result = {}
    with rasterio.open(tif_path) as dataset:
        for key, city in CITIES.items():
            sample = next(dataset.sample([(city["lon"], city["lat"])], masked=True))
            value = sample[0]
            if getattr(value, "mask", False) or not math.isfinite(float(value)):
                result[key] = None
            else:
                result[key] = round(float(value), 2)
    return result


def build_dataset(days, downloader=download, extractor=extract_values):
    series = {key: [] for key in CITIES}
    with tempfile.TemporaryDirectory(prefix="chirps-sa-") as temp_dir:
        raster = Path(temp_dir) / "daily.tif"
        for day in days:
            url = file_url(day)
            try:
                downloader(url, raster)
                values = extractor(raster)
            except urllib.error.HTTPError as exc:
                if exc.code == 404:
                    values = {key: None for key in CITIES}
                else:
                    raise
            for key in CITIES:
                series[key].append({"date": day.isoformat(), "precipitation_mm": values.get(key)})
            raster.unlink(missing_ok=True)

    return {
        "schema_version": 1,
        "source": "CHIRPS v3.0 DAILY SAT FINAL",
        "source_url": "https://www.chc.ucsb.edu/data/chirps3",
        "units": "mm/day",
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
