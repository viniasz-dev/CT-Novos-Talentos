from django.core.cache import cache
import json

from django.test import RequestFactory, TestCase, override_settings

from accounts.api import _client_ip
from accounts.models import User
from accounts.tests.test_api import post


class ClientIpTests(TestCase):
    def ip(self, n, **meta):
        request = RequestFactory().get("/x", **meta)
        with override_settings(TRUSTED_PROXY_COUNT=n):
            return _client_ip(request)

    def test_zero_ignores_spoofed_header(self):
        self.assertEqual(
            self.ip(0, REMOTE_ADDR="10.0.0.1", HTTP_X_FORWARDED_FOR="6.6.6.6"), "10.0.0.1"
        )

    def test_one_uses_rightmost(self):
        self.assertEqual(
            self.ip(1, REMOTE_ADDR="10.0.0.1", HTTP_X_FORWARDED_FOR="6.6.6.6, 203.0.113.9"),
            "203.0.113.9",
        )

    def test_two_uses_second_from_right(self):
        self.assertEqual(
            self.ip(
                2,
                REMOTE_ADDR="10.0.0.1",
                HTTP_X_FORWARDED_FOR="6.6.6.6, 203.0.113.9, 10.1.1.1",
            ),
            "203.0.113.9",
        )

    def test_short_or_missing_header_falls_back(self):
        self.assertEqual(
            self.ip(2, REMOTE_ADDR="10.0.0.1", HTTP_X_FORWARDED_FOR="203.0.113.9"), "10.0.0.1"
        )
        self.assertEqual(self.ip(1, REMOTE_ADDR="10.0.0.1"), "10.0.0.1")


class HardeningTests(TestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)

    def test_non_string_values_400(self):
        for url in ("/api/auth/register", "/api/auth/login"):
            for bad in ([1, 2], 123):
                r = post(
                    self.client,
                    url,
                    {"name": bad, "email": bad, "password": bad, "phone": bad},
                )
                self.assertEqual(r.status_code, 400, (url, bad))

    def test_malformed_json_400(self):
        for url in ("/api/auth/register", "/api/auth/login"):
            r = self.client.post(url, "{nope", content_type="application/json")
            self.assertEqual(r.status_code, 400)
            self.assertEqual(r.json()["error"]["code"], "invalid_json")


class LoginIpThrottleTests(TestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)

    @override_settings(LOGIN_MAX_ATTEMPTS_PER_IP=6)
    def test_one_ip_spraying_many_emails_gets_429(self):
        codes = [
            post(self.client, "/api/auth/login",
                 {"email": f"u{i}@x.com", "password": "Chute-123456"}).status_code
            for i in range(8)
        ]
        self.assertEqual(codes[:6], [401] * 6)
        self.assertEqual(codes[6:], [429, 429])

    @override_settings(LOGIN_MAX_ATTEMPTS_PER_IP=6)
    def test_other_ip_unaffected(self):
        for i in range(7):
            post(self.client, "/api/auth/login",
                 {"email": f"u{i}@x.com", "password": "Chute-123456"})
        r = self.client.post("/api/auth/login",
                             json.dumps({"email": "z@x.com", "password": "Chute-123456"}),
                             content_type="application/json", REMOTE_ADDR="198.51.100.7")
        self.assertEqual(r.status_code, 401)

    def test_email_with_spaces_and_huge_length_works(self):
        for email in ("a b c@x.com", "x" * 400 + "@x.com"):
            r = post(self.client, "/api/auth/login", {"email": email, "password": "Chute-123456"})
            self.assertEqual(r.status_code, 401, email[:20])

    def test_cache_keys_are_safe_for_memcached(self):
        from accounts import throttle
        throttle.hit("login:1.2.3.4:" + "a b" * 200, 60)
        keys = [throttle._full("login:1.2.3.4:" + "a b" * 200)]
        for k in keys:
            self.assertLess(len(k), 250)
            self.assertNotRegex(k, r"[\s\x00-\x1f]")


class PasswordResetThrottleTests(TestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        User.objects.create_user("joao@x.com", "senha-forte-123", name="Joao")

    @override_settings(PASSWORD_RESET_MAX_PER_HOUR=2)
    def test_exceeding_looks_like_success_and_sends_nothing(self):
        from django.core import mail
        results = [self.client.post("/senha/reset/", {"email": "joao@x.com"}) for _ in range(4)]
        for r in results:
            self.assertRedirects(r, "/senha/reset/enviado/")
        self.assertEqual(len(mail.outbox), 2)
