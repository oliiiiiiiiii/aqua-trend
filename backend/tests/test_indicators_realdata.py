"""D10 / E03 on the prepared NASA/NOAA precipitation series (web/public/data, series-2).

Reads the series-2 file directly (no store needed) and asserts only structural facts —
which product can support the fixed SPI calibration — never specific index values.
"""
from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import sys
from pathlib import Path as _Path

import numpy as np

sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))          # backend/ (aqua_trend package)
import pytest

from aqua_trend.indicators import IndicatorRegistry
from aqua_trend.timeaxis import ym_to_index

DATA = Path(__file__).resolve().parents[2] / "web" / "public" / "data"
REGION = "named-taiwan-main-island"
pytestmark = pytest.mark.realdata


def prepared(product_id: str):
    path = DATA / "series" / f"{REGION}.json"
    if not path.exists():
        pytest.skip("prepared series not present")
    layer = json.loads(path.read_text())["layers"].get(product_id)
    if layer is None:
        pytest.skip(f"{product_id} not prepared for {REGION}")
    unit = json.loads((DATA / "catalog" / "variables.json").read_text())["layers"][product_id]["unit"]
    values = np.array([np.nan if v is None else v for v in layer["values"]], dtype=np.float64)
    return SimpleNamespace(t=ym_to_index(layer["start"]) + np.arange(values.size), values=values, unit=unit,
                           temporal_support="monthly_mean_rate", product_id=product_id, region_id=REGION)


@pytest.mark.parametrize("indicator_id", ["spi3", "spi6", "spi12"])
def test_D10_imerg_cannot_support_the_calibration_but_gpcp_and_merra2_can(indicator_id):
    registry = IndicatorRegistry()
    period = {"start": "2005-01", "end": "2024-12"}
    imerg = registry.compute(indicator_id, series=prepared("p_imerg"), region_id=REGION, analysis_period=period)
    assert imerg.status == "insufficient_baseline" and imerg.monthly_values is None
    assert max(imerg.calibration.samples_per_position) < 30
    for product_id in ("p_gpcp", "p_m2"):
        comp = registry.compute(indicator_id, series=prepared(product_id), region_id=REGION, analysis_period=period)
        assert comp.status == "ok" and comp.product_id == product_id
        assert comp.calibration.samples_per_position == [30] * 12
        inside = comp.monthly_values[(comp.monthly_t >= ym_to_index("1991-01")) & (comp.monthly_t <= ym_to_index("2020-12"))]
        assert np.isfinite(inside).all() and abs(inside.mean()) < 0.1 and 0.85 < inside.std() < 1.15
        assert all(m.status == "ok" for m in comp.metrics.values())
        assert comp.to_contract().kind == "derived_indicator"
