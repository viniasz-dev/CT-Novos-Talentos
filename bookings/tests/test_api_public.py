from datetime import datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from bookings import services
from bookings.models import BookingRequest, Field, TimeBlock

TZ = ZoneInfo("America/Sao_Paulo")


def next_weekday(min_days=3, weekday_ok=lambda d: d < 5):
    day = timezone.localdate() + timedelta(days=min_days)
    while not weekday_ok(day.weekday()):
        day += timedelta(days=1)
    return day


def at(day, hour):
    return datetime(day.year, day.month, day.day, hour, tzinfo=TZ)


class ApiBase(TestCase):
    def setUp(self):
        User = get_user_model()
        self.ana = User.objects.create_user("ana", "ana@x.com", "senha-forte-1")
        self.bia = User.objects.create_user("bia", "bia@x.com", "senha-forte-1")
        self.field = Field.objects.create(name="Campo 1", price_per_hour=Decimal("100"))
        self.day = next_weekday()

    def login(self, user=None):
        self.client.force_login(user or self.ana)

    def payload(self, **over):
        data = {
            "field": self.field.id,
            "start": at(self.day, 19).isoformat(),
            "end": at(self.day, 20).isoformat(),
            "contact": "11 99999-0000",
            "message": "ola",
        }
        data.update(over)
        return data

    def post(self, data, path="/api/bookings"):
        return self.client.post(path, data, content_type="application/json")

    def raw(self, body, path="/api/bookings"):
        return self.client.post(path, body, content_type="application/json")

    def make(self, user=None, start_h=19, end_h=20, status=None, day=None):
        day = day or self.day
        b = services.create_booking(
            user or self.ana, self.field, at(day, start_h), at(day, end_h),
            "11 99999-0000", "")
        if status == "aprovado":
            b.status = "aprovado"
            b.save()
        return b


class FieldsTests(ApiBase):
    def test_lists_only_active(self):
        Field.objects.create(name="Oculto", price_per_hour=Decimal("50"), active=False)
        r = self.client.get("/api/fields")
        self.assertEqual(r.status_code, 200)
        names = [f["name"] for f in r.json()["fields"]]
        self.assertEqual(names, ["Campo 1"])

    def test_empty(self):
        Field.objects.all().delete()
        r = self.client.get("/api/fields")
        self.assertEqual(r.json(), {"fields": []})

    def test_method_not_allowed(self):
        self.assertEqual(self.post({}, "/api/fields").status_code, 405)


