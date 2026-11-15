"""Offline checks: python3 -I -m unittest discover -s tools/selector -p 'test_*.py'."""
from contextlib import redirect_stdout
from io import StringIO
import json
import math
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

import eval as evaluation
from selector import BACKENDS, CATEGORIES, parse_probabilities, request_body


class SelectorContractTests(unittest.TestCase):
    def test_all_backends_send_every_category(self):
        for backend in BACKENDS:
            with self.subTest(backend=backend):
                body = request_body(backend, "野火")
                questions = body["questions"]
                if isinstance(questions, list):
                    self.assertEqual([q["id"] for q in questions], list(CATEGORIES))
                else:
                    self.assertEqual(list(questions), list(CATEGORIES))
                    self.assertIn("emit each year", questions["so2"]["instructions"])
                    self.assertIn("atmospheric column", questions["ozone"]["instructions"])
                self.assertEqual(len(questions), 17)

    def reply(self, backend, values):
        if backend == "phocinae":
            return {"option_scores": {c: [0, p] for c, p in values.items()}}
        return {"answers": {c: {"noul": p} for c, p in values.items()}}

    def test_all_backends_parse_complete_numeric_votes(self):
        values = {c: i / (len(CATEGORIES) - 1) for i, c in enumerate(CATEGORIES)}
        for backend in BACKENDS:
            with self.subTest(backend=backend):
                self.assertEqual(parse_probabilities(backend, self.reply(backend, values)), values)

    def test_old_twelve_category_service_is_rejected(self):
        values = {c: 0.5 for c in evaluation.EVALUATED_CATEGORIES}
        for backend in BACKENDS:
            with self.subTest(backend=backend), self.assertRaises(KeyError):
                parse_probabilities(backend, self.reply(backend, values))

    def test_invalid_votes_are_not_coerced(self):
        for backend in BACKENDS:
            for invalid in [None, True, False, "0.8", -0.1, 1.1, math.nan, math.inf]:
                values = {c: 0.5 for c in CATEGORIES}
                values["fire"] = invalid
                with self.subTest(backend=backend, invalid=invalid), self.assertRaises(ValueError):
                    parse_probabilities(backend, self.reply(backend, values))


class HistoricalEvaluationTests(unittest.TestCase):
    def test_new_unlabeled_categories_do_not_change_historical_scores(self):
        original_path = Path(__file__).parent / "results" / "onejev-en.json"
        data = json.loads(original_path.read_text())
        original = StringIO()
        with redirect_stdout(original):
            evaluation.summary([str(original_path)])
        self.assertIn("scored categories 12", original.getvalue())
        for row in data["rows"]:
            row["p"].update({c: 1.0 for c in CATEGORIES if c not in evaluation.EVALUATED_CATEGORIES})
        data["scored_categories"] = evaluation.EVALUATED_CATEGORIES
        with TemporaryDirectory() as directory:
            path = Path(directory) / "new-run.json"
            path.write_text(json.dumps(data))
            extended = StringIO()
            with redirect_stdout(extended):
                evaluation.summary([str(path)])
        self.assertEqual(extended.getvalue(), original.getvalue())


if __name__ == "__main__":
    unittest.main()
