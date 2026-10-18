import threading
from unittest import skipUnless

from django.db import connection, connections
from django.test import TestCase, TransactionTestCase

from accounts.models import User
from bookings import services
from bookings.models import BookingRequest, Field

from .helpers import PW, World, future_slot, post_json


class SequentialConflicts(World, TestCase):
    def setUp(self):
        self.make_world()

    def test_second_pending_same_slot_cannot_be_approved(self):
        first = self.make_booking(self.user_a)
        second = self.make_booking(self.user_b)
        s = self.client_for(self.staff)
        r1 = post_json(s, f"/api/admin/bookings/{first.pk}/status", {"status": "aprovado"})
        self.assertEqual(r1.status_code, 200)
        r2 = post_json(s, f"/api/admin/bookings/{second.pk}/status", {"status": "aprovado"})
        self.assertEqual(r2.status_code, 409)
        second.refresh_from_db()
        self.assertEqual(second.status, "pendente")

    def test_block_over_approved_is_409(self):
        b = self.make_booking(self.user_a)
        s = self.client_for(self.staff)
        post_json(s, f"/api/admin/bookings/{b.pk}/status", {"status": "aprovado"})
        r = post_json(s, "/api/admin/blocks", {
            "field": self.field.pk, "start": self.start.isoformat(),
            "end": self.end.isoformat(), "reason": "manutencao"})
        self.assertEqual(r.status_code, 409)

    def test_booking_over_block_is_409(self):
        s = self.client_for(self.staff)
        r = post_json(s, "/api/admin/blocks", {
            "field": self.field.pk, "start": self.start.isoformat(),
            "end": self.end.isoformat(), "reason": "x"})
        self.assertEqual(r.status_code, 201)
        r = post_json(self.client_for(self.user_a), "/api/bookings", self.payload())
        self.assertEqual(r.status_code, 409)

    def test_approve_pending_after_block_created_is_409(self):
        b = self.make_booking(self.user_a)
        s = self.client_for(self.staff)
        post_json(s, "/api/admin/blocks", {
            "field": self.field.pk, "start": self.start.isoformat(),
            "end": self.end.isoformat(), "reason": "x"})
        r = post_json(s, f"/api/admin/bookings/{b.pk}/status", {"status": "aprovado"})
        self.assertEqual(r.status_code, 409)

    def test_inactive_field_create_booking_code(self):
        self.field.active = False
        self.field.save()
        r = post_json(self.client_for(self.user_a), "/api/bookings", self.payload())
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["error"]["code"], "field_inactive")


@skipUnless(connection.vendor == "postgresql", "requer PostgreSQL (select_for_update)")
class ThreadedRace(TransactionTestCase):
    def test_exactly_one_approved(self):
        field = Field.objects.create(name="Campo", price_per_hour="100.00")
        users = [User.objects.create_user(f"u{i}@x.test", PW, name=f"U{i}") for i in range(2)]
        staff = User.objects.create_user("s@x.test", PW, name="S", is_staff=True)
        start, end = future_slot()
        bookings = [services.create_booking(u, field, start, end, "c", "") for u in users]
        results = []

        def approve(b):
            try:
                services.set_status(BookingRequest.objects.get(pk=b.pk), "aprovado", staff)
                results.append("ok")
            except Exception as exc:  # noqa: BLE001
                results.append(f"{type(exc).__name__}: {exc}")
            finally:
                connections.close_all()

        threads = [threading.Thread(target=approve, args=(b,)) for b in bookings]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(results.count("ok"), 1, results)
        self.assertEqual(BookingRequest.objects.filter(status="aprovado").count(), 1)
