import json

from django.contrib.auth.models import AnonymousUser
from django.core.cache import cache
from django.http import JsonResponse
from django.test import RequestFactory, TestCase

from accounts.decorators import login_required_json, staff_required_json
from accounts.models import User

PW = "senha-forte-123"


def post(client, url, data):
    return client.post(url, json.dumps(data), content_type="application/json")


class ApiTestCase(TestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)


class RegisterTests(ApiTestCase):
    def payload(self, **kw):
        d = {"name": "Joao", "email": "joao@x.com", "password": PW, "phone": "19999990000"}
        d.update(kw)
        return d

    def test_register_creates_user_logs_in(self):
        r = post(self.client, "/api/auth/register", self.payload())
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.json()["user"]["email"], "joao@x.com")
        user = User.objects.get(email="joao@x.com")
        self.assertEqual(user.phone, "19999990000")
        self.assertNotIn("19999990000", user.phone_enc)
        self.assertEqual(self.client.get("/api/auth/me").json()["user"]["email"], "joao@x.com")

    def test_response_never_leaks_secrets(self):
        r = post(self.client, "/api/auth/register", self.payload())
        text = r.content.decode()
        self.assertNotIn("phone_enc", text)
        self.assertNotIn("pbkdf2", text)
        self.assertNotIn("password", text)

    def test_weak_password(self):
        r = post(self.client, "/api/auth/register", self.payload(password="123"))
        self.assertEqual(r.status_code, 400)
        self.assertIn("password", r.json()["error"]["fields"])

    def test_missing_fields(self):
        r = post(self.client, "/api/auth/register", {})
        self.assertEqual(r.status_code, 400)
        fields = r.json()["error"]["fields"]
        for f in ("name", "email", "password", "phone"):
            self.assertIn(f, fields)

    def test_invalid_email(self):
        r = post(self.client, "/api/auth/register", self.payload(email="nope"))
        self.assertEqual(r.status_code, 400)
        self.assertIn("email", r.json()["error"]["fields"])

    def test_duplicate_email_case_insensitive(self):
        post(self.client, "/api/auth/register", self.payload(email="joao@x.com"))
        self.client.post("/api/auth/logout")
        r = post(self.client, "/api/auth/register", self.payload(email="JOAO@X.COM"))
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.json()["error"]["code"], "email_taken")
        r = post(self.client, "/api/auth/register", self.payload(email=" Joao@x.com "))
        self.assertEqual(r.status_code, 409)
        self.assertEqual(User.objects.count(), 1)

    def test_register_throttle_per_ip(self):
        for i in range(10):
            r = post(self.client, "/api/auth/register", self.payload(email=f"u{i}@x.com"))
            self.assertEqual(r.status_code, 201)
        r = post(self.client, "/api/auth/register", self.payload(email="u11@x.com"))
        self.assertEqual(r.status_code, 429)
        self.assertEqual(r.json()["error"]["code"], "too_many_attempts")

    def test_get_not_allowed(self):
        self.assertEqual(self.client.get("/api/auth/register").status_code, 405)


class LoginTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.user = User.objects.create_user("joao@x.com", PW, name="Joao")

    def login(self, email="joao@x.com", password=PW):
        return post(self.client, "/api/auth/login", {"email": email, "password": password})

    def test_login_ok_case_insensitive(self):
        r = self.login(email=" JOAO@x.com ")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["user"]["email"], "joao@x.com")
        self.assertNotIn("phone_enc", r.content.decode())

    def test_same_response_wrong_password_and_unknown_email(self):
        a = self.login(password="errada-errada")
        b = self.login(email="ninguem@x.com")
        self.assertEqual(a.status_code, 401)
        self.assertEqual(a.content, b.content)
        self.assertEqual(a.json()["error"]["code"], "invalid_credentials")

    def test_missing_fields_400(self):
        r = post(self.client, "/api/auth/login", {})
        self.assertEqual(r.status_code, 400)
        self.assertIn("email", r.json()["error"]["fields"])

    def test_sixth_wrong_attempt_blocked_and_correct_too(self):
        for _ in range(5):
            self.assertEqual(self.login(password="errada-errada").status_code, 401)
        r = self.login(password="errada-errada")
        self.assertEqual(r.status_code, 429)
        self.assertEqual(r.json()["error"]["code"], "too_many_attempts")
        self.assertEqual(self.login().status_code, 429)

    def test_success_resets_counter(self):
        for _ in range(4):
            self.login(password="errada-errada")
        self.assertEqual(self.login().status_code, 200)
        for _ in range(5):
            self.assertEqual(self.login(password="errada-errada").status_code, 401)

    def test_other_email_not_blocked(self):
        for _ in range(6):
            self.login(password="errada-errada")
        self.assertEqual(self.login(email="outro@x.com").status_code, 401)

    def test_inactive_user_cannot_login(self):
        self.user.is_active = False
        self.user.save()
        self.assertEqual(self.login().status_code, 401)

    def test_logout_and_me(self):
        self.login()
        self.assertEqual(self.client.get("/api/auth/me").json()["user"]["id"], self.user.id)
        self.assertEqual(self.client.post("/api/auth/logout").status_code, 204)
        r = self.client.get("/api/auth/me")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), {"user": None})

    def test_csrf_endpoint(self):
        r = self.client.get("/api/csrf")
        self.assertEqual(r.status_code, 204)
        self.assertIn("csrftoken", r.cookies)


class DecoratorTests(TestCase):
    def setUp(self):
        self.rf = RequestFactory()

        @login_required_json
        def v1(request):
            return JsonResponse({"ok": True})

        @staff_required_json
        def v2(request):
            return JsonResponse({"ok": True})

        self.v1, self.v2 = v1, v2

    def req(self, user):
        r = self.rf.get("/x")
        r.user = user
        return r

    def test_login_required(self):
        r = self.v1(self.req(AnonymousUser()))
        self.assertEqual(r.status_code, 401)
        self.assertEqual(json.loads(r.content)["error"]["code"], "not_authenticated")
        u = User.objects.create_user("a@x.com", PW, name="A")
        self.assertEqual(self.v1(self.req(u)).status_code, 200)

    def test_staff_required(self):
        self.assertEqual(self.v2(self.req(AnonymousUser())).status_code, 401)
        u = User.objects.create_user("a@x.com", PW, name="A")
        r = self.v2(self.req(u))
        self.assertEqual(r.status_code, 403)
        self.assertEqual(json.loads(r.content)["error"]["code"], "forbidden")
        s = User.objects.create_user("s@x.com", PW, name="S", is_staff=True)
        self.assertEqual(self.v2(self.req(s)).status_code, 200)

    def test_inactive_is_401(self):
        s = User.objects.create_user("s@x.com", PW, name="S", is_staff=True, is_active=False)
        self.assertEqual(self.v2(self.req(s)).status_code, 401)
        self.assertEqual(self.v1(self.req(s)).status_code, 401)