class CreateBookingTests(ApiBase):
    def test_anonymous_401(self):
        self.assertEqual(self.post(self.payload()).status_code, 401)
        self.assertEqual(self.client.get("/api/bookings").status_code, 401)

    def test_staff_cannot_book_403(self):
        staff = get_user_model().objects.create_user(
            "eq", "eq@x.com", "senha-forte-1", is_staff=True)
        self.login(staff)
        r = self.post(self.payload())
        self.assertEqual(r.status_code, 403, r.content)
        err = r.json()["error"]
        self.assertEqual(err["code"], "staff_cannot_book")
        self.assertEqual(err["message"], 'A equipe não faz reservas; use "Bloquear horário".')
        self.assertFalse(BookingRequest.objects.exists())

    def test_create_ok(self):
        self.login()
        r = self.post(self.payload())
        self.assertEqual(r.status_code, 201, r.content)
        b = r.json()["booking"]
        self.assertEqual(b["status"], "pendente")
        self.assertEqual(b["contact_masked"], BookingRequest.objects.get().contact_masked)
        self.assertNotIn("99999-0000", r.content.decode())
        self.assertNotIn("ola", r.content.decode())
        self.assertTrue(b["message_present"])

    def test_unicode_contact_round_trip(self):
        self.login()
        r = self.post(self.payload(contact="João ☎ 11 9", message="olá 😀"))
        self.assertEqual(r.status_code, 201)
        stored = BookingRequest.objects.get()
        self.assertEqual(stored.get_contact(), "João ☎ 11 9")
        self.assertEqual(stored.get_message(), "olá 😀")

    def test_message_optional(self):
        self.login()
        data = self.payload()
        del data["message"]
        self.assertEqual(self.post(data).status_code, 201)

    def test_bad_json(self):
        self.login()
        for body in ("", "{nope", "[]", "null", "123"):
            r = self.raw(body)
            self.assertEqual(r.status_code, 400, body)
            self.assertEqual(r.json()["error"]["code"], "invalid_json")

    def test_numeric_start(self):
        self.login()
        r = self.post(self.payload(start=123))
        self.assertEqual(r.status_code, 400)
        err = r.json()["error"]
        self.assertEqual(err["code"], "invalid_datetime")
        self.assertIn("start", err["fields"])

    def test_missing_end(self):
        self.login()
        data = self.payload()
        del data["end"]
        r = self.post(data)
        self.assertEqual(r.status_code, 400)
        self.assertIn("end", r.json()["error"]["fields"])

    def test_naive_datetime(self):
        self.login()
        r = self.post(self.payload(start="2030-01-01T19:00:00"))
        self.assertEqual(r.status_code, 400)

    def test_field_missing_or_wrong_type(self):
        self.login()
        data = self.payload()
        del data["field"]
        r = self.post(data)
        self.assertEqual(r.status_code, 400)
        self.assertIn("field", r.json()["error"]["fields"])
        for bad in ("abc", "1", True, 1.5, None, [1], {"a": 1}):
            r = self.post(self.payload(field=bad))
            self.assertEqual(r.status_code, 400, repr(bad))
            self.assertIn("field", r.json()["error"]["fields"])

    def test_contact_message_wrong_type(self):
        self.login()
        for key in ("contact", "message"):
            for bad in (123, [], {"a": 1}, True):
                r = self.post(self.payload(**{key: bad}))
                self.assertEqual(r.status_code, 400, (key, bad))
                self.assertIn(key, r.json()["error"]["fields"])

    def test_unknown_field_404(self):
        self.login()
        r = self.post(self.payload(field=99999))
        self.assertEqual(r.status_code, 404)
        self.assertEqual(r.json()["error"]["code"], "not_found")

    def test_conflict_409(self):
        self.make(user=self.bia, status="aprovado")
        self.login()
        r = self.post(self.payload())
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.json()["error"]["code"], "slot_taken")

    def test_duplicate_409(self):
        self.login()
        self.assertEqual(self.post(self.payload()).status_code, 201)
        r = self.post(self.payload())
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.json()["error"]["code"], "duplicate")

    def test_contact_limits(self):
        self.login()
        r = self.post(self.payload(contact="   "))
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["error"]["code"], "invalid_contact")
        r = self.post(self.payload(contact="x" * 121))
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self.post(self.payload(contact="x" * 120)).status_code, 201)

    def test_message_too_long(self):
        self.login()
        r = self.post(self.payload(message="m" * 501))
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["error"]["code"], "invalid_message")

    def test_closed_day(self):
        self.login()
        sat = next_weekday(weekday_ok=lambda d: d == 5)
        r = self.post(self.payload(start=at(sat, 19).isoformat(),
                                   end=at(sat, 20).isoformat()))
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["error"]["code"], "closed")

    def test_inactive_field_rejected(self):
        self.field.active = False
        self.field.save()
        self.login()
        self.assertEqual(self.post(self.payload()).status_code, 400)


