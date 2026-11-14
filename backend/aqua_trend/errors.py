"""Stable error codes (docs/earth-system-data-contracts.md §9.4)."""
from __future__ import annotations

from .contracts import ApiError

# code -> (http status, retryable)
CODES: dict[str, tuple[int, bool]] = {
    "invalid_request": (422, False),
    "invalid_period": (422, False),          # only one end given, start > end, bad format
    "unknown_region": (422, False),          # id is not in the region catalogue
    "invalid_context": (422, False),         # preset_ref conflicts with user fields / unknown refs
    "empty_query": (422, False),
    "selector_unavailable": (503, True),     # model not configured / not reachable, no saved plan
    "selector_invalid_output": (502, True),  # model returned ids/recipes that are not in the catalogue
    "unsupported_phenomenon": (200, False),  # result state, not an HTTP failure
    "no_matching_preset": (200, False),      # result state
    "not_found": (404, False),
    "cancelled": (200, False),
    "internal_error": (500, True),
    "data_release_invalid": (503, False),
}


class AquaError(Exception):
    def __init__(self, code: str, message: str, fields: list[str] | None = None, retryable: bool | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.fields = fields or []
        self.http_status, default_retry = CODES.get(code, (500, False))
        self.retryable = default_retry if retryable is None else retryable

    def to_api(self) -> ApiError:
        return ApiError(code=self.code, message=self.message, retryable=self.retryable, fields=self.fields)
