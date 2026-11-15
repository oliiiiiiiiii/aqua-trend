"""Small local regressions; no Earthdata credentials, requests, or raw archives needed."""
import contextlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parent))
import numpy as np
import build_manifest
import earthdata_layers
import fetch_earthdata
import merge_series
import regions
import share_firms
import share_so2


class ThreeRegions:
    ids = ["r0", "r1", "r2"]
    total_w = np.ones(3)

    def __init__(self):
        assignment = np.full(360 * 720, -1)
        assignment[:3] = [0, 1, 2]
        self._parts = [("flat", 0, assignment, 3)]


class PipelineTests(unittest.TestCase):
    def test_missing_ceres_input_uses_normal_no_input_path(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(earthdata_layers, "SHARE", folder):
            self.assertEqual(list(earthdata_layers.ceres_layer("sfc_net_tot_all_mon")()), [])

    def test_so2_missing_sources_do_not_become_zero_or_partial_totals(self):
        emissions = np.ma.masked_invalid([[2, np.nan, 0, np.nan], [3, 4, 0, np.nan], [7, 8, 0, 9]])
        result = share_so2.annual_region_totals(
            ThreeRegions(), emissions, [-89.75] * 3, [-179.75, -179.75, -179.25])
        np.testing.assert_equal(result[0], [5, np.nan, 0, np.nan])
        np.testing.assert_equal(result[1], [7, 8, 0, 9])
        self.assertTrue(np.isnan(result[2]).all())

    def test_empty_firms_archive_is_unknown(self):
        with tempfile.TemporaryDirectory() as folder:
            file = Path(folder, "modis_2024_all_countries.zip")
            with zipfile.ZipFile(file, "w"):
                pass
            _, grid, stats = share_firms.parse_zip((str(file), ["Terra"]))
            self.assertTrue(np.isnan(grid).all())
            self.assertEqual(stats["mindate"], "9999")
            self.assertTrue(np.isnan(share_firms.monthly_region_counts(ThreeRegions(), grid)).all())

    def test_firms_zero_detections_and_missing_satellite_months_differ(self):
        header = "latitude,longitude,acq_date,acq_time,satellite,type\n"
        rows = (
            "-89.75,-179.75,2024-01-01,1200,Terra,0\n"
            "-89.75,-179.75,2024-01-31,1300,Terra,0\n"
            "-89.75,-179.75,2024-02-01,1200,Aqua,0\n"
            "-89.75,-179.75,2024-03-31,1200,Terra,1\n"
            "-89.75,-179.75,2024-04-30,1200,Aqua,0\n")
        with tempfile.TemporaryDirectory() as folder:
            file = Path(folder, "modis_2024_all_countries.zip")
            with zipfile.ZipFile(file, "w") as archive:
                archive.writestr("country_a.csv", header + rows)
                archive.writestr("country_b.csv", header + rows)
                archive.writestr("empty.csv", header)
            _, grid, stats = share_firms.parse_zip((str(file), ["Terra"]))
            result = share_firms.monthly_region_counts(ThreeRegions(), grid)
            np.testing.assert_equal(result[:, 0], [2, 0, 0])
            self.assertTrue(np.isnan(result[:, 1]).all())
            np.testing.assert_equal(result[:, 2], [0, 0, 0])
            self.assertTrue(np.isnan(result[:, 3]).all())
            self.assertEqual(stats["maxdate"], "2024-03-31")

    def test_missing_fire_type_is_not_assumed_vegetation(self):
        with tempfile.TemporaryDirectory() as folder:
            file = Path(folder, "modis_2024_all_countries.zip")
            with zipfile.ZipFile(file, "w") as archive:
                archive.writestr("unknown.csv", "latitude,longitude,acq_date,acq_time,satellite\n")
            with self.assertRaisesRegex(ValueError, "missing type column"):
                share_firms.parse_zip((str(file), ["Terra"]))

    def test_firms_partial_boundaries_and_leap_year(self):
        self.assertEqual(share_firms.archive_months("2024-01-20", "2024-03-30"), ["2024-02"])
        self.assertEqual(share_firms.archive_months("2024-01-01", "2024-02-28"), ["2024-01"])
        self.assertEqual(share_firms.archive_months("2024-12-20", "2025-02-28"), ["2025-01", "2025-02"])

    def test_no_firms_files_has_actionable_error(self):
        with tempfile.TemporaryDirectory() as folder:
            result = subprocess.run([sys.executable, "-I", str(Path(share_firms.__file__)), folder],
                                    capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("No FIRMS archives found", result.stderr)
        self.assertNotIn("Traceback", result.stderr)

    def test_merge_preserves_temporal_provenance_and_month_gaps(self):
        with tempfile.TemporaryDirectory() as folder:
            data = Path(folder, "public"); layers = Path(folder, "layers")
            Path(data, "catalog").mkdir(parents=True); Path(data, "series").mkdir()
            Path(data, "catalog/variables.json").write_text(json.dumps({"layers": {}, "category_default_layer": {}}))
            Path(data, "catalog/series_index.json").write_text(json.dumps({"regions": {}}))
            meta = {"name": "Annual fixture", "category": "so2", "unit": "kt/yr", "temporal_resolution": "annual",
                    "temporal": "repeated for display", "missing_policy": "all sources required", "source_files": ["fixture.nc"]}
            with patch.object(regions, "LAYER_DIR", str(layers)), \
                 patch.object(merge_series, "LAYER_DIR", str(layers)), \
                 patch.object(merge_series, "DATA", str(data)):
                regions.save_layer("annual_fixture", ThreeRegions(), ["2020-01", "2020-03"],
                                   np.array([[2, 4], [np.nan, np.nan], [np.nan, np.nan]]), meta)
                merge_series.main(["annual_fixture"])
            exported = json.loads(Path(data, "catalog/variables.json").read_text())
            entry = exported["layers"]["annual_fixture"]
            self.assertEqual(entry["temporal_resolution"], "annual")
            self.assertEqual(entry["missing_policy"], "all sources required")
            self.assertEqual(entry["source_files"], ["fixture.nc"])
            series = json.loads(Path(data, "series/r0.json").read_text())["layers"]["annual_fixture"]
            self.assertEqual(series, {"start": "2020-01", "values": [2.0, None, 4.0]})

    def test_reprocessed_merra_file_wins_for_duplicate_month(self):
        with tempfile.TemporaryDirectory() as folder:
            for stream in ["400", "401"]:
                Path(folder, f"MERRA2_{stream}.tavgM_2d_lnd_Nx.202107.subset.nc4").touch()
            with patch.object(earthdata_layers, "SHARE", folder):
                result = earthdata_layers.monthly_files("", "*.nc4", earthdata_layers.ym_merra)
            self.assertEqual(len(result), 1)
            self.assertIn("MERRA2_401", result[0][1])

    def test_redirects_only_forward_auth_to_nasa_https(self):
        request = urllib.request.Request("https://opendap.earthdata.nasa.gov/data",
                                         headers={"Authorization": "Bearer test-placeholder"})
        handler = fetch_earthdata.KeepAuth()
        for url in ["https://example.com/data", "https://nasa.gov.example.com/data"]:
            redirected = handler.redirect_request(request, None, 302, "Found", {}, url)
            self.assertFalse(redirected.has_header("Authorization"))
        trusted = handler.redirect_request(request, None, 302, "Found", {}, "https://urs.earthdata.nasa.gov/data")
        self.assertTrue(trusted.has_header("Authorization"))
        with self.assertRaises(urllib.error.URLError):
            handler.redirect_request(request, None, 302, "Found", {}, "http://example.com/data")


class ManifestTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.data = self.root / "web/public/data"
        (self.data / "catalog").mkdir(parents=True)
        (self.data / "series").mkdir()
        (self.root / "data/masks").mkdir(parents=True)
        (self.root / "data/masks/regions_0p5.npz").write_bytes(b"fixture mask identity")
        self.layers = {
            "precip": {"temporal_resolution": "monthly"},
            "so2_emis": {"temporal_resolution": "annual", "caveat": "Legacy missing-value limitation"},
            "fire_count": {"temporal_resolution": "monthly", "caveat": "Zero detections do not establish no fire"},
        }
        self.index = {"regions": {"r0": list(self.layers)}}
        self.doc = {"id": "r0", "version": "series-2", "layers": {
            key: {"start": "2020-01", "values": [0, None, 2.5]} for key in self.layers}}
        self.write("catalog/variables.json", {"layers": self.layers})
        self.write("catalog/series_index.json", self.index)
        self.write("series/r0.json", self.doc)

    def write(self, relative, value):
        (self.data / relative).write_text(json.dumps(value))

    def run_manifest(self):
        with patch.object(build_manifest, "REPO", str(self.root)), \
                patch.object(build_manifest, "DATA", str(self.data)), contextlib.redirect_stdout(io.StringIO()):
            code = build_manifest.main("test-release")
        manifest = json.loads((self.data / "catalog/manifest.json").read_text())
        return code, manifest, {entry["asset"]: entry for entry in manifest["asset_status"]}

    def test_ready_annual_asset_preserves_caveat_and_excludes_monthly_analysis(self):
        (self.data / "series/.DS_Store").write_bytes(b"ignored sidecar")
        code, manifest, assets = self.run_manifest()
        self.assertEqual(code, 0)
        self.assertEqual(manifest["n_series_files"], 1)
        annual = assets["layer:so2_emis"]
        self.assertEqual(annual["status"], "ready")
        self.assertEqual(annual["temporal_resolution"], "annual")
        self.assertEqual(annual["caveat"], "Legacy missing-value limitation")
        self.assertFalse(annual["analysis_eligibility"]["monthly"])
        self.assertTrue(assets["layer:precip"]["analysis_eligibility"]["monthly"])
        self.assertEqual(assets["layer:fire_count"]["quality_policy"]["kind"], "point_product")
        self.assertEqual(manifest["baselines"]["status"], "query_time")
        del self.layers["so2_emis"]["temporal_resolution"]
        self.write("catalog/variables.json", {"layers": self.layers})
        self.assertFalse(self.run_manifest()[2]["layer:so2_emis"]["analysis_eligibility"]["monthly"])

    def test_missing_indexed_file_invalidates_an_otherwise_delivered_layer(self):
        self.index["regions"]["r1"] = ["precip"]
        self.write("catalog/series_index.json", self.index)
        code, _, assets = self.run_manifest()
        self.assertEqual(code, 1)
        self.assertEqual(assets["series:r1"]["status"], "invalid")
        self.assertEqual(assets["layer:precip"]["status"], "invalid")

    def test_unknown_layer_is_reported_even_with_a_matching_index(self):
        self.index["regions"]["r0"].append("unknown")
        self.doc["layers"]["unknown"] = {"start": "2020-01", "values": [1]}
        self.write("catalog/series_index.json", self.index)
        self.write("series/r0.json", self.doc)
        code, _, assets = self.run_manifest()
        self.assertEqual(code, 1)
        self.assertEqual(assets["layer:unknown"]["status"], "invalid")

    def test_booleans_and_nonfinite_values_are_invalid(self):
        for value in [True, False, float("nan"), float("inf"), float("-inf")]:
            with self.subTest(value=value):
                self.doc["layers"]["precip"]["values"] = [value]
                self.write("series/r0.json", self.doc)
                code, _, assets = self.run_manifest()
                self.assertEqual(code, 1)
                self.assertEqual(assets["layer:precip"]["status"], "invalid")
        text = json.dumps(self.doc).replace("-Infinity", "1e999")
        (self.data / "series/r0.json").write_text(text)
        self.assertEqual(self.run_manifest()[0], 1)

    def test_malformed_json_and_shapes_are_asset_errors_not_crashes(self):
        for text in ['{', '[]', '{"id":"r0","version":"series-2","layers":{"precip":null}}']:
            with self.subTest(text=text):
                (self.data / "series/r0.json").write_text(text)
                code, _, assets = self.run_manifest()
                self.assertEqual(code, 1)
                self.assertEqual(assets["layer:precip"]["status"], "invalid")
        (self.data / "catalog/variables.json").write_text('{')
        self.assertEqual(self.run_manifest()[2]["variables"]["status"], "invalid")

    def test_bad_index_entries_are_reported_without_sorting_invalid_types(self):
        for entry in [["precip", None], "precip", ["precip", "precip"]]:
            with self.subTest(entry=entry):
                self.write("catalog/series_index.json", {"regions": {"r0": entry}})
                code, _, assets = self.run_manifest()
                self.assertEqual(code, 1)
                self.assertEqual(assets["series_index"]["status"], "invalid")


if __name__ == "__main__":
    unittest.main(verbosity=2)
