import json
from datetime import datetime, timedelta

from django.test import TestCase
from django.utils import timezone

from accounts.models import User
from bookings import services
from bookings.models import AuditEvent, BookingRequest, Field, TimeBlock

PW = "pw-12345-Abc"
CONTACT = "(19) 99911-7711"
MESSAGE = "Aniversario do Zeca"


def future_slot(hour=19, days=3):
    tz = timezone.get_current_timezone()
    day = (timezone.now() + timedelta(days=days)).astimezone(tz).date()
    while day.weekday() > 4:
        day += timedelta(days=1)
    start = datetime(day.year, day.month, day.day, hour, tzinfo=tz)
    return start, start + timedelta(hours=1)


class Base(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("c@x.test", PW, name="Cli")
        self.user2 = User.objects.create_user("c2@x.test", PW, name="Cli Dois")
        self.staff = User.objects.create_user("s@x.test", PW, name="Staff", is_staff=True)
        self.field = Field.objects.create(name="Campo 1", price_per_hour="150.00")
        self.other_field = Field.objects.create(name="Campo 2", price_per_hour="150.00")
        self.start, self.end = future_slot()

    def make_booking(self, user=None, field=None, start=None, end=None):
        return services.create_booking(
            user or self.user, field or self.field, start or self.start,
            end or self.end, CONTACT, MESSAGE)

    def login(self, user):
        self.client.force_login(user)

    def post(self, url, data):
        return self.client.post(url, json.dumps(data), content_type="application/json")


class AuthTests(Base):
    def routes(self):
        b = self.make_booking()
        blk = TimeBlock.objects.create(field=self.field, start=self.start - timedelta(hours=3),
                                       end=self.start - timedelta(hours=2))
        return [
            ("get", "/api/admin/bookings"),
            ("post", f"/api/admin/bookings/{b.pk}/status"),
            ("get", f"/api/admin/bookings/{b.pk}/contact"),
            ("get", "/api/admin/blocks"),
            ("post", "/api/admin/blocks"),
            ("delete", f"/api/admin/blocks/{blk.pk}"),
            ("get", "/api/admin/agenda"),
        ]

    def test_anonymous_401(self):
        for method, url in self.routes():
            r = getattr(self.client, method)(url)
            self.assertEqual(r.status_code, 401, (method, url))

    def test_client_403(self):
        self.login(self.user)
        for method, url in self.routes():
            r = getattr(self.client, method)(url)
            self.assertEqual(r.status_code, 403, (method, url))

    def test_inactive_staff_401(self):
        routes = self.routes()
        self.login(self.staff)
        self.staff.is_active = False
        self.staff.save()
        for method, url in routes:
            r = getattr(self.client, method)(url)
            self.assertEqual(r.status_code, 401, (method, url))


class ListTests(Base):
    def test_list_filters_and_no_cleartext(self):
        a = self.make_booking()
        s2, e2 = future_slot(hour=20)
        b = self.make_booking(user=self.user2, start=s2, end=e2)
        services.set_status(b, "recusado", self.staff)
        self.login(self.staff)
        r = self.client.get("/api/admin/bookings?status=pendente")
        self.assertEqual(r.status_code, 200)
        ids = [x["id"] for x in r.json()["bookings"]]
        self.assertEqual(ids, [a.pk])
        self.assertNotIn("99911", r.content.decode())
        self.assertNotIn("Zeca", r.content.decode())
        self.assertIn("user", r.json()["bookings"][0])
        r = self.client.get("/api/admin/bookings")
        self.assertEqual(len(r.json()["bookings"]), 2)

    def test_filter_field_and_date(self):
        a = self.make_booking()
        self.make_booking(field=self.other_field, user=self.user2)
        self.login(self.staff)
        r = self.client.get(f"/api/admin/bookings?field={self.field.pk}")
        self.assertEqual([x["id"] for x in r.json()["bookings"]], [a.pk])
        day = timezone.localtime(self.start).date().isoformat()
        r = self.client.get(f"/api/admin/bookings?date={day}")
        self.assertEqual(len(r.json()["bookings"]), 2)
        other = (timezone.localtime(self.start).date() + timedelta(days=1)).isoformat()
        r = self.client.get(f"/api/admin/bookings?date={other}")
        self.assertEqual(r.json()["bookings"], [])

    def test_filter_date_range_inclusive_local_days(self):
        a = self.make_booking()
        s2, e2 = future_slot(hour=19, days=10)
        b = self.make_booking(start=s2, end=e2)
        self.login(self.staff)
        d1 = timezone.localtime(self.start).date()
        d2 = timezone.localtime(s2).date()

        def ids(query):
            r = self.client.get(f"/api/admin/bookings?{query}")
            self.assertEqual(r.status_code, 200, query)
            return [x["id"] for x in r.json()["bookings"]]

        self.assertEqual(ids(f"date_from={d1}&date_to={d2}"), [b.pk, a.pk])
        self.assertEqual(ids(f"date_from={d1}&date_to={d1}"), [a.pk])
        self.assertEqual(ids(f"date_from={d2}"), [b.pk])
        self.assertEqual(ids(f"date_to={d1}"), [a.pk])
        self.assertEqual(ids(f"date_from={d2 + timedelta(days=1)}"), [])
        # combina com status e campo
        services.set_status(a, "aprovado", self.staff)
        self.assertEqual(ids(f"date_from={d1}&date_to={d2}&status=aprovado"), [a.pk])
        self.assertEqual(ids(f"date_from={d1}&date_to={d2}&field={self.other_field.pk}"), [])

    def test_bad_date_range_400(self):
        self.login(self.staff)
        for q in ["date_from=nope", "date_to=2026-02-30", "date_from=20/10/2026",
                  "date_from=2026-10-20&date_to=2026-10-19"]:
            r = self.client.get(f"/api/admin/bookings?{q}")
            self.assertEqual(r.status_code, 400, q)
        r = self.client.get("/api/admin/bookings?date_from=2026-10-20&date_to=2026-10-19")
        self.assertEqual(r.json()["error"]["code"], "invalid_range")
        self.assertIn("date_to", r.json()["error"]["fields"])
        # teto de 366 dias: 366 passa, 367 é 400 invalid_range
        r = self.client.get("/api/admin/bookings?date_from=2026-01-01&date_to=2027-01-02")
        self.assertEqual(r.status_code, 200)
        r = self.client.get("/api/admin/bookings?date_from=2026-01-01&date_to=2027-01-03")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["error"]["code"], "invalid_range")
        self.assertIn("366", r.json()["error"]["message"])
        r = self.client.get("/api/admin/bookings?date_from=x")
        self.assertEqual(r.json()["error"]["code"], "invalid_date")
        self.assertIn("date_from", r.json()["error"]["fields"])

    def test_bad_filters_400(self):
        self.login(self.staff)
        for q in ["status=banana", "field=abc", "field=1.5", "date=nope", "date=2026-13-40"]:
            r = self.client.get(f"/api/admin/bookings?{q}")
            self.assertEqual(r.status_code, 400, q)
        r = self.client.get("/api/admin/bookings?status=banana")
        self.assertEqual(r.json()["error"]["code"], "invalid_status")


