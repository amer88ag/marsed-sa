import datetime as dt
import unittest
from unittest.mock import MagicMock, patch
import urllib.error

from scripts.chirps_extract import CITIES, date_range, file_url, build_dataset, clean_precipitation, download


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

    def test_invalid_precipitation_values_become_missing(self):
        self.assertIsNone(clean_precipitation(-9999))
        self.assertIsNone(clean_precipitation(float("nan")))
        self.assertIsNone(clean_precipitation(float("inf")))
        self.assertIsNone(clean_precipitation(None))
        self.assertEqual(clean_precipitation(0), 0.0)
        self.assertEqual(clean_precipitation(1.236), 1.24)

    def test_all_missing_product_is_rejected(self):
        days = [dt.date(2026, 1, 1)]
        def fake_download(url, path):
            path.write_bytes(b"fake raster")
        def missing_values(path):
            return {key: None for key in CITIES}
        with self.assertRaisesRegex(RuntimeError, "No valid SAT pixels"):
            build_dataset(days, fake_download, missing_values)

    def test_download_retries_rate_limit_with_backoff(self):
        response = MagicMock()
        response.__enter__.return_value = response
        response.__exit__.return_value = False
        response.read.side_effect = [b"raster", b""]
        rate_limit = urllib.error.HTTPError(
            "https://example.test/data.tif", 429, "Too Many Requests",
            {"Retry-After": "2"}, None
        )
        with patch("scripts.chirps_extract.urllib.request.urlopen", side_effect=[rate_limit, response]) as open_url, \
             patch("scripts.chirps_extract.time.sleep") as sleep:
            from pathlib import Path
            import tempfile
            with tempfile.TemporaryDirectory() as folder:
                target = Path(folder) / "sample.tif"
                download("https://example.test/data.tif", target, max_attempts=2)
                self.assertEqual(target.read_bytes(), b"raster")
            self.assertEqual(open_url.call_count, 2)
            sleep.assert_any_call(2)


    def test_download_retries_network_timeout_and_cleans_partial_file(self):
        from pathlib import Path
        import tempfile
        response = MagicMock()
        response.__enter__.return_value = response
        response.__exit__.return_value = False
        response.read.side_effect = [b"raster", b""]
        with patch("scripts.chirps_extract.urllib.request.urlopen", side_effect=[TimeoutError("socket timed out"), response]) as open_url, \
             patch("scripts.chirps_extract.time.sleep") as sleep:
            with tempfile.TemporaryDirectory() as folder:
                target = Path(folder) / "sample.tif"
                target.write_bytes(b"partial previous attempt")
                download("https://example.test/data.tif", target, max_attempts=2)
                self.assertEqual(target.read_bytes(), b"raster")
            self.assertEqual(open_url.call_count, 2)
            sleep.assert_any_call(2)

    def test_download_retries_url_error(self):
        from pathlib import Path
        import tempfile
        response = MagicMock()
        response.__enter__.return_value = response
        response.__exit__.return_value = False
        response.read.side_effect = [b"raster", b""]
        failure = urllib.error.URLError("temporary DNS failure")
        with patch("scripts.chirps_extract.urllib.request.urlopen", side_effect=[failure, response]) as open_url, \
             patch("scripts.chirps_extract.time.sleep"):
            with tempfile.TemporaryDirectory() as folder:
                target = Path(folder) / "sample.tif"
                download("https://example.test/data.tif", target, max_attempts=2)
                self.assertEqual(target.read_bytes(), b"raster")
            self.assertEqual(open_url.call_count, 2)

if __name__ == "__main__":
    unittest.main()
