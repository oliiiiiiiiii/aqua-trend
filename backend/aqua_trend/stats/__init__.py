"""Statistics package: seasonal reference, trend engine, BY-FDR, evidence families (spec §7.1–§7.3)."""
from .evidence import (
    EvidenceController,
    attach_families,
    hypothesis_components,
    hypothesis_id,
    significance,
)
from .fdr import by_adjust
from .policy import DEFAULT_LAG_POLICY_ID, LAG_POLICIES, STATS_POLICY_VERSION
from .result import to_trend_result
from .seasonal import Climatology, anomalies, climatology
from .trend import BatchTrendFit, TrendFit, fit_trend, fit_trend_batch, half_slopes

__all__ = [
    "BatchTrendFit", "Climatology", "DEFAULT_LAG_POLICY_ID", "EvidenceController", "LAG_POLICIES",
    "STATS_POLICY_VERSION", "TrendFit", "anomalies", "attach_families", "by_adjust", "climatology",
    "fit_trend", "fit_trend_batch", "half_slopes", "hypothesis_components", "hypothesis_id",
    "significance", "to_trend_result",
]