class StatusTests(Base):
    def test_approve_audits(self):
        b = self.make_booking()
        self.login(self.staff)
        r = self.post(f"/api/admin/bookings/{b.pk}/status", {"status": "aprovado"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["booking"]["status"], "aprovado")
        self.assertTrue(AuditEvent.objects.filter(action="booking.approved").exists())

    def test_approve_conflict_409(self):
        a = self.make_booking()
        b = self.make_booking(user=self.user2)
        services.set_status(a, "aprovado", self.staff)
        self.login(self.staff)
        r = self.post(f"/api/admin/bookings/{b.pk}/status", {"status": "aprovado"})
        self.assertEqual(r.status_code, 409)

    def test_invalid_status_400(self):
        b = self.make_booking()
        self.login(self.staff)
        for bad in ["banana", 123, None, ["aprovado"], ""]:
            r = self.post(f"/api/admin/bookings/{b.pk}/status", {"status": bad})
            self.assertEqual(r.status_code, 400, bad)
            self.assertEqual(r.json()["error"]["code"], "invalid_status")
        r = self.post(f"/api/admin/bookings/{b.pk}/status", {})
        self.assertEqual(r.status_code, 400)
        r = self.client.post(f"/api/admin/bookings/{b.pk}/status", "[1]",
                             content_type="application/json")
        self.assertEqual(r.status_code, 400)

    def test_final_state_transition_409(self):
        b = self.make_booking()
        services.set_status(b, "recusado", self.staff)
        self.login(self.staff)
        r = self.post(f"/api/admin/bookings/{b.pk}/status", {"status": "aprovado"})
        self.assertEqual(r.status_code, 409)

    def test_404(self):
        self.login(self.staff)
        r = self.post("/api/admin/bookings/99999/status", {"status": "aprovado"})
        self.assertEqual(r.status_code, 404)


class ContactTests(Base):
    def test_reveal_audits(self):
        b = self.make_booking()
        self.login(self.staff)
        r = self.client.get(f"/api/admin/bookings/{b.pk}/contact")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), {"contact": CONTACT, "message": MESSAGE})
        self.assertEqual(AuditEvent.objects.filter(action="booking.decrypted").count(), 1)

    def test_404(self):
        self.login(self.staff)
        self.assertEqual(self.client.get("/api/admin/bookings/99999/contact").status_code, 404)
        self.assertEqual(AuditEvent.objects.filter(action="booking.decrypted").count(), 0)


