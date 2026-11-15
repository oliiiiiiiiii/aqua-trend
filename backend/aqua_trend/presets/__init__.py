"""PresetEngine: candidates, vectorised search, interest score, manual adjustments (spec §8, §7.3)."""
from .batch import BatchAnalyser, CandidateResult, MetricFacts, half_slopes_batch
from .candidates import Candidate, CandidateSet, Window, declare_candidates, fixed_windows
from .manual import Adjustment, ManualSettings, load_settings
from .policy import PresetPolicy
from .scoring import ScoredCandidate, evidence_summary, score_candidate
from .service import (
    PRESET_ENGINE_VERSION, PresetEngine, PresetFillResult, SearchOutcome, preset_id_for,
)

__all__ = [
    "Adjustment", "BatchAnalyser", "Candidate", "CandidateResult", "CandidateSet", "ManualSettings",
    "MetricFacts", "PRESET_ENGINE_VERSION", "PresetEngine", "PresetFillResult", "PresetPolicy",
    "ScoredCandidate", "SearchOutcome", "Window", "declare_candidates", "evidence_summary",
    "fixed_windows", "half_slopes_batch", "load_settings", "preset_id_for", "score_candidate",
]
