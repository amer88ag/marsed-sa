import datetime as dt
import importlib.util
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "chirps_rnl_cog_extract.py"
SPEC = importlib.util.spec_from_file_location("chirps_rnl_cog_extract", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

class FakeRaster:
    count = 1
    def __enter__(self): return self
    def __exit__(self, *_): return False
    def sample(self, coordinates, indexes=1, masked=True):
        assert len(coordinates) == 13
        assert indexes == 1 and masked is True
        return iter([[0.25] for _ in coordinates])

class ChirpsRnlCogExtractTests(unittest.TestCase):
    def test_saudi_search_extent_covers_all_configured_city_points(self):
        west, south, east, north = MODULE.SAUDI_BBOX
        for city in MODULE.CITIES.values():
            self.assertGreaterEqual(city["lon"], west)
            self.assertLessEqual(city["lon"], east)
            self.assertGreaterEqual(city["lat"], south)
            self.assertLessEqual(city["lat"], north)

    def test_date_range_is_bounded_and_supported(self):
        self.assertEqual(len(MODULE.parse_date_range("2024-01-01","2024-12-31")),366)
        with self.assertRaises(ValueError): MODULE.parse_date_range("2024-01-01","2025-01-01")
        with self.assertRaises(ValueError): MODULE.parse_date_range("1980-12-31","1981-01-02")
    def test_reversed_and_future_ranges_are_rejected(self):
        with self.assertRaises(ValueError): MODULE.parse_date_range("2024-02-01","2024-01-01")
        future=(dt.date.today()+dt.timedelta(days=1)).isoformat()
        with self.assertRaises(ValueError): MODULE.parse_date_range(future,future)
    def test_stac_item_metadata_and_asset_are_required(self):
        item={"properties":{"datetime":"2024-01-01T00:00:00Z"},"assets":{"data":{"href":"https://data.example/rain.tif"}}}
        self.assertEqual(MODULE.item_date(item),"2024-01-01")
        self.assertEqual(MODULE.asset_href(item),"https://data.example/rain.tif")
        signed = {"assets": {"data": {"href": "https://data.example/rain.tif?token=temporary"}}}
        self.assertEqual(MODULE.asset_href(signed), "https://data.example/rain.tif?token=temporary")
        with self.assertRaises(ValueError): MODULE.asset_href({"assets":{"data":{"href":"http://example/rain.tif"}}})
    def test_extracts_city_points_and_keeps_missing_dates_null(self):
        item={"properties":{"datetime":"2024-01-01T00:00:00Z"},"assets":{"data":{"href":"https://data.example/one.tif"}}}
        calls=[]
        payload=MODULE.extract_dataset("2024-01-01","2024-01-02",
            searcher=lambda start,end:(calls.append((start,end)) or [item]),opener=lambda _:FakeRaster())
        self.assertEqual(calls,[("2024-01-01","2024-01-02")])
        self.assertEqual(payload["date_range"]["days"],2)
        self.assertEqual(set(payload["series"]),{"rnl"})
        for rows in payload["series"]["rnl"].values():
            self.assertEqual(rows[0]["precipitation_mm"],0.25)
            self.assertIsNone(rows[1]["precipitation_mm"])
    def test_duplicate_items_and_empty_data_are_rejected(self):
        item={"properties":{"datetime":"2024-01-01T00:00:00Z"},"assets":{"data":{"href":"https://data.example/one.tif"}}}
        with self.assertRaisesRegex(ValueError,"Duplicate"):
            MODULE.extract_dataset("2024-01-01","2024-01-01",searcher=lambda *_:[item,item],opener=lambda _:FakeRaster())
        with self.assertRaisesRegex(RuntimeError,"No valid"):
            MODULE.extract_dataset("2024-01-01","2024-01-01",searcher=lambda *_:[],opener=lambda _:FakeRaster())

if __name__ == "__main__": unittest.main()
