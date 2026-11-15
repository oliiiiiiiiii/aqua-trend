import unittest
from unittest.mock import patch

from server.catalogue import Catalogue
from server.errors import ResearchError
from server.evidence import METHOD_VERSION
from server.science import analyze_series
from server.spatial import SpatialTrends


class SpatialTrendTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cat = Catalogue()
        cls.maps = SpatialTrends(cls.cat)

    def snapshot(self, rid, vid, pid, start, end):
        period = {"start": start, "end": end}
        series = self.cat.product_series(rid, pid, vid)
        variable = analyze_series(series, self.cat.baselines[series["baseline_ref"]], period)
        variable.update(variable_id=vid, product={"selected_product_id": pid})
        return {"identity": {"id": "test-study", "versions": {**self.cat.versions, "method_policy_version": METHOD_VERSION}},
                "resolved": {"region_id": rid, "region_name": self.cat.regions[rid]["name"]}, "variables": [variable]}

    def test_layer_uses_the_study_product_window_and_seasonal_reference(self):
        rid, vid, pid = "b3-4030015090", "precip", "p_imerg"
        slopes = []
        for start in ("2005-01", "2015-01"):
            study = self.snapshot(rid, vid, pid, start, "2024-12")
            response = self.maps.for_study(study, vid)
            peer = next(row for row in response["regions"] if row["region_id"] == rid)
            slope = study["variables"][0]["trend"]["slope_per_decade"]
            self.assertEqual(peer["slope_per_decade"], slope)
            self.assertEqual(response["selected"]["slope_per_decade"], slope)
            self.assertEqual(response["period"], {"start": start, "end": "2024-12"})
            self.assertEqual(response["product_id"], pid)
            self.assertLess(len(response["regions"]), response["total_regions"])
            self.assertEqual({self.cat.regions[r["region_id"]]["type"] for r in response["regions"]}, {"basin3"})
            slopes.append(slope)
        self.assertNotEqual(*slopes)
        with patch.object(self.cat, "product_series", side_effect=AssertionError("Expected cached regional fits")):
            self.assertEqual(self.maps.for_study(study, vid), response)

    def test_marine_peers_and_saved_snapshot_when_release_changes(self):
        cid = next(r["id"] for r in self.cat.regions.values() if r["type"] == "lme" and "sst" in r["product_ids"])
        study = self.snapshot(cid, "sst", "sst", "2015-01", "2024-12")
        response = self.maps.for_study(study, "sst")
        self.assertEqual(response["layer"], "lme")
        self.assertGreater(len(response["regions"]), 1)
        study["identity"]["versions"]["dataset_version"] = "earlier-release"
        previous = self.maps.for_study(study, "sst")
        self.assertEqual(previous["selected"], response["selected"])
        self.assertEqual(previous["regions"], [])
        self.assertTrue(previous["reason"])
        with self.assertRaises(ResearchError):
            self.maps.for_study(study, "tair")

    def test_missing_snapshot_fields_return_an_unavailable_layer(self):
        study = self.snapshot("b3-4030015090", "precip", "p_imerg", "2015-01", "2024-12")
        variable = study["variables"][0]
        for field in ("baseline", "product", "analysis_period"):
            with self.subTest(field=field):
                partial = {**study, "variables": [{k: v for k, v in variable.items() if k != field}]}
                result = self.maps.for_study(partial, "precip")
                self.assertEqual(result["regions"], [])
                self.assertTrue(result["reason"])
                self.assertEqual(result["selected"]["slope_per_decade"], variable["trend"]["slope_per_decade"])
        partial = {**study, "variables": [{**variable, "unit": None, "trend": None}]}
        result = self.maps.for_study(partial, "precip")
        self.assertEqual(result["unit"], "")
        self.assertTrue(result["reason"])
