import importlib.util
import unittest

SPEC = importlib.util.spec_from_file_location(
    "inspect_copernicus_dem", "scripts/inspect_copernicus_dem.py"
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def metadata(**overrides):
    value = {
        "width": 1200,
        "height": 1200,
        "count": 1,
        "crs": "EPSG:4326",
        "bounds": {"left": 42, "bottom": 18, "right": 43, "top": 19},
        "transform": (1 / 1200, 0, 42, 0, -1 / 1200, 19, 0, 0, 1),
        "dtype": "float32",
        "nodata": -32767.0,
    }
    value.update(overrides)
    return value


class RasterMetadataTests(unittest.TestCase):
    def test_accepts_valid_glo90_geographic_tile_metadata(self):
        result = MODULE.validate_metadata(metadata())
        self.assertEqual(result["crs"], "EPSG:4326")
        self.assertEqual(result["width"], 1200)
        self.assertAlmostEqual(result["pixel_size_degrees"][0], 1 / 1200)

    def test_rejects_missing_crs(self):
        with self.assertRaisesRegex(ValueError, "CRS"):
            MODULE.validate_metadata(metadata(crs=None))

    def test_rejects_wrong_crs_until_explicit_reprojection(self):
        with self.assertRaisesRegex(ValueError, "EPSG:4326"):
            MODULE.validate_metadata(metadata(crs="EPSG:32638"))

    def test_rejects_missing_or_nonfinite_nodata(self):
        with self.assertRaisesRegex(ValueError, "NoData"):
            MODULE.validate_metadata(metadata(nodata=None))
        with self.assertRaisesRegex(ValueError, "NoData"):
            MODULE.validate_metadata(metadata(nodata=float("nan")))

    def test_rejects_invalid_dimensions_band_count_and_transform(self):
        with self.assertRaisesRegex(ValueError, "dimensions"):
            MODULE.validate_metadata(metadata(width=10))
        with self.assertRaisesRegex(ValueError, "one elevation band"):
            MODULE.validate_metadata(metadata(count=3))
        with self.assertRaisesRegex(ValueError, "north-up"):
            MODULE.validate_metadata(metadata(transform=(1, -1, 0, 19, 0, 1)))

    def test_rejects_invalid_bounds(self):
        with self.assertRaisesRegex(ValueError, "bounds"):
            MODULE.validate_metadata(metadata(bounds={
                "left": 43, "bottom": 18, "right": 42, "top": 19
            }))
        with self.assertRaisesRegex(ValueError, "longitude/latitude"):
            MODULE.validate_metadata(metadata(bounds={
                "left": 181, "bottom": 18, "right": 182, "top": 19
            }))

    def test_rejects_rotated_grid_and_transform_bounds_mismatch(self):
        with self.assertRaisesRegex(ValueError, "skewed"):
            MODULE.validate_metadata(metadata(transform=(
                1 / 1200, 0.0001, 42, 0, -1 / 1200, 19, 0, 0, 1
            )))
        with self.assertRaisesRegex(ValueError, "do not match"):
            MODULE.validate_metadata(metadata(bounds={
                "left": 42.1, "bottom": 18, "right": 43, "top": 19
            }))


if __name__ == "__main__":
    unittest.main()
