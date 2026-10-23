import json

from django.core.cache import cache
from django.test import Client, TestCase, override_settings

from common import crypto, crypto_demo
from common.tests.helpers import CONTACT, MESSAGE, World, post_json

URL = "/api/crypto/demo"


def demo(client, **body):
    return post_json(client, URL, body)


class CryptoDemoApiTests(TestCase):
    def setUp(self):
        cache.clear()
        self.c = Client()

    def test_caesar_encrypt_with_steps(self):
        r = demo(self.c, cipher="caesar", action="encrypt", text="ATAQUE", shift=3)
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertEqual(data["result"], "DWDTXH")
        self.assertEqual(len(data["steps"]), 6)
        self.assertEqual(data["steps"][0]["out"], "D")

    def test_caesar_decrypt(self):
        r = demo(self.c, cipher="caesar", action="decrypt", text="DWDTXH", shift=3)
        self.assertEqual(r.json()["result"], "ATAQUE")
        self.assertEqual(r.json()["steps"][0]["out"], "A")

    def test_caesar_bruteforce(self):
        r = demo(self.c, cipher="caesar", action="bruteforce", text="DWDTXH")
        data = r.json()
        self.assertEqual(len(data["candidates"]), 25)
        self.assertIn("ATAQUE", [c["text"] for c in data["candidates"]])
        self.assertEqual(data["best_shift"], 3)

    def test_vigenere(self):
        r = demo(self.c, cipher="vigenere", action="encrypt", text="ATTACKATDAWN", key="LEMON")
        self.assertEqual(r.json()["result"], "LXFOPVEFRNHR")
        r = demo(self.c, cipher="vigenere", action="decrypt", text="LXFOPVEFRNHR", key="LEMON")
        self.assertEqual(r.json()["result"], "ATTACKATDAWN")

    def test_substitution_and_transposition_round_trip(self):
        for cipher, key in (("substitution", "futebol"), ("transposition", "campo")):
            enc = demo(self.c, cipher=cipher, action="encrypt", text="Reserva do campo 7", key=key).json()
            self.assertNotEqual(enc["result"], "Reserva do campo 7")
            dec = demo(self.c, cipher=cipher, action="decrypt", text=enc["result"], key=key).json()
            self.assertEqual(dec["result"], "Reserva do campo 7")
        r = demo(self.c, cipher="transposition", action="encrypt", text="abc", key="a")
        self.assertEqual(r.status_code, 400)

    def test_fernet_round_trip_and_tamper(self):
        r = demo(self.c, cipher="fernet", action="encrypt", text="Olá, CT!")
        token = r.json()["result"]
        self.assertTrue(token.startswith("gAAAAA"))
        self.assertEqual(len(r.json()["anatomy"]["segments"]), 5)
        r = demo(self.c, cipher="fernet", action="decrypt", text=token)
        self.assertEqual(r.json()["result"], "Olá, CT!")
        r = demo(self.c, cipher="fernet", action="tamper", text=token)
        self.assertEqual(r.status_code, 200)
        bad = r.json()["result"]
        self.assertFalse(r.json()["decrypt_ok"])
        self.assertNotEqual(bad, token)
        r = demo(self.c, cipher="fernet", action="decrypt", text=bad)
        self.assertEqual((r.status_code, r.json()["error"]["code"]), (400, "decrypt_failed"))

    def test_fernet_demo_never_uses_production_key(self):
        real = crypto.encrypt(CONTACT)
        r = demo(self.c, cipher="fernet", action="decrypt", text=real)
        self.assertEqual(r.json()["error"]["code"], "decrypt_failed")
        self.assertNotIn(CONTACT, r.content.decode())
        token = demo(self.c, cipher="fernet", action="encrypt", text="x").json()["result"]
        self.assertEqual(crypto_demo.demo_decrypt(token), "x")
        with self.assertRaises(crypto.DecryptionError):
            crypto.decrypt(token)

    def test_validation_errors(self):
        cases = [
            ({}, "invalid_cipher"),
            ({"cipher": "rot47", "action": "encrypt", "text": "a"}, "invalid_cipher"),
            ({"cipher": ["caesar"], "action": "encrypt", "text": "a"}, "invalid_cipher"),
            ({"cipher": "caesar", "action": "tamper", "text": "a", "shift": 3}, "invalid_action"),
            ({"cipher": "vigenere", "action": "bruteforce", "text": "a", "key": "a"}, "invalid_action"),
            ({"cipher": "fernet", "action": "bruteforce", "text": "a"}, "invalid_action"),
            ({"cipher": "caesar", "action": "encrypt", "text": "", "shift": 3}, "invalid_text"),
            ({"cipher": "caesar", "action": "encrypt", "text": 5, "shift": 3}, "invalid_text"),
            ({"cipher": "caesar", "action": "encrypt", "text": "a" * 501, "shift": 3}, "invalid_text"),
            ({"cipher": "caesar", "action": "encrypt", "text": "a", "shift": 0}, "invalid_shift"),
            ({"cipher": "caesar", "action": "encrypt", "text": "a", "shift": 26}, "invalid_shift"),
            ({"cipher": "caesar", "action": "encrypt", "text": "a", "shift": "3"}, "invalid_shift"),
            ({"cipher": "caesar", "action": "encrypt", "text": "a", "shift": True}, "invalid_shift"),
            ({"cipher": "caesar", "action": "encrypt", "text": "a", "shift": 3.5}, "invalid_shift"),
            ({"cipher": "caesar", "action": "encrypt", "text": "a", "shift": 10**30}, "invalid_shift"),
            ({"cipher": "vigenere", "action": "encrypt", "text": "a"}, "invalid_key"),
            ({"cipher": "vigenere", "action": "encrypt", "text": "a", "key": "a b"}, "invalid_key"),
            ({"cipher": "vigenere", "action": "encrypt", "text": "a", "key": "x" * 33}, "invalid_key"),
            ({"cipher": "fernet", "action": "encrypt", "text": "a" * 501}, "invalid_text"),
            ({"cipher": "fernet", "action": "decrypt", "text": "nao-e-token"}, "invalid_token"),
            ({"cipher": "fernet", "action": "tamper", "text": "gAAAAA"}, "invalid_token"),
            ({"cipher": "fernet", "action": "decrypt", "text": "g" * 2001}, "invalid_token"),
        ]
        for body, code in cases:
            with self.subTest(body=str(body)[:80]):
                r = post_json(self.c, URL, body)
                self.assertEqual(r.status_code, 400, r.content)
                self.assertEqual(r.json()["error"]["code"], code)

    def test_invalid_json_and_method(self):
        r = self.c.post(URL, "[1]", content_type="application/json")
        self.assertEqual(r.json()["error"]["code"], "invalid_json")
        self.assertEqual(self.c.get(URL).status_code, 405)

    def test_csrf_enforced(self):
        c = Client(enforce_csrf_checks=True)
        r = c.post(URL, json.dumps({"cipher": "caesar", "action": "encrypt", "text": "a",
                                    "shift": 3}), content_type="application/json")
        self.assertEqual((r.status_code, r.json()["error"]["code"]), (403, "csrf_failed"))

    @override_settings(CRYPTO_DEMO_MAX_PER_MINUTE=3)
    def test_throttled_per_ip(self):
        body = dict(cipher="caesar", action="encrypt", text="a", shift=3)
        for _ in range(3):
            self.assertEqual(demo(self.c, **body).status_code, 200)
        r = demo(self.c, **body)
        self.assertEqual((r.status_code, r.json()["error"]["code"]), (429, "rate_limited"))
        other = Client(REMOTE_ADDR="10.0.0.9")
        self.assertEqual(demo(other, **body).status_code, 200)


