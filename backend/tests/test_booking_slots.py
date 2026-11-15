"""A booking must be for a real slot that has not passed yet.

The endpoint used to check only string lengths, so it confirmed a booking
for 2020-01-01 12:30 and one for "notadate!" at "25:99". Owners then saw
confirmed bookings for times that could never happen.
"""
from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from booking_dates import future_date
from models import BookingCreate

IST = timezone(timedelta(hours=5, minutes=30))


def _booking(date: str, time: str) -> BookingCreate:
    return BookingCreate(business_id="biz_x", date=date, time=time, guests=2)


class TestBookingSlotModel:
    def test_accepts_a_future_slot(self):
        b = _booking(future_date(3), "19:30")
        assert (b.date, b.time) == (future_date(3), "19:30")

    @pytest.mark.parametrize("date", ["notadate!", "2026/12/01", "01-12-2026", "2026-1-5", "20261201"])
    def test_rejects_a_date_that_is_not_yyyy_mm_dd(self, date):
        with pytest.raises(ValidationError):
            _booking(date, "19:30")

    @pytest.mark.parametrize("date", ["2031-02-30", "2031-13-01", "2031-00-10"])
    def test_rejects_a_date_that_is_not_on_the_calendar(self, date):
        with pytest.raises(ValidationError):
            _booking(date, "19:30")

    @pytest.mark.parametrize("time", ["25:99", "24:00", "7pm", "19:3", "1930", "19:30:00"])
    def test_rejects_a_time_that_is_not_hh_mm(self, time):
        with pytest.raises(ValidationError):
            _booking(future_date(3), time)

    def test_rejects_a_past_date(self):
        with pytest.raises(ValidationError, match="already passed"):
            _booking("2020-01-01", "12:30")

    def test_rejects_a_slot_earlier_today_in_india(self):
        an_hour_ago = datetime.now(IST) - timedelta(hours=1)
        if an_hour_ago.date() != datetime.now(IST).date():
            pytest.skip("just after midnight in India; 'earlier today' does not exist yet")
        with pytest.raises(ValidationError, match="already passed"):
            _booking(an_hour_ago.strftime("%Y-%m-%d"), an_hour_ago.strftime("%H:%M"))


class TestBookingSlotApi:
    @pytest.fixture(scope="class")
    def biz_id(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/businesses", params={"city": "goa", "limit": 1})
        return r.json()[0]["business_id"]

    @pytest.mark.parametrize("date,time", [("2020-01-01", "12:30"), ("notadate!", "25:99")])
    def test_api_refuses_impossible_slots(self, api_client, base_url, auth_headers, biz_id, date, time):
        r = api_client.post(f"{base_url}/api/bookings", headers=auth_headers, json={
            "business_id": biz_id, "date": date, "time": time, "guests": 2,
            "notes": "TEST_slot_refused",
        })
        assert r.status_code == 422, r.text

    def test_api_still_books_a_future_slot(self, api_client, base_url, auth_headers, biz_id):
        r = api_client.post(f"{base_url}/api/bookings", headers=auth_headers, json={
            "business_id": biz_id, "date": future_date(5), "time": "19:30", "guests": 2,
            "notes": "TEST_slot_ok",
        })
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "confirmed"
