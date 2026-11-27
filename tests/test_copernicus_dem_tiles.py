import importlib.util
import unittest
from unittest.mock import patch
from pathlib import Path
import io

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

    def test_invalid_coordinates_are_rejected(self):
        with self.assertRaises(ValueError):
            MODULE.tile_prefix(91, 42)
        with self.assertRaises(ValueError):
            MODULE.tile_prefix(18, 181)

    def test_discovery_selects_primary_dem_from_bucket_listing(self):
        xml = b"""<?xml version="1.0" encoding="UTF-8"?>
        <ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
          <Contents><Key>tile/quality_mask.tif</Key></Contents>
          <Contents><Key>tile/Copernicus_DSM_COG_30_N18_00_E042_00_DEM.tif</Key></Contents>
        </ListBucketResult>"""
        response = io.BytesIO(xml)
        response.__enter__ = lambda: response
        response.__exit__ = lambda *args: None
        with patch.object(MODULE, "_request", return_value=response):
            key = MODULE.discover_tile("tile")
        self.assertEqual(key, "tile/Copernicus_DSM_COG_30_N18_00_E042_00_DEM.tif")

    def test_discovery_reports_missing_tile(self):
        xml = b"""<?xml version="1.0" encoding="UTF-8"?>
        <ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"></ListBucketResult>"""
        response = io.BytesIO(xml)
        response.__enter__ = lambda: response
        response.__exit__ = lambda *args: None
        with patch.object(MODULE, "_request", return_value=response):
            with self.assertRaises(FileNotFoundError):
                MODULE.discover_tile("missing")


if __name__ == "__main__":
    unittest.main()
