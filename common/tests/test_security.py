import json
import os
import secrets
import subprocess
import sys
from pathlib import Path

from cryptography.fernet import Fernet
from django.test import Client, TestCase

from bookings.models import TimeBlock

from .helpers import CONTACT, MESSAGE, PW, World, post_json

BASE_DIR = Path(__file__).resolve().parent.parent.parent
BIG = "99999999999999999999999"
BIG_INT = 99999999999999999999999


def assert_json_4xx(test, response, ctx=""):
    test.assertGreaterEqual(response.status_code, 400, ctx)
    test.assertLess(response.status_code, 500, (ctx, response.content[:200]))
    test.assertIn("application/json", response["Content-Type"], ctx)
    test.assertIn("error", response.json(), ctx)


class CsrfTests(World, TestCase):
    def setUp(self):
        self.make_world()
        self.booking = self.make_booking(self.user_a)

    def token(self, client):
        client.get("/api/csrf")
        return client.cookies["csrftoken"].value

    def assert_csrf_failed(self, r):
        self.assertEqual(r.status_code, 403)
        self.assertIn("application/json", r["Content-Type"])
        self.assertEqual(r.json()["error"]["code"], "csrf_failed")

    def test_csrf_endpoint_sets_cookie(self):
        c = Client(enforce_csrf_checks=True)
        r = c.get("/api/csrf")
        self.assertEqual(r.status_code, 204)
        self.assertIn("csrftoken", r.cookies)

    def test_anonymous_posts_without_token_403(self):
        c = Client(enforce_csrf_checks=True)
        for url, body in [
            ("/api/auth/login", {"email": "a@x.test", "password": PW}),
            ("/api/auth/register", {"name": "N", "email": "n@x.test",
                                    "password": PW, "phone": "1"}),
            ("/api/auth/logout", {}),
        ]:
            self.assert_csrf_failed(post_json(c, url, body))

    def test_login_and_register_with_token_work(self):
        c = Client(enforce_csrf_checks=True)
        t = self.token(c)
        r = post_json(c, "/api/auth/login", {"email": "a@x.test", "password": PW},
                      HTTP_X_CSRFTOKEN=t)
        self.assertEqual(r.status_code, 200)
        c2 = Client(enforce_csrf_checks=True)
        t2 = self.token(c2)
        r = post_json(c2, "/api/auth/register", {
            "name": "N", "email": "n@x.test", "password": PW, "phone": "11999990000"},
            HTTP_X_CSRFTOKEN=t2)
        self.assertEqual(r.status_code, 201)

    def test_bookings_and_cancel_csrf(self):
        c = self.client_for(self.user_b, enforce_csrf_checks=True)
        self.assert_csrf_failed(post_json(c, "/api/bookings", self.payload()))
        self.assert_csrf_failed(post_json(
            self.client_for(self.user_a, enforce_csrf_checks=True),
            f"/api/bookings/{self.booking.pk}/cancel", {}))
        t = self.token(c)
        r = post_json(c, "/api/bookings", self.payload(), HTTP_X_CSRFTOKEN=t)
        self.assertEqual(r.status_code, 201)
        a = self.client_for(self.user_a, enforce_csrf_checks=True)
        ta = self.token(a)
        r = post_json(a, f"/api/bookings/{self.booking.pk}/cancel", {}, HTTP_X_CSRFTOKEN=ta)
        self.assertEqual(r.status_code, 200)

    def test_admin_posts_and_delete_csrf(self):
        block = TimeBlock.objects.create(
            field=self.field, start=self.start.replace(hour=20),
            end=self.start.replace(hour=21), created_by=self.staff)
        s = self.client_for(self.staff, enforce_csrf_checks=True)
        b = self.booking.pk
        self.assert_csrf_failed(post_json(s, f"/api/admin/bookings/{b}/status",
                                          {"status": "aprovado"}))
        self.assert_csrf_failed(post_json(s, "/api/admin/blocks", {}))
        r = s.delete(f"/api/admin/blocks/{block.pk}")
        self.assert_csrf_failed(r)
        self.assertTrue(TimeBlock.objects.filter(pk=block.pk).exists())
        t = self.token(s)
        r = post_json(s, f"/api/admin/bookings/{b}/status", {"status": "aprovado"},
                      HTTP_X_CSRFTOKEN=t)
        self.assertEqual(r.status_code, 200)
        r = s.delete(f"/api/admin/blocks/{block.pk}", HTTP_X_CSRFTOKEN=t)
        self.assertEqual(r.status_code, 204)

    def test_no_csrf_exempt_anywhere(self):
        for rel in ("accounts", "bookings", "common", "config", "site_pages"):
            for path in (BASE_DIR / rel).rglob("*.py"):
                if "tests" in path.parts:
                    continue
                self.assertNotIn("csrf_exempt", path.read_text(encoding="utf-8"), str(path))


