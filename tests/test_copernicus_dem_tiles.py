import importlib.util
import unittest
from unittest.mock import patch
from pathlib import Path
import io
import tempfile

SPEC = importlib.util.spec_from_file_location(
    "copernicus_dem_tiles", "scripts/copernicus_dem_tiles.py"
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class TileNamingTests(unittest.TestCase):
    def test_asir_tile_prefix_uses_arc_second_code_and_degree_cell(self):
        self.assertEqual(
            MODULE.tile_prefix(18.2, 42.5),
            "Copernicus_DSM_COG_30_N18_00_E042_00_DEM",
        )

    def test_abha_tile_is_n18_e042(self):
        self.assertEqual(
            MODULE.tile_prefix(18.2164, 42.5053),
            "Copernicus_DSM_COG_30_N18_00_E042_00_DEM",
        )

    def test_negative_coordinates_use_south_west_and_floor(self):
        self.assertEqual(
            MODULE.tile_prefix(-18.2, -42.5),
            "Copernicus_DSM_COG_30_S19_00_W043_00_DEM",
        )

    def test_outer_coordinate_bounds_are_clamped_to_last_cell(self):
        self.assertEqual(MODULE.tile_prefix(90, 180),
                         "Copernicus_DSM_COG_30_N89_00_E179_00_DEM")
        self.assertEqual(MODULE.tile_prefix(-90, -180),
                         "Copernicus_DSM_COG_30_S90_00_W180_00_DEM")

    def test_canonical_cog_key_is_inside_tile_folder(self):
        prefix = MODULE.tile_prefix(18.2, 42.5)
        self.assertEqual(
            MODULE.tile_object_key(prefix),
            prefix + "/" + prefix + ".tif",
        )
        with self.assertRaises(ValueError):
            MODULE.tile_object_key("not-a-dem-tile")

    def test_invalid_coordinates_are_rejected(self):
        with self.assertRaises(ValueError):
            MODULE.tile_prefix(91, 42)
        with self.assertRaises(ValueError):
            MODULE.tile_prefix(18, 181)

    def test_discovery_selects_primary_dem_from_bucket_listing(self):
        xml = b"""<?xml version="1.0" encoding="UTF-8"?>
        <ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
          <Contents><Key>tile/quality_mask.tif</Key></Contents>
          <Contents><Key>Copernicus_DSM_COG_30_N18_00_E042_00_DEM/Copernicus_DSM_COG_30_N18_00_E042_00_DEM.tif</Key></Contents>
        </ListBucketResult>"""
        class Response:
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self): return xml
        with patch.object(MODULE, "_request", return_value=Response()):
            key = MODULE.discover_tile("Copernicus_DSM_COG_30_N18_00_E042_00_DEM")
        self.assertEqual(key, "Copernicus_DSM_COG_30_N18_00_E042_00_DEM/Copernicus_DSM_COG_30_N18_00_E042_00_DEM.tif")

    def test_discovery_reports_missing_tile(self):
        xml = b"""<?xml version="1.0" encoding="UTF-8"?>
        <ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"></ListBucketResult>"""
        class Response:
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self): return xml
        with patch.object(MODULE, "_request", return_value=Response()):
            with self.assertRaises(FileNotFoundError):
                MODULE.discover_tile("Copernicus_DSM_COG_30_N18_00_E042_00_DEM")


class DownloadIntegrityTests(unittest.TestCase):
    class Response:
        def __init__(self, payload, content_length=None):
            self.stream = io.BytesIO(payload)
            self.headers = {}
            if content_length is not None:
                self.headers["Content-Length"] = str(content_length)
        def __enter__(self): return self
        def __exit__(self, *args): return False
        def read(self, size=-1): return self.stream.read(size)

    def test_download_accepts_tiff_and_returns_size_and_sha256(self):
        import hashlib
        payload = b"II*\x00" + b"dem-raster-payload"
        with tempfile.TemporaryDirectory() as folder:
            destination = Path(folder) / "tile.tif"
            with patch.object(MODULE, "_request", return_value=self.Response(payload, len(payload))):
                size, digest = MODULE.download_object("tile/tile.tif", destination)
            self.assertEqual(size, len(payload))
            self.assertEqual(digest, hashlib.sha256(payload).hexdigest())
            self.assertEqual(destination.read_bytes(), payload)
            self.assertFalse(destination.with_suffix(".tif.part").exists())

    def test_download_rejects_non_tiff_response_and_removes_partial_file(self):
        with tempfile.TemporaryDirectory() as folder:
            destination = Path(folder) / "tile.tif"
            with patch.object(MODULE, "_request", return_value=self.Response(b"<Error>not a TIFF</Error>")):
                with self.assertRaisesRegex(IOError, "TIFF/BigTIFF signature"):
                    MODULE.download_object("tile/tile.tif", destination)
            self.assertFalse(destination.exists())
            self.assertFalse(destination.with_suffix(".tif.part").exists())

    def test_download_rejects_content_length_mismatch(self):
        payload = b"II*\x00" + b"payload"
        with tempfile.TemporaryDirectory() as folder:
            destination = Path(folder) / "tile.tif"
            with patch.object(MODULE, "_request", return_value=self.Response(payload, len(payload) + 10)):
                with self.assertRaisesRegex(IOError, "size mismatch"):
                    MODULE.download_object("tile/tile.tif", destination)
            self.assertFalse(destination.exists())


if __name__ == "__main__":
    unittest.main()