class ListAndCancelTests(ApiBase):
    def test_list_only_own_newest_first(self):
        a1 = self.make(start_h=19, end_h=20)
        a2 = self.make(start_h=21, end_h=22)
        self.make(user=self.bia, start_h=20, end_h=21)
        self.login()
        r = self.client.get("/api/bookings")
        self.assertEqual(r.status_code, 200)
        ids = [b["id"] for b in r.json()["bookings"]]
        self.assertEqual(ids, [a2.id, a1.id])

    def test_cancel_own(self):
        b = self.make()
        self.login()
        r = self.client.post(f"/api/bookings/{b.id}/cancel")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["booking"]["status"], "cancelado")

    def test_cancel_other_user_404(self):
        b = self.make(user=self.bia)
        self.login()
        r = self.client.post(f"/api/bookings/{b.id}/cancel")
        self.assertEqual(r.status_code, 404)
        self.assertEqual(r.json()["error"]["code"], "not_found")
        b.refresh_from_db()
        self.assertEqual(b.status, "pendente")

    def test_cancel_missing_404(self):
        self.login()
        self.assertEqual(self.client.post("/api/bookings/9999/cancel").status_code, 404)

    def test_cancel_anonymous_401(self):
        b = self.make()
        self.assertEqual(self.client.post(f"/api/bookings/{b.id}/cancel").status_code, 401)

    def test_cancel_twice_409(self):
        b = self.make()
        self.login()
        self.client.post(f"/api/bookings/{b.id}/cancel")
        r = self.client.post(f"/api/bookings/{b.id}/cancel")
        self.assertEqual(r.status_code, 409)

    def test_cancel_get_not_allowed(self):
        self.login()
        self.assertEqual(self.client.get("/api/bookings/1/cancel").status_code, 405)


class AvailabilityTests(ApiBase):
    def get(self, **params):
        return self.client.get("/api/availability", params)

    def test_day(self):
        self.make(user=self.bia, start_h=19, end_h=20, status="aprovado")
        TimeBlock.objects.create(field=self.field, start=at(self.day, 20),
                                 end=at(self.day, 21), reason="x", created_by=self.bia)
        r = self.get(field=self.field.id, date=self.day.isoformat())
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertEqual(data["field"], self.field.id)
        self.assertEqual(data["date"], self.day.isoformat())
        self.assertTrue(data["open"])
        states = [s["state"] for s in data["slots"]]
        self.assertEqual(states, ["free", "booked", "blocked", "free", "free"])

    def test_closed_day(self):
        sat = next_weekday(weekday_ok=lambda d: d == 5)
        data = self.get(field=self.field.id, date=sat.isoformat()).json()
        self.assertFalse(data["open"])
        self.assertEqual(data["slots"], [])

    def test_range(self):
        d = self.day
        r = self.get(field=self.field.id, **{"from": d.isoformat(),
                                             "to": (d + timedelta(days=6)).isoformat()})
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertEqual(data["field"], self.field.id)
        self.assertEqual(len(data["days"]), 7)
        self.assertIn(d.isoformat(), data["days"])

    def test_range_too_long(self):
        d = self.day
        r = self.get(field=self.field.id, **{"from": d.isoformat(),
                                             "to": (d + timedelta(days=40)).isoformat()})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["error"]["code"], "bad_range")

    def test_missing_params(self):
        self.assertEqual(self.get().status_code, 400)
        self.assertEqual(self.get(field=self.field.id).status_code, 400)
        r = self.get(field=self.field.id, **{"from": self.day.isoformat()})
        self.assertEqual(r.status_code, 400)

    def test_bad_params(self):
        self.assertEqual(self.get(field="abc", date=self.day.isoformat()).status_code, 400)
        self.assertEqual(self.get(field=self.field.id, date="nope").status_code, 400)
        r = self.get(field=self.field.id, **{"from": "x", "to": "y"})
        self.assertEqual(r.status_code, 400)

    def test_unknown_field_404(self):
        r = self.get(field=9999, date=self.day.isoformat())
        self.assertEqual(r.status_code, 404)

    def test_inactive_field_404(self):
        self.field.active = False
        self.field.save()
        self.assertEqual(
            self.get(field=self.field.id, date=self.day.isoformat()).status_code, 404)
        r = self.get(field=self.field.id, **{"from": self.day.isoformat(),
                                             "to": self.day.isoformat()})
        self.assertEqual(r.status_code, 404)

    def test_public_no_login(self):
        self.assertEqual(
            self.get(field=self.field.id, date=self.day.isoformat()).status_code, 200)