class LeakTests(World, TestCase):
    FORBIDDEN = ("password", "phone_enc", "contact_enc", "message_enc")

    def setUp(self):
        self.make_world()
        self.booking = self.make_booking(self.user_a)
        self.user_a.phone = "(19) 98888-1234"
        self.user_a.save()

    def bodies(self):
        a = self.client_for(self.user_a)
        s = self.client_for(self.staff)
        out = [
            a.get("/api/bookings"),
            a.get("/api/auth/me"),
            a.get("/api/fields"),
            a.get(f"/api/availability?field={self.field.pk}&date={self.start.date()}"),
            post_json(Client(), "/api/auth/login", {"email": "a@x.test", "password": PW}),
            post_json(self.client_for(self.user_b), "/api/bookings", self.payload(
                start=self.start.replace(hour=21).isoformat(),
                end=self.start.replace(hour=22).isoformat())),
            s.get("/api/admin/bookings"),
            s.get("/api/admin/blocks"),
            s.get(f"/api/admin/agenda?field={self.field.pk}&date={self.start.date()}"),
            post_json(s, f"/api/admin/bookings/{self.booking.pk}/status",
                      {"status": "aprovado"}),
            s.get(f"/api/admin/bookings/{self.booking.pk}/cipher"),
            s.get("/api/admin/stats"),
            post_json(Client(), "/api/crypto/demo",
                      {"cipher": "fernet", "action": "decrypt", "text": self.booking.contact_enc}),
            post_json(Client(), "/api/crypto/demo",
                      {"cipher": "fernet", "action": "tamper", "text": self.booking.contact_enc}),
        ]
        return [r.content.decode() for r in out]

    def test_tokens_shown_instead_of_mask(self):
        token = self.booking.contact_enc
        a = self.client_for(self.user_a).get("/api/bookings").content.decode()
        s = self.client_for(self.staff).get("/api/admin/bookings").content.decode()
        self.assertIn(token, a)
        self.assertIn(token, s)

    def test_no_secret_fields_or_cleartext(self):
        for body in self.bodies():
            for word in self.FORBIDDEN:
                self.assertNotIn(word, body)
            self.assertNotIn(CONTACT, body)
            self.assertNotIn(MESSAGE, body)
            self.assertNotIn("98888-1234", body)

    def test_only_contact_route_reveals_cleartext(self):
        s = self.client_for(self.staff)
        r = s.get(f"/api/admin/bookings/{self.booking.pk}/contact")
        self.assertEqual(r.json()["contact"], CONTACT)

    def test_session_cookie_httponly(self):
        c = Client()
        r = post_json(c, "/api/auth/login", {"email": "a@x.test", "password": PW})
        cookie = r.cookies["sessionid"]
        self.assertTrue(cookie["httponly"])
        self.assertEqual(cookie["samesite"], "Lax")

    def test_ciphertext_in_db_not_cleartext(self):
        self.booking.refresh_from_db()
        self.assertNotIn(CONTACT, self.booking.contact_enc)
        self.assertNotIn(MESSAGE, self.booking.message_enc)


class XssTests(World, TestCase):
    SCRIPT = "<script>alert(1)</script>"

    def setUp(self):
        self.make_world()

    def test_script_contact_round_trips_inert_json(self):
        a = self.client_for(self.user_a)
        r = post_json(a, "/api/bookings", self.payload(contact=self.SCRIPT,
                                                        message=self.SCRIPT))
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r["Content-Type"].split(";")[0], "application/json")
        # mascarado, nunca devolve a entrada
        self.assertNotIn("<script>", r.content.decode())
        s = self.client_for(self.staff)
        pk = r.json()["booking"]["id"]
        rc = s.get(f"/api/admin/bookings/{pk}/contact")
        self.assertEqual(rc["Content-Type"].split(";")[0], "application/json")
        self.assertEqual(json.loads(rc.content)["contact"], self.SCRIPT)
        # X-Content-Type-Options evita sniffing do corpo JSON como HTML
        self.assertEqual(rc["X-Content-Type-Options"], "nosniff")

    def test_pages_do_not_echo_input(self):
        c = Client()
        payload = "%3Cscript%3Ealert(1)%3C/script%3E"
        rendered = 0
        for url in ("/", "/sobre/", "/servicos/", "/contato/", "/entrar/", "/cadastro/",
                    "/reservar/", "/minhas-reservas/", "/painel/"):
            for qs in (f"?next={payload}", f"?q={payload}&x={payload}"):
                r = c.get(url + qs)  # sem follow: so confere paginas que renderizam
                if r.status_code in (301, 302):
                    self.assertNotIn("<script>", r["Location"], (url, qs))
                    continue
                self.assertEqual(r.status_code, 200, (url, qs))
                rendered += 1
                self.assertNotIn("<script>alert(1)", r.content.decode(), (url, qs))
        self.assertGreater(rendered, 0)



