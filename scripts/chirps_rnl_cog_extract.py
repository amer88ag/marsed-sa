#!/usr/bin/env python3
"""Extract CHIRPS v3 RNL daily values for Saudi city points from public COGs."""
from __future__ import annotations
import argparse, datetime as dt, json, math
from pathlib import Path

COLLECTION_URL = "https://data.source.coop/wfp/chirps-rnl-daily/collection.geoparquet"
SOURCE_URL = "https://www.chc.ucsb.edu/data/chirps3"
SAUDI_BBOX = [34.0, 16.0, 56.0, 33.0]
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

def parse_date_range(start, end, max_days=366):
    first, last = dt.date.fromisoformat(start), dt.date.fromisoformat(end)
    if last < first: raise ValueError("end date must be on or after start date")
    count = (last-first).days+1
    if count > max_days or count > 366: raise ValueError("extract at most 366 days per run; use annual batches")
    if last >= dt.date.today(): raise ValueError("CHIRPS final data dates must be in the past")
    if first < dt.date(1981,1,1): raise ValueError("CHIRPS v3 RNL historical coverage starts in 1981")
    return [first+dt.timedelta(days=i) for i in range(count)]

def item_date(item):
    value=item.get("properties",{}).get("datetime") or item.get("datetime")
    if not value: raise ValueError("STAC item has no datetime")
    return dt.datetime.fromisoformat(value.replace("Z","+00:00")).date().isoformat()

def asset_href(item):
    assets=item.get("assets") or {}
    candidates=[a.get("href","") for a in assets.values() if isinstance(a,dict)]
    href=next((v for v in candidates if v.lower().endswith((".tif",".tiff"))),None)
    if not href or not href.startswith("https://"): raise ValueError("STAC item has no public HTTPS GeoTIFF asset")
    return href

def clean_value(value):
    try:
        import numpy as np
        if np.ma.is_masked(value): return None
    except ImportError: pass
    try: number=float(value)
    except (TypeError,ValueError): return None
    if not math.isfinite(number) or number < 0 or number == -9999: return None
    return round(number,2)

def search_items(start,end):
    try: import rustac
    except ImportError as exc: raise RuntimeError("Install rustac to query the CHIRPS RNL STAC GeoParquet index") from exc
    return rustac.search_sync(COLLECTION_URL,bbox=SAUDI_BBOX,datetime=f"{start}/{end}")

def extract_dataset(start,end,searcher=None,opener=None):
    days=parse_date_range(start,end)
    if searcher is None: searcher=search_items
    if opener is None:
        try: import rasterio
        except ImportError as exc: raise RuntimeError("Install rasterio to read remote CHIRPS COG assets") from exc
        opener=rasterio.open
    items=searcher(days[0].isoformat(),days[-1].isoformat())
    by_date={}
    for item in items:
        date=item_date(item)
        if date in by_date: raise ValueError(f"Duplicate CHIRPS RNL item for {date}")
        by_date[date]=item
    records={city_id:[] for city_id in CITIES}
    for day in days:
        key=day.isoformat()
        values={city_id:None for city_id in CITIES}
        item=by_date.get(key)
        if item is not None:
            href=asset_href(item)
            coords=[(city["lon"],city["lat"]) for city in CITIES.values()]
            with opener(href) as dataset:
                if dataset.count < 1: raise ValueError(f"No raster band in CHIRPS asset for {key}")
                samples=list(dataset.sample(coords,indexes=1,masked=True))
            if len(samples)!=len(CITIES): raise ValueError(f"Incomplete city samples for {key}")
            values={city_id:clean_value(sample[0]) for city_id,sample in zip(CITIES,samples)}
        for city_id in CITIES: records[city_id].append({"date":key,"precipitation_mm":values[city_id]})
    if not any(row["precipitation_mm"] is not None for rows in records.values() for row in rows):
        raise RuntimeError("No valid Saudi city pixels found; refusing to emit an empty archive")
    return {
      "schema_version":1,"source":"CHIRPS v3 DAILY RNL FINAL via WFP Source Cooperative COG",
      "date_range":{"start":days[0].isoformat(),"end":days[-1].isoformat(),"days":len(days)},
      "source_url":SOURCE_URL,"distribution_url":COLLECTION_URL,"units":"mm/day",
      "products":{"rnl":"daily final; pentad totals disaggregated using ECMWF ERA5"},
      "spatial_sampling":"nearest grid cell at city coordinates; not city-area mean",
      "date_semantics":"daily labels assigned during pentad disaggregation; not a uniform station observation window",
      "generated_at_utc":dt.datetime.now(dt.timezone.utc).isoformat(),"cities":CITIES,"series":{"rnl":records},
      "provenance":{"producer":"Climate Hazards Center, UCSB","distribution_processor":"WFP Humanitarian Data Cube",
        "host":"Source Cooperative","license":"CC BY 4.0",
        "attribution":"CHIRPS v3, Climate Hazards Center, UCSB; distributed by WFP Source Cooperative",
        "limitations":["RNL gridded estimate, not a rain-gauge observation","nearest grid cell, not a city-area average"]}
    }

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start",required=True); parser.add_argument("--end",required=True)
    parser.add_argument("--output",default="data/chirps_rnl_history.json")
    args=parser.parse_args(); payload=extract_dataset(args.start,args.end)
    output=Path(args.output); output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(payload,ensure_ascii=False,separators=(",",":"))+"\n",encoding="utf-8")
    print(f"Wrote {output}: {payload['date_range']['days']} days, {len(CITIES)} Saudi city points")

if __name__=="__main__": main()
