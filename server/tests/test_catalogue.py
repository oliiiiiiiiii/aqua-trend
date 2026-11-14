"""Contract checks for the research catalogue, isolated model and prepared assets."""
import copy
import io
import json
import os
from pathlib import Path
import shutil
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from urllib.error import URLError

from server.catalogue import Catalogue, DATA, SelectorError

TAIWAN = "named-taiwan-main-island"
PERIOD = {"start": "2003-01", "end": "2020-12"}


class SelectionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with patch.dict(os.environ, {"AQUA_SELECTOR_MODEL":"", "AQUA_SELECTOR_URL":""}):
            cls.cat = Catalogue()

    def test_reviewed_plans_and_quantities_have_valid_sources(self):
        for alias, pid in self.cat.aliases.items():
            with self.subTest(alias=alias):
                plan = self.cat.select(alias)
                self.assertEqual(plan["phenomenon_id"], pid)
                self.assertEqual(plan["selection_source"], "curated_plan")
                for row in plan["variable_set"]:
                    self.assertEqual(row["reason"], self.cat.links[row["catalogue_ref"]]["reason"])
                    self.assertTrue(all(ref["url"].startswith("https://") for ref in row["scientific_refs"]))
                    self.assertIn(row["role"], ("core_indicator","related_condition","response"))
                self.assertNotIn("region_id",plan)
                self.assertNotIn("period",plan)
        self.assertEqual(self.cat.select("  Drought ")["content_hash"], self.cat.select("DROUGHT")["content_hash"])
        self.assertEqual(self.cat.select("海洋熱浪")["status"], "partial")
        self.assertEqual(self.cat.select("sea surface temperature")["variable_set"][0]["variable_id"], "sst")

    def test_unconfigured_provider_does_not_substitute_keyword_matches(self):
        for text in ("drought in Europe during 2022", "乾旱和海洋升溫", "earthquake recurrence"):
            with self.subTest(text=text), self.assertRaises(SelectorError) as caught:
                self.cat.select(text)
            self.assertEqual(caught.exception.code, "selector_unavailable")
            self.assertTrue(caught.exception.retryable)

    def test_out_of_catalogue_output_and_side_effects_are_rejected(self):
        good = self.cat.plans["drought"]
        for mutation in ({"region_id":"foo"},{"new_formula":"x"},{"phenomenon_id":"__import__"},
                         {"variable_set":[{"variable_id":"fish","role":"response","catalogue_ref":"concept:sst"}]},
                         {"indicator_recipe_ids":["new-definition"]},{"indicator_recipe_ids":["recorded-flood"]},
                         {"variable_set":[{**good["variable_set"][0],"reason":"run code"}]},
                         {"variable_set":[{**good["variable_set"][0],"role":"response"}]},
                         {"limitation_refs":["new-claim"]}):
            with self.subTest(mutation=mutation), self.assertRaises(SelectorError):
                self.cat.validate_selection({**good, **mutation})

    def test_configured_provider_processes_arbitrary_prose(self):
        cat = self.cat
        model_plan = {"phenomenon":"Near-surface thermal conditions","phenomenon_id":"thermal-conditions",
                      "status":"ok","variable_set":[{"variable_id":"tair","role":"core_indicator","catalogue_ref":"concept:tair"}],
                      "indicator_recipe_ids":[],"limitation_refs":[]}
        body = json.dumps({"choices":[{"message":{"content":json.dumps(model_plan)}}]}).encode()
        text = "How did the temperature of the air change in Alaska after 2015?"
        with patch.object(cat, "model", "fixture-model-1"), patch.object(cat, "model_url","http://localhost/fixture"), patch(
                "server.catalogue.urlopen", side_effect=[io.BytesIO(body),io.BytesIO(body)]) as send:
            first, second = cat.select(text), cat.select(text,reselect=True)
            request = json.loads(send.call_args.args[0].data)
        self.assertEqual(request["messages"][-1]["content"], text)
        self.assertEqual(first["model_version"], "fixture-model-1")
        self.assertEqual(first["selection_source"], "model")
        self.assertEqual(first["content_hash"], second["content_hash"])
        self.assertNotEqual(first["selection_plan_id"], second["selection_plan_id"])
        self.assertEqual(first["variable_set"][0]["variable_id"], "tair")
        self.assertNotIn("period",first)
        self.assertNotIn("region_id",first)

    def test_explicit_unsupported_plan_and_service_errors(self):
        unsupported = {"phenomenon":"Stellar winds","phenomenon_id":"stellar-winds","status":"unsupported",
                       "variable_set":[],"indicator_recipe_ids":[],"limitation_refs":[]}
        self.assertEqual(self.cat.validate_selection(unsupported)["status"], "unsupported")
        with patch.object(self.cat, "model", "fixture"), patch.object(self.cat, "model_url","http://localhost/fixture"):
            for failure, code in [(URLError("fixture: offline"), "selector_unavailable"), (io.BytesIO(b'{}'), "invalid_selector_output")]:
                options = {"side_effect":failure} if isinstance(failure,Exception) else {"return_value":failure}
                with patch("server.catalogue.urlopen", **options), self.assertRaises(SelectorError) as caught:
                    self.cat.select("any test query")
                self.assertEqual(caught.exception.code, code)


class RealReleaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cat = Catalogue()

    def test_release_index_maps_existing_region_geometry(self):
        self.assertEqual(len(self.cat.products), 26)
        self.assertEqual(len(self.cat.regions), 7641)
        self.assertEqual(len(self.cat.index), 1706)
        self.assertEqual(self.cat.regions[TAIWAN]["name"], "Taiwan main island (coastline)")
        self.assertTrue(self.cat.regions[TAIWAN]["geometry_ref"].endswith("named.geojson#"+TAIWAN))
        hexagon = next(r for r in self.cat.regions.values() if r["type"]=="hex")
        self.assertFalse(hexagon["series_available"])
        decision, series = self.cat.resolve(hexagon["id"], "precip", PERIOD)
        self.assertIsNone(series)
        self.assertEqual(decision["status"], "data_required")
        self.assertEqual(decision["region_id"],hexagon["id"])

    def test_region_with_only_nearby_legacy_topsoil_does_not_substitute_cell(self):
        counts = self.cat.spatial["gldas10_in_boundary_land_cells"]
        rid = next(r for r,n in counts.items() if n==0)
        decision, series = self.cat.resolve(rid,"soil_top",PERIOD)
        self.assertIsNone(series)
        self.assertNotIn("g1_soil_top",self.cat.regions[rid]["product_ids"])
        self.assertIn("in-boundary",decision["reason"])

    def test_real_source_priority_and_exact_values(self):
        decision, series = self.cat.resolve(TAIWAN, "precip", PERIOD)
        source = json.loads((DATA/"series"/(TAIWAN+".json")).read_bytes())["layers"]
        self.assertEqual(decision["selected_product_id"],"p_imerg")
        self.assertFalse(decision["fallback"])
        self.assertEqual(series["values"],source["p_imerg"]["values"])
        later, longer = self.cat.resolve(TAIWAN,"precip",PERIOD,["spi-3","spi-6","spi-12"])
        self.assertTrue(later["fallback"])
        self.assertEqual(later["priority_rank"],2)
        self.assertEqual(later["selected_product_id"],"p_gpcp")
        self.assertIn("SPI calibration",later["fallback_reason"])
        self.assertEqual(longer["values"],source["p_gpcp"]["values"])
        self.assertIsNotNone(longer["spatial_coverage"]["mean_valid_area_fraction"])

    def test_ocean_mass_is_outside_the_terrestrial_quantity(self):
        decision, series = self.cat.resolve("sea-NPO","tws",PERIOD)
        self.assertIsNone(series)
        self.assertIn("terrestrial",decision["reason"])
        self.assertNotIn("tws",self.cat.regions["sea-NPO"]["product_ids"])

    def test_unlike_sources_never_replace_each_other(self):
        for a,b in (("tair","tsurf"),("tsurf","lst_day"),("soil_root","soil_total"),("soil_root","soil_wetness"),
                    ("soil_root","soil_top"),("precip","precip_land"),("rn","swdown")):
            with self.subTest(variables=(a,b)):
                self.assertTrue(set(self.cat.concepts[a]["approved_product_ids"]).isdisjoint(
                    self.cat.concepts[b]["approved_product_ids"]))

    def test_partial_period_retains_full_history_nulls_and_actual_extent(self):
        period = {"start":"1980-01","end":"2020-12"}
        dec, s = self.cat.resolve(TAIWAN,"tws",period)
        self.assertEqual(dec["status"],"insufficient_data")
        self.assertEqual(dec["requested_period"],period)
        self.assertEqual(dec["available_period"]["start"],"2002-04")
        gap = s["times"].index("2017-11")
        self.assertIsNone(s["values"][gap])
        self.assertEqual(s["quality_flags"][gap],"missing")
        self.assertEqual(dec["n_valid"],sum(v is not None for t,v in zip(s["times"],s["values"]) if period["start"]<=t<=period["end"]))
        ocean = self.cat.resolve("sea-NPO","sst",PERIOD)[1]
        self.assertEqual(ocean["unit"],"°C")
        self.assertTrue(self.cat.products["sst"]["institution"].startswith("NOAA"))


class IsolatedAssetsTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root/"catalog").mkdir()
        (self.root/"series").mkdir()
        (self.root/"geo").mkdir()
        shutil.copy(DATA/"catalog/variables.json", self.root/"catalog/variables.json")
        self._write("catalog/regions.json", {"regions":[{"id":"r","name":"Test Region","type":"named","surface":"land","area_km2":10000}]})
        self._write("geo/named.geojson", {"type":"FeatureCollection","features":[]})
        self._write("catalog/series_index.json", {"version":"series-2","regions":{"r":["p_imerg","p_gpcp"]}})
        self._write("catalog/series_spatial_support.json", {"source_series_tree":"a7b18e2ed001958a2d5f85b837f5dab88058a6b6",
                    "mean_spatial_fraction":{}, "gldas10_in_boundary_land_cells":{}, "sha256":{}})
        fixture = [float(i%17) for i in range(216)]
        fixture[1] = None
        self.layers = {"p_imerg":{"start":"2003-01","values":fixture}, "p_gpcp":{"start":"2003-01","values":fixture[:]}}

    def _write(self, rel, data):
        (self.root/rel).write_text(json.dumps(data),encoding="utf-8")

    def catalogue(self):
        self._write("series/r.json",{"version":"series-2","id":"r","layers":self.layers})
        return Catalogue(self.root)

    def test_quality_flags_missing_values_and_unsupported_units(self):
        self.layers["p_imerg"]["unit"] = "m/s"
        self.layers["p_gpcp"]["quality_flags"] = ["missing" if x is None else "ok" for x in self.layers["p_gpcp"]["values"]]
        self.layers["p_gpcp"]["quality_flags"][5] = "invalid"
        decision, series = self.catalogue().resolve("r","precip",PERIOD,["spi-3"])
        self.assertEqual(decision["selected_product_id"],"p_gpcp")
        self.assertIn("Prepared unit", decision["fallback_reason"])
        self.assertIn("insufficient_indicator_calibration",decision["quality_flags"])
        self.assertEqual(series["values"][:2],[0.0,None])
        self.assertEqual(series["quality_flags"][5],"invalid")
        self.assertEqual(decision["n_valid"],214)

    def test_invalid_layers_do_not_break_the_study(self):
        for corrupt in ({"calendar":"360_day"},{"values":[True]}, {"times":["2020-01"]}, {"values":[float("nan")]}, {"quality_flags":None}):
            with self.subTest(corrupt=corrupt):
                self.layers["p_imerg"].update(corrupt)
                tool = self.catalogue()
                dec, series = tool.resolve("r","precip",PERIOD)
                self.assertEqual(series["product_id"],"p_gpcp")
                self.assertTrue(dec["fallback"])
                self.layers["p_imerg"] = copy.deepcopy(self.layers["p_gpcp"])

    def test_modified_snapshot_is_visible_in_manifest_and_cannot_be_read(self):
        self.catalogue()
        metadata_path = self.root/"catalog/series_spatial_support.json"
        metadata = json.loads(metadata_path.read_bytes())
        metadata["sha256"]["r"] = "different-snapshot"
        self._write("catalog/series_spatial_support.json", metadata)
        cat = self.catalogue()
        self.assertEqual(cat.asset_status["series:r"]["status"],"invalid")
        self.assertEqual(cat.asset_status["regional_monthly_series"]["status"],"invalid")
        self.assertFalse(cat.regions["r"]["series_available"])
        dec, s = cat.resolve("r","precip",PERIOD)
        self.assertEqual(dec["status"],"invalid_asset")
        self.assertIsNone(s)

    def test_missing_event_file_and_malformed_file_publish_specific_asset_status(self):
        catalog = self.catalogue()
        pending = catalog.event_catalogue("flood","r",PERIOD)
        self.assertEqual(pending["status"],"pending")
        self.assertNotIn("events",pending)
        (self.root/"events").mkdir()
        self._write("events/flood.json", {"catalogue_id":"prepared-flood","events":[]})
        cat = self.catalogue()
        self.assertEqual(cat.asset_status["events:prepared-flood"]["status"],"invalid")
        self.assertEqual(cat.resolve("r","precip",PERIOD)[0]["status"],"ok")

    def test_event_source_priority_uses_coverage_without_combining_catalogues(self):
        cat = self.catalogue()
        interval = {"region_id":"r","phenomenon_id":"flood","completeness":"complete","gaps":[]}
        primary = {**interval,"start":"2003","end":"2020","gaps":[{"start":"2007","end":"2008"}]}
        full_intervals = [{**interval,"start":"2003","end":"2010"}, {**interval,"start":"2011","end":"2020"}]
        cat.events["flood"] = [
            {"catalogue_id":"first","coverage":[primary],"events":[{"event_id":"a","region_ids":["r"]}]},
            {"catalogue_id":"second","coverage":full_intervals,"events":[{"event_id":"b","region_ids":["r"]}]},
        ]
        found = cat.event_catalogue("flood","r",PERIOD)
        self.assertEqual(found["catalogue_id"],"second")
        self.assertEqual(found["priority_rank"],2)
        self.assertEqual([e["event_id"] for e in found["events"]],["b"])
        earlier = cat.event_catalogue("flood","r",{"start":"2003-01","end":"2004-12"})
        self.assertEqual(earlier["catalogue_id"],"first")

    def test_loaded_event_catalogue_keeps_coarse_time_and_source(self):
        (self.root/"events").mkdir()
        coverage = {"region_id":"r","phenomenon_id":"flood","start":"1999","end":"2020","completeness":"complete","gaps":[]}
        seen = {"event_id":"event-1","phenomenon_id":"flood","region_ids":["r"],"start":"2005",
                "end":"2006","time_precision":"year","definition_ref":"record-1","source_ref":"fixture","source_version":"v1"}
        self._write("events/flood.json",{"catalogue_id":"prepared-flood","version":"v1","coverage_version":"coverage-1",
                   "source_ref":"fixture","definition_ref":"record-1","coverage":[coverage],"events":[seen]})
        cat = self.catalogue()
        found = cat.event_catalogue("flood","r",PERIOD)
        self.assertEqual(found["events"][0]["start"],"2005")
        self.assertEqual(found["coverage"],[coverage])
        self.assertEqual(found["status"],"ready")
        self.assertEqual(found["source_ref"],"fixture")


if __name__ == "__main__":
    unittest.main()
