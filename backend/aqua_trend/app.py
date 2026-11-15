"""Module-level ASGI app for uvicorn: ``uvicorn aqua_trend.app:app`` (spec §10).

Importing this module opens the prepared data release and reads the configuration from the
environment (see backend/README.md).  Tests use ``aqua_trend.api.create_app`` with injected
parts instead.
"""
from __future__ import annotations

from .api import create_app

app = create_app()
