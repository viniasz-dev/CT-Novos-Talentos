import json
from datetime import datetime

from django.http import JsonResponse
from django.test import RequestFactory, SimpleTestCase

from common.http import (
    ApiError,
    api,
    csrf_failure,
    json_error,
    parse_aware_datetime,
    parse_date,
    read_json,
)


def make_request(body=b"", method="POST", path="/api/x/"):
    rf = RequestFactory()
    return rf.generic(method, path, data=body, content_type="application/json")


class ReadJsonTests(SimpleTestCase):
    def test_valid_object(self):
        self.assertEqual(read_json(make_request(b'{"a": 1}')), {"a": 1})

    def test_rejects_bad_bodies(self):
        for body in (b"", b"[]", b"{bad", b'"texto"'):
            with self.subTest(body=body):
                with self.assertRaises(ApiError) as ctx:
                    read_json(make_request(body))
                self.assertEqual(ctx.exception.code, "invalid_json")
                self.assertEqual(ctx.exception.status, 400)


class ParseTests(SimpleTestCase):
    def test_aware_datetime_ok(self):
        dt = parse_aware_datetime("2026-10-20T19:00:00-03:00")
        self.assertIsInstance(dt, datetime)
        self.assertIsNotNone(dt.utcoffset())

    def test_aware_datetime_rejects(self):
        for value in ("2026-10-20T19:00:00", 123, None, "lixo", "2026-10-20"):
            with self.subTest(value=value):
                with self.assertRaises(ApiError) as ctx:
                    parse_aware_datetime(value)
                self.assertEqual(ctx.exception.code, "invalid_datetime")
                self.assertEqual(ctx.exception.status, 400)

    def test_parse_date(self):
        self.assertEqual(parse_date("2026-10-20").isoformat(), "2026-10-20")
        for value in ("20/10/2026", 5, None, "2026-13-40"):
            with self.subTest(value=value):
                with self.assertRaises(ApiError) as ctx:
                    parse_date(value)
                self.assertEqual(ctx.exception.code, "invalid_date")


class ErrorFormatTests(SimpleTestCase):
    def test_json_error_shape(self):
        resp = json_error("boom", "Mensagem", 422, {"campo": "ruim"})
        self.assertIsInstance(resp, JsonResponse)
        self.assertEqual(resp.status_code, 422)
        self.assertEqual(
            json.loads(resp.content),
            {"error": {"code": "boom", "message": "Mensagem", "fields": {"campo": "ruim"}}},
        )

    def test_json_error_default_fields(self):
        data = json.loads(json_error("x", "y", 400).content)
        self.assertEqual(data["error"]["fields"], {})


class ApiDecoratorTests(SimpleTestCase):
    def test_405_for_wrong_method(self):
        @api(["GET"])
        def view(request):
            return JsonResponse({"ok": True})

        resp = view(make_request(b"", method="POST"))
        self.assertEqual(resp.status_code, 405)
        self.assertEqual(json.loads(resp.content)["error"]["code"], "method_not_allowed")

    def test_allowed_method_passes(self):
        @api(["GET"])
        def view(request):
            return JsonResponse({"ok": True})

        self.assertEqual(view(make_request(b"", method="GET")).status_code, 200)

    def test_api_error_converted(self):
        @api(["POST"])
        def view(request):
            raise ApiError("nope", "Nao", 409, {"f": "x"})

        resp = view(make_request(b"{}"))
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(json.loads(resp.content)["error"]["code"], "nope")


class CsrfFailureTests(SimpleTestCase):
    def test_api_path_json(self):
        resp = csrf_failure(make_request(b"{}", path="/api/x/"))
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(json.loads(resp.content)["error"]["code"], "csrf_failed")

    def test_other_path_html(self):
        resp = csrf_failure(make_request(b"{}", path="/entrar/"))
        self.assertEqual(resp.status_code, 403)
        self.assertIn("text/html", resp["Content-Type"])


class LoggingConfigTests(SimpleTestCase):
    def test_request_and_security_errors_reach_console(self):
        from django.conf import settings
        for name in ("django.request", "django.security"):
            cfg = settings.LOGGING["loggers"][name]
            self.assertEqual(cfg["level"], "ERROR")
            self.assertIn("console", cfg["handlers"])