class ExtremeInputTests(World, TestCase):
    def setUp(self):
        self.make_world()
        self.a = self.client_for(self.user_a)
        self.s = self.client_for(self.staff)

    def test_extreme_availability_dates(self):
        f = self.field.pk
        for qs in (
            f"date=9999-12-31", "date=0001-01-01", "date=9999-12-30",
            "from=9999-12-20&to=9999-12-31", "from=0001-01-01&to=0001-01-10",
            "from=9999-12-31&to=9999-12-31", "from=0001-01-01&to=0001-01-01",
            "date=2026-13-45", "date=%00", "from=9999-12-01&to=9999-12-31",
        ):
            r = Client().get(f"/api/availability?field={f}&{qs}")
            assert_json_4xx(self, r, qs)
            self.assertEqual(r.status_code, 400, qs)
            self.assertEqual(r.json()["error"]["code"], "invalid_date", qs)

    def test_availability_extreme_dates_are_4xx(self):
        # 9999-12-31 nao pode ser processado (overflow de +1 dia): 4xx JSON
        f = self.field.pk
        r = Client().get(f"/api/availability?field={f}&date=9999-12-31")
        assert_json_4xx(self, r, "date=9999-12-31")

    def test_availability_to_before_from_400(self):
        r = Client().get(f"/api/availability?field={self.field.pk}"
                         "&from=2026-11-10&to=2026-11-01")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["error"]["code"], "bad_range")

    def test_availability_range_too_long_400(self):
        r = Client().get(f"/api/availability?field={self.field.pk}"
                         "&from=2026-11-01&to=2027-03-01")
        self.assertEqual(r.status_code, 400)

    def test_booking_extreme_datetimes(self):
        for start, end in [
            ("0001-01-01T00:00:00+14:00", "0001-01-01T01:00:00+14:00"),
            ("9999-12-31T23:00:00-12:00", "9999-12-31T23:59:00-12:00"),
            ("9999-12-31T23:00:00-12:00", "9999-12-31T23:59:59.999999-12:00"),
            ("0001-01-01T00:00:00+14:00", "9999-12-31T23:00:00-12:00"),
            ("0001-01-01T00:00:00+00:00", "0001-01-01T00:00:00+00:00"),
            ("2026-02-30T10:00:00-03:00", "2026-02-30T11:00:00-03:00"),
        ]:
            r = post_json(self.a, "/api/bookings", self.payload(start=start, end=end))
            assert_json_4xx(self, r, (start, end))

    def test_block_extreme_datetimes(self):
        for start, end in [
            ("0001-01-01T00:00:00+14:00", "0001-01-01T01:00:00+14:00"),
            ("9999-12-31T23:00:00-12:00", "9999-12-31T23:59:00-12:00"),
            ("0001-01-01T00:00:00+14:00", "9999-12-31T23:00:00-12:00"),
        ]:
            r = post_json(self.s, "/api/admin/blocks", {
                "field": self.field.pk, "start": start, "end": end, "reason": "x"})
            self.assertEqual(r.status_code, 400, (start, end, r.content[:200]))
            self.assertEqual(r.json()["error"]["code"], "invalid_datetime", (start, end))

    def test_admin_extreme_date_filters(self):
        for qs in ("date=9999-12-31", "date=0001-01-01"):
            for base in ("/api/admin/bookings?", "/api/admin/blocks?"):
                r = self.s.get(base + qs)
                self.assertEqual(r.status_code, 400, (base, qs))
                self.assertEqual(r.json()["error"]["code"], "invalid_date", (base, qs))
        for qs in ("date=9999-12-31", "date=0001-01-01"):
            r = self.s.get(f"/api/admin/agenda?field={self.field.pk}&{qs}")
            self.assertEqual(r.status_code, 400, qs)
            self.assertEqual(r.json()["error"]["code"], "invalid_date", qs)

    def test_huge_int_query_params_public(self):
        for url in (
            f"/api/availability?field={BIG}&date=2026-11-02",
            f"/api/availability?field={BIG}&from=2026-11-01&to=2026-11-05",
        ):
            r = Client().get(url)
            assert_json_4xx(self, r, url)

    def test_huge_int_query_params_admin(self):
        for url in (
            f"/api/admin/bookings?field={BIG}",
            f"/api/admin/blocks?field={BIG}",
            f"/api/admin/agenda?field={BIG}&date=2026-11-02",
            f"/api/admin/bookings?field=-{BIG}",
        ):
            r = self.s.get(url)
            assert_json_4xx(self, r, url)
            self.assertEqual(r.status_code, 400, url)
            self.assertEqual(r.json()["error"]["code"], "invalid_field", url)

    def test_giant_digit_strings_are_400(self):
        giant = "9" * 5000
        for client, url in (
            (self.s, f"/api/admin/bookings?field={giant}"),
            (self.s, f"/api/admin/blocks?field={giant}"),
            (self.s, f"/api/admin/agenda?field={giant}&date=2026-11-02"),
            (Client(), f"/api/availability?field={giant}&date=2026-11-02"),
            (Client(), f"/api/availability?field={giant}&from=2026-11-01&to=2026-11-05"),
        ):
            r = client.get(url)
            self.assertEqual(r.status_code, 400, url[:60])
            self.assertEqual(r.json()["error"]["code"], "invalid_field", url[:60])
        # JSON: inteiro gigante (json.loads recusa) e string gigante
        for client, url, body in (
            (self.a, "/api/bookings", '{"field": %s}' % giant),
            (self.s, "/api/admin/blocks", '{"field": %s}' % giant),
        ):
            r = client.post(url, body, content_type="application/json")
            self.assertEqual(r.status_code, 400, url)
            self.assertIn(r.json()["error"]["code"], ("invalid_json", "invalid_field"), url)
        for client, url in ((self.a, "/api/bookings"), (self.s, "/api/admin/blocks")):
            r = post_json(client, url, self.payload(field=giant))
            self.assertEqual(r.status_code, 400, url)
            self.assertEqual(r.json()["error"]["code"], "invalid_field", url)

    def test_huge_int_json_bodies(self):
        r = post_json(self.a, "/api/bookings", self.payload(field=BIG_INT))
        assert_json_4xx(self, r, "booking field")
        r = post_json(self.s, "/api/admin/blocks", {
            "field": BIG_INT, "start": self.start.isoformat(),
            "end": self.end.isoformat(), "reason": "x"})
        assert_json_4xx(self, r, "block field")
        r = post_json(self.s, "/api/admin/blocks", {
            "field": -BIG_INT, "start": self.start.isoformat(),
            "end": self.end.isoformat(), "reason": "x"})
        assert_json_4xx(self, r, "block field neg")

    def test_huge_int_in_path(self):
        for method, url in [
            ("post", f"/api/bookings/{BIG}/cancel"),
            ("post", f"/api/admin/bookings/{BIG}/status"),
            ("get", f"/api/admin/bookings/{BIG}/contact"),
            ("delete", f"/api/admin/blocks/{BIG}"),
        ]:
            client = self.a if url.startswith("/api/bookings") else self.s
            kw = {"data": '{"status": "aprovado"}'} if method == "post" else {}
            r = getattr(client, method)(url, content_type="application/json", **kw)
            self.assertEqual(r.status_code, 404, (method, url, r.status_code))

    def test_garbage_bodies_never_500(self):
        for body in ("", "null", "[]", "123", "{", '{"field": []}', '"x"'):
            for url, client in (("/api/bookings", self.a), ("/api/admin/blocks", self.s),
                                ("/api/admin/bookings/1/status", self.s),
                                ("/api/auth/login", Client()), ("/api/auth/register", Client())):
                r = client.post(url, body, content_type="application/json")
                self.assertEqual(r.status_code, 400, (url, body))
                self.assertIn("code", r.json()["error"], (url, body))
                if not body.startswith('{"'):
                    self.assertEqual(r.json()["error"]["code"], "invalid_json", (url, body))


