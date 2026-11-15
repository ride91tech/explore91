"""Booking dates for tests.

POST /api/bookings refuses slots that have already passed, so a test that
hard-codes a date starts failing the day that date goes by. Build dates
relative to today instead.
"""
from datetime import date, timedelta


def future_date(days: int = 7) -> str:
    """A YYYY-MM-DD date `days` from today. Days ahead, so it is in the
    future in every timezone the suite might run in."""
    return (date.today() + timedelta(days=days)).isoformat()
