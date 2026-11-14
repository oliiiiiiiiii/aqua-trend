"""Integrated contracts exercised against the bundled, prepared export."""
import copy
import csv
import io
import json
from pathlib import Path
import tempfile
import unittest
from server.api import csv_snapshot
from server.catalogue import Catalogue
from server.errors import ResearchError
from server.presets import PresetPolicy
from server.research import ResearchEngine, validate_request
from server.store import Store


class ResearchTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cat = Catalogue()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        policy = {"version": "fixture-policy", "regions": ["named-taiwan-main-island", "named-po-valley"],
                  "windows": [{"start": "2005-01", "end": "2024-12"}, {"start": "2015-01", "end": "2024-12"}],
                  "weights": {"effect": .3, "relevance": .3, "quality": .25, "stability": .15}, "overrides": []}
        self.policy_file = root / "policy.json"
        self.policy_file.write_text(json.dumps(policy))
        self.store = Store(root / "store.sqlite")
        self.engine = ResearchEngine(self.cat, self.store, PresetPolicy(self.policy_file))
        self.region = "named-taiwan-main-island"
        self.period = {"start": "2005-01", "end": "2024-12"}

    def run_study(self, query="flood", **constraints):
        request = self.engine.validate({"phenomenon_query": query, **constraints})
        job = self.store.add_job(request)
        result, preset = self.engine.run(job, lambda *_: None)
        self.store.finish(job["id"], result["identity"]["status"], result=result, preset=preset)
        return result

    def test_structured_fields_reject_injection_and_invalid_ranges(self):
        for q in [{"period": {"start": "2020-00", "end": "2020-02"}}, {"period": {"start": "1999-04"}},
                  {"period": {"start": "2020-02", "end": "2019-03"}}, {"region_id": []},
                  {"region_id": "Europe"}, {"p_adjusted": .00001}, {"context": {"fake_family": []}}]:
            with self.subTest(q=q), self.assertRaises(ResearchError):
                validate_request({"phenomenon_query": "rain", **q}, self.cat.regions)

    def test_all_constraints_deterministic_replay_and_export(self):
        r = self.run_study("乾旱", region_id=self.region, period=self.period)
        self.assertEqual(r["resolved"]["region_source"], "user")
        self.assertEqual(r["resolved"]["period_source"], "user")
        self.assertIsNone(r["resolved"]["preset"])
        self.assertEqual(len(r["evidence_families"]), 1)
        self.assertEqual(r["comparison"]["period"], self.period)
        valid = next(v for v in r["variables"] if v.get("trend") and v["trend"]["slope_per_year"] is not None)
        self.assertTrue(valid["product"]["selected_product_id"])
        self.assertTrue(any(i["kind"] == "recorded_event" and i["status"] == "data_required" for i in r["indicators"]))
        rows = csv.DictReader(io.StringIO(csv_snapshot(r).decode()))
        sample = next(row for row in rows if row["variable_id"] == valid["variable_id"] and row["value"])
        i = valid["full_history"]["times"].index(sample["time"])
        self.assertEqual(float(sample["value"]), valid["full_history"]["values"][i])
        self.assertEqual(float(sample["slope_per_decade"]), valid["trend"]["slope_per_decade"])
        self.assertEqual(json.loads(sample["p_adjusted"]), valid["trend"]["p_adjusted"])
        r2 = self.run_study("乾旱", region_id=self.region, period=self.period)
        self.assertEqual(r["selection"]["selection_plan_id"], r2["selection"]["selection_plan_id"])
        self.assertEqual(r["variables"], r2["variables"])
        self.assertEqual(r, self.store.job(r["identity"]["id"])["result"])

    def test_optional_fields_preset_replay_and_family_sizes(self):
        r = self.run_study()
        resolved = r["resolved"]
        self.assertTrue(all(v["requested_period"] is None for v in r["variables"]))
        self.assertEqual((resolved["region_source"], resolved["period_source"]), ("preset", "preset"))
        p = resolved["preset"]
        families = r["evidence_families"]
        self.assertGreater(families[1]["candidate_count"], 1)
        self.assertGreaterEqual(families[1]["tested_count"], families[0]["tested_count"])
        for v in r["variables"]:
            if v.get("trend") and v["trend"]["p_raw"] is not None:
                self.assertEqual(v["trend"]["primary_family_id"], families[1]["family_id"])
        ref = {"id": p["id"], "version": p["version"]}
        replay = self.run_study(context={"preset_ref": ref})
        self.assertEqual(replay["evidence_families"], families)
        with self.assertRaises(ResearchError):
            self.run_study(region_id=next(k for k in self.cat.regions if k != p["region_id"]), context={"preset_ref": ref})
        for kwargs in ({"region_id": self.region}, {"period": self.period}):
            rr = self.run_study(**kwargs)["resolved"]
            for k, v in kwargs.items():
                self.assertEqual(rr[k], v)
            self.assertEqual(rr["region_source"], "user" if "region_id" in kwargs else "preset")
            self.assertEqual(rr["period_source"], "user" if "period" in kwargs else "preset")

    def test_missing_series_and_no_matching_preset(self):
        region = next(r for r in self.cat.regions if r.startswith("hex-"))
        r = self.run_study(region_id=region, period=self.period)
        self.assertEqual(r["resolved"]["region_id"], region)
        self.assertTrue(all(not v.get("trend") or v["trend"]["slope_per_year"] is None for v in r["variables"]))
        with self.assertRaises(ResearchError) as caught:
            self.run_study(region_id=region)
        self.assertEqual(caught.exception.payload["code"], "no_matching_preset")

    def test_manual_pinned_and_disabled_presets_and_version_changes(self):
        policy = self.engine.policy.data
        chosen = {"region_id": self.region, "period": self.period, "pinned": True,
                  "priority": 9, "manual_reason": "A complete regional case selected for the workshop."}
        policy["overrides"] = [chosen, {"region_id": "named-po-valley", "period": self.period, "disabled": True}]
        self.policy_file.write_text(json.dumps(policy))
        self.engine = ResearchEngine(self.cat, self.store, PresetPolicy(self.policy_file))
        r = self.run_study()
        p = r["resolved"]["preset"]
        self.assertEqual(p["source"], "manual")
        self.assertEqual(p["region_id"], self.region)
        self.assertEqual(p["period"], self.period)
        self.assertTrue(any(c.get("disabled") for c in r["evidence_families"][1]["candidates"]))
        old = copy.deepcopy(self.engine.versions)
        self.engine.versions = {**old, "method_policy_version": "test-upgrade"}
        replay = self.run_study(context={"preset_ref": {"id": p["id"], "version": p["version"]}})
        self.assertEqual(len(replay["evidence_families"]), 1)
        self.assertTrue(replay["warnings"])
        self.assertEqual(self.store.job(r["identity"]["id"])["result"]["identity"]["versions"], old)

    def test_cancelled_work_never_publishes_a_case_or_overwrites_result(self):
        job = self.store.add_job({})
        self.assertTrue(self.store.finish(job["id"], "cancelled"))
        self.assertFalse(self.store.advance(job["id"], "correcting", 99, 99))
        self.assertFalse(self.store.finish(job["id"], "complete", result={"unexpected": True}))
        self.assertIsNone(self.store.job(job["id"])["result"])
        self.assertEqual(self.store.published(), [])


if __name__ == "__main__":
    unittest.main()
