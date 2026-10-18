from datetime import timedelta

from django.contrib.sessions.models import Session
from django.test import Client, TestCase

from bookings.models import BookingRequest, TimeBlock

from .helpers import PW, World, post_json


class AuthorizationMatrix(World, TestCase):
    def setUp(self):
        self.make_world()
        self.booking = self.make_booking(self.user_a)
        self.block = TimeBlock.objects.create(
            field=self.field, start=self.start - timedelta(hours=3),
            end=self.start - timedelta(hours=2), created_by=self.staff)

    def admin_routes(self):
        b, k = self.booking.pk, self.block.pk
        return [
            ("get", "/api/admin/bookings"),
            ("post", f"/api/admin/bookings/{b}/status"),
            ("get", f"/api/admin/bookings/{b}/contact"),
            ("get", "/api/admin/blocks"),
            ("post", "/api/admin/blocks"),
            ("delete", f"/api/admin/blocks/{k}"),
            ("get", "/api/admin/agenda"),
        ]

    def protected_routes(self):
        return self.admin_routes() + [
            ("get", "/api/bookings"),
            ("post", "/api/bookings"),
            ("post", f"/api/bookings/{self.booking.pk}/cancel"),
        ]

    def call(self, client, method, url):
        return getattr(client, method)(url, content_type="application/json")

    def test_anonymous_401_everywhere(self):
        c = Client()
        for method, url in self.protected_routes():
            r = self.call(c, method, url)
            self.assertEqual(r.status_code, 401, (method, url))
            self.assertEqual(r.json()["error"]["code"], "not_authenticated")

    def test_non_staff_403_on_every_admin_route(self):
        c = self.client_for(self.user_b)
        for method, url in self.admin_routes():
            r = self.call(c, method, url)
            self.assertEqual(r.status_code, 403, (method, url))
            self.assertEqual(r.json()["error"]["code"], "forbidden")
        self.assertTrue(TimeBlock.objects.filter(pk=self.block.pk).exists())
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, "pendente")

    def test_other_user_cannot_list_see_or_cancel(self):
        b = self.client_for(self.user_b)
        self.assertEqual(b.get("/api/bookings").json()["bookings"], [])
        r = self.call(b, "post", f"/api/bookings/{self.booking.pk}/cancel")
        self.assertEqual(r.status_code, 404)
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, "pendente")
        # inexistente e alheio sao indistinguiveis
        r2 = self.call(b, "post", "/api/bookings/999999/cancel")
        self.assertEqual(r.json(), r2.json())

    def test_owner_sees_and_cancels(self):
        a = self.client_for(self.user_a)
        self.assertEqual(len(a.get("/api/bookings").json()["bookings"]), 1)
        r = self.call(a, "post", f"/api/bookings/{self.booking.pk}/cancel")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["booking"]["status"], "cancelado")

    def test_staff_sees_all(self):
        self.make_booking(self.user_b, self.start + timedelta(hours=1),
                          self.end + timedelta(hours=1))
        s = self.client_for(self.staff)
        r = s.get("/api/admin/bookings")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(r.json()["bookings"]), 2)
        self.assertEqual(s.get(f"/api/admin/bookings/{self.booking.pk}/contact").status_code, 200)

    def test_staff_demoted_loses_access_with_open_session(self):
        s = self.client_for(self.staff)
        self.assertEqual(s.get("/api/admin/bookings").status_code, 200)
        self.staff.is_staff = False
        self.staff.save()
        for method, url in self.admin_routes():
            r = self.call(s, method, url)
            self.assertEqual(r.status_code, 403, (method, url))

    def test_deactivated_user_401_with_open_session(self):
        a = self.client_for(self.user_a)
        self.assertEqual(a.get("/api/bookings").status_code, 200)
        self.user_a.is_active = False
        self.user_a.save()
        self.assertEqual(a.get("/api/bookings").status_code, 401)
        self.assertEqual(post_json(a, "/api/bookings", self.payload()).status_code, 401)

    def test_deactivated_staff_401(self):
        s = self.client_for(self.staff)
        self.staff.is_active = False
        self.staff.save()
        for method, url in self.admin_routes():
            self.assertEqual(self.call(s, method, url).status_code, 401, (method, url))

    def test_expired_session_401(self):
        a = self.client_for(self.user_a)
        self.assertEqual(a.get("/api/bookings").status_code, 200)
        Session.objects.all().delete()
        self.assertEqual(a.get("/api/bookings").status_code, 401)
        s = self.client_for(self.staff)
        Session.objects.all().delete()
        self.assertEqual(s.get("/api/admin/bookings").status_code, 401)

    def test_login_after_deactivation_fails(self):
        self.user_a.is_active = False
        self.user_a.save()
        r = post_json(Client(), "/api/auth/login",
                      {"email": "a@x.test", "password": PW})
        self.assertEqual(r.status_code, 401)

    def test_booking_row_unchanged_by_forbidden_status_post(self):
        c = self.client_for(self.user_a)
        r = post_json(c, f"/api/admin/bookings/{self.booking.pk}/status",
                      {"status": "aprovado"})
        self.assertEqual(r.status_code, 403)
        self.assertEqual(BookingRequest.objects.get(pk=self.booking.pk).status, "pendente")
