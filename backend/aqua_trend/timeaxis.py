"""Month-index helpers shared by every module. index = year * 12 + (month - 1)."""
from __future__ import annotations

import calendar
import re

_YM = re.compile(r"^(\d{4})-(0[1-9]|1[0-2])$")


def is_ym(s: object) -> bool:
    return isinstance(s, str) and bool(_YM.match(s))


def ym_to_index(ym: str) -> int:
    m = _YM.match(ym)
    if not m:
        raise ValueError(f"not a YYYY-MM month: {ym!r}")
    return int(m.group(1)) * 12 + int(m.group(2)) - 1


def index_to_ym(i: int) -> str:
    return f"{i // 12:04d}-{i % 12 + 1:02d}"


def month_of(i: int) -> int:
    """0 = January … 11 = December."""
    return i % 12


def year_of(i: int) -> int:
    return i // 12


def days_in_month(i: int) -> int:
    return calendar.monthrange(i // 12, i % 12 + 1)[1]


def month_range(start: str, end: str) -> list[str]:
    a, b = ym_to_index(start), ym_to_index(end)
    return [index_to_ym(i) for i in range(a, b + 1)]