class BookingCipherApiTests(World, TestCase):
    def setUp(self):
        self.make_world()
        self.booking = self.make_booking()

    def url(self, pk=None):
        return f"/api/admin/bookings/{pk or self.booking.pk}/cipher"

    def test_authz_matrix(self):
        self.assertEqual(Client().get(self.url()).status_code, 401)
        self.assertEqual(self.client_for(self.user_a).get(self.url()).status_code, 403)
        self.assertEqual(self.client_for(self.staff).get(self.url(999999)).status_code, 404)
        self.assertEqual(self.client_for(self.staff).post(self.url()).status_code, 405)

    def test_staff_gets_full_tokens_and_anatomy_no_plaintext(self):
        r = self.client_for(self.staff).get(self.url())
        data = r.json()
        self.assertEqual(data["contact_token"], self.booking.contact_enc)
        self.assertEqual(data["message_token"], self.booking.message_enc)
        self.assertEqual(data["anatomy"]["contact"]["segments"][0]["hex"], "80")
        self.assertIn("AES-128-CBC", data["algorithm"])
        body = r.content.decode()
        self.assertNotIn(CONTACT, body)
        self.assertNotIn(MESSAGE, body)

    def test_corrupt_or_empty_token_no_500(self):
        self.booking.contact_enc = "lixo"
        self.booking.message_enc = ""
        self.booking.save()
        data = self.client_for(self.staff).get(self.url()).json()
        self.assertIsNone(data["anatomy"]["contact"])
        self.assertIsNone(data["message_token"])

    def test_no_audit_event(self):
        from bookings.models import AuditEvent
        self.client_for(self.staff).get(self.url())
        self.assertFalse(AuditEvent.objects.filter(action="booking.decrypted").exists())