class DeployCheckTests(TestCase):
    def test_check_deploy_has_no_errors(self):
        scrub = ("DEBUG", "SECRET_KEY", "FIELD_ENCRYPTION_KEYS", "ALLOWED_HOSTS",
                 "CSRF_TRUSTED_ORIGINS", "DATABASE_URL", "TRUSTED_PROXY_COUNT")
        env = {k: v for k, v in os.environ.items()
               if k not in scrub and not k.startswith(("SECURE_", "EMAIL_", "SESSION_",
                                                       "CSRF_", "DJANGO_"))}
        env.update({
            "DEBUG": "false",
            "SECRET_KEY": secrets.token_urlsafe(60)[:60],
            "FIELD_ENCRYPTION_KEYS": Fernet.generate_key().decode(),
            "ALLOWED_HOSTS": "example.com",
            "CSRF_TRUSTED_ORIGINS": "https://example.com",
        })
        proc = subprocess.run(
            [sys.executable, "manage.py", "check", "--deploy", "--fail-level", "ERROR"],
            cwd=BASE_DIR, env=env, capture_output=True, text=True, timeout=120)
        output = proc.stdout + proc.stderr
        self.assertEqual(proc.returncode, 0, output)
        for level in ("(security.E", "ERROR:", "CRITICAL:"):
            self.assertNotIn(level, output)
        # avisos (se houver) ficam visiveis no log do teste
        if "WARNINGS" in output:
            print("\n[check --deploy warnings]\n" + output)