class BlockTests(Base):
    def body(self, **kw):
        data = {"field": self.field.pk, "start": self.start.isoformat(),
                "end": self.end.isoformat(), "reason": "Manutencao"}
        data.update(kw)
        return data

    def test_create_list_delete(self):
        self.login(self.staff)
        r = self.post("/api/admin/blocks", self.body())
        self.assertEqual(r.status_code, 201)
        pk = r.json()["block"]["id"]
        self.assertTrue(AuditEvent.objects.filter(action="block.created").exists())
        r = self.client.get(f"/api/admin/blocks?field={self.field.pk}")
        self.assertEqual([b["id"] for b in r.json()["blocks"]], [pk])
        r = self.client.get(f"/api/admin/blocks?field={self.other_field.pk}")
        self.assertEqual(r.json()["blocks"], [])
        day = timezone.localtime(self.start).date().isoformat()
        r = self.client.get(f"/api/admin/blocks?date={day}")
        self.assertEqual(len(r.json()["blocks"]), 1)
        r = self.client.delete(f"/api/admin/blocks/{pk}")
        self.assertEqual(r.status_code, 204)
        self.assertFalse(TimeBlock.objects.exists())
        self.assertTrue(AuditEvent.objects.filter(action="block.deleted").exists())
        self.assertEqual(self.client.delete(f"/api/admin/blocks/{pk}").status_code, 404)

    def test_over_approved_409(self):
        b = self.make_booking()
        services.set_status(b, "aprovado", self.staff)
        self.login(self.staff)
        r = self.post("/api/admin/blocks", self.body())
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.json()["error"]["fields"]["conflicts"], [b.pk])

    def test_bad_input_400(self):
        self.login(self.staff)
        cases = [
            self.body(start=123), self.body(end=None),
            self.body(start="2026-10-20T19:00:00"),  # naive
            self.body(field="1"), self.body(field=True), self.body(field=1.5),
            self.body(field=None), self.body(reason=5), self.body(reason="x" * 201),
            self.body(end=self.start.isoformat()),
        ]
        for data in cases:
            r = self.post("/api/admin/blocks", data)
            self.assertEqual(r.status_code, 400, data)
        r = self.client.post("/api/admin/blocks", "", content_type="application/json")
        self.assertEqual(r.status_code, 400)
        r = self.client.post("/api/admin/blocks", "{bad", content_type="application/json")
        self.assertEqual(r.status_code, 400)
        self.assertFalse(TimeBlock.objects.exists())

    def test_unknown_field_404(self):
        self.login(self.staff)
        r = self.post("/api/admin/blocks", self.body(field=99999))
        self.assertEqual(r.status_code, 404)

    def test_reason_optional(self):
        self.login(self.staff)
        data = self.body()
        del data["reason"]
        self.assertEqual(self.post("/api/admin/blocks", data).status_code, 201)


class AgendaTests(Base):
    def test_agenda(self):
        b = self.make_booking()
        services.set_status(b, "aprovado", self.staff)
        s2, e2 = future_slot(hour=21)
        services.create_block(self.field, s2, e2, "Chuva", self.staff)
        self.login(self.staff)
        day = timezone.localtime(self.start).date().isoformat()
        r = self.client.get(f"/api/admin/agenda?field={self.field.pk}&date={day}")
        self.assertEqual(r.status_code, 200)
        slots = r.json()["slots"]
        booked = [s for s in slots if s["state"] == "booked"]
        blocked = [s for s in slots if s["state"] == "blocked"]
        self.assertEqual(booked[0]["booking"]["id"], b.pk)
        self.assertEqual(blocked[0]["block"]["reason"], "Chuva")
        # o bloqueio traz id e o intervalo inteiro (para "Liberar horário" no /reservar/)
        block = TimeBlock.objects.get()
        self.assertEqual(blocked[0]["block"]["id"], block.pk)
        self.assertEqual(blocked[0]["block"]["start"], timezone.localtime(s2).isoformat())
        self.assertEqual(blocked[0]["block"]["end"], timezone.localtime(e2).isoformat())
        text = r.content.decode()
        self.assertNotIn("99911", text)
        self.assertNotIn("Zeca", text)

    def test_agenda_bad_params(self):
        self.login(self.staff)
        day = timezone.localtime(self.start).date().isoformat()
        for q in ["", f"date={day}", f"field={self.field.pk}", f"field=x&date={day}",
                  f"field={self.field.pk}&date=zz"]:
            self.assertEqual(self.client.get(f"/api/admin/agenda?{q}").status_code, 400, q)
        self.assertEqual(
            self.client.get(f"/api/admin/agenda?field=99999&date={day}").status_code, 404)
