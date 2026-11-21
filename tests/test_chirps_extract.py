import datetime as dt
import unittest
from unittest.mock import patch

from scripts.chirps_extract import CITIES, date_range, file_url, build_dataset


class ChirpsExtractTests(unittest.TestCase):
    def test_city_registry_has_saudi_coordinates(self):
        self.assertGreaterEqual(len(CITIES), 13)
        for city in CITIES.values():
            self.assertGreaterEqual(city["lat"], 16)
            self.assertLessEqual(city["lat"], 33)
            self.assertGreaterEqual(city["lon"], 34)
            self.assertLessEqual(city["lon"], 56)

    def test_url_uses_documented_daily_sat_final_pattern(self):
        self.assertEqual(
            file_url(dt.date(2026, 1, 2), "sat"),
            "https://data.chc.ucsb.edu/products/CHIRPS/v3.0/daily/final/sat/2026/chirps-v3.0.sat.2026.01.02.tif",
        )
        self.assertEqual(
            file_url(dt.date(2026, 1, 2), "rnl"),
            "https://data.chc.ucsb.edu/products/CHIRPS/v3.0/daily/final/rnl/2026/chirps-v3.0.rnl.2026.01.02.tif",
        )
        with self.assertRaises(ValueError):
            file_url(dt.date(2026, 1, 2), "other")

    def test_date_range_rejects_future_and_large_ranges(self):
        with self.assertRaises(ValueError):
            date_range("2026-01-01", "2026-01-20", max_days=14)
        with self.assertRaises(ValueError):
            date_range("2099-01-01", "2099-01-01")

    def test_build_dataset_records_values_and_provenance(self):
        days = [dt.date(2026, 1, 1)]
        def fake_download(url, path):
            path.write_bytes(b"fake raster")
        def fake_extract(path):
            return {key: 2.5 for key in CITIES}
        calls = []
        def recording_download(url, path):
            calls.append(url)
            fake_download(url, path)
        result = build_dataset(days, recording_download, fake_extract)
        self.assertEqual(result["schema_version"], 1)
        self.assertEqual(result["units"], "mm/day")
        self.assertIn("not city-area mean", result["spatial_sampling"])
        self.assertEqual(len(calls), 2, "both SAT and RNL are extracted")
        self.assertIn("/sat/", calls[0])
        self.assertIn("/rnl/", calls[1])
        self.assertEqual(result["series"]["sat"]["abha"][0]["precipitation_mm"], 2.5)
        self.assertEqual(result["series"]["rnl"]["abha"][0]["precipitation_mm"], 2.5)
        self.assertEqual(result["series"]["sat"]["abha"][0]["date"], "2026-01-01")


if __name__ == "__main__":
    unittest.main()
