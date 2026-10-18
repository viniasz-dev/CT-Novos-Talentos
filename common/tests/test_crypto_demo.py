import base64
from datetime import datetime

from cryptography.fernet import Fernet
from django.conf import settings
from django.test import SimpleTestCase

from common import crypto, crypto_demo
from common.crypto import DecryptionError

TEXT = "João 😀 (19) 99911-7711"


class DemoFernetTests(SimpleTestCase):
    def test_round_trip(self):
        self.assertEqual(crypto_demo.demo_decrypt(crypto_demo.demo_encrypt(TEXT)), TEXT)

    def test_demo_key_is_not_a_production_key(self):
        keys = [k.encode() if isinstance(k, str) else k for k in settings.FIELD_ENCRYPTION_KEYS]
        self.assertNotIn(crypto_demo._DEMO_KEY, keys)

    def test_demo_token_not_decryptable_with_production_key(self):
        token = crypto_demo.demo_encrypt(TEXT)
        with self.assertRaises(DecryptionError):
            crypto.decrypt(token)

    def test_production_token_not_decryptable_with_demo_key(self):
        token = crypto.encrypt(TEXT)
        with self.assertRaises(DecryptionError):
            crypto_demo.demo_decrypt(token)

    def test_limits(self):
        with self.assertRaises(ValueError):
            crypto_demo.demo_encrypt("x" * 501)
        crypto_demo.demo_encrypt("x" * 500)
        with self.assertRaises(DecryptionError):
            crypto_demo.demo_decrypt("g" * 2001)

    def test_anatomy(self):
        token = crypto_demo.demo_encrypt("ATAQUE")  # 6 bytes -> 16 de texto cifrado
        a = crypto_demo.token_anatomy(token)
        seg = {s["key"]: s for s in a["segments"]}
        self.assertEqual([s["key"] for s in a["segments"]],
                         ["version", "timestamp", "iv", "ciphertext", "hmac"])
        self.assertEqual(seg["version"]["hex"], "80")
        self.assertEqual((seg["timestamp"]["bytes"], seg["iv"]["bytes"],
                          seg["ciphertext"]["bytes"], seg["hmac"]["bytes"]), (8, 16, 16, 32))
        self.assertEqual(a["total_bytes"], 73)
        self.assertEqual(len(seg["iv"]["hex"]), 32)
        self.assertTrue(seg["timestamp"]["iso"].endswith("-03:00"))
        self.assertLess(abs(datetime.fromisoformat(seg["timestamp"]["iso"]).timestamp()
                            - datetime.now().timestamp()), 120)
        self.assertEqual(a["segments"][0]["char_start"], 0)
        self.assertEqual(a["segments"][-1]["char_end"], len(token.rstrip("=")))
        self.assertNotIn("ATAQUE", repr(a))

    def test_anatomy_without_key_works_on_production_tokens(self):
        a = crypto_demo.token_anatomy(crypto.encrypt(TEXT))
        self.assertEqual(a["segments"][0]["hex"], "80")

    def test_anatomy_rejects_malformed(self):
        good = crypto_demo.demo_encrypt("x")
        raw = base64.urlsafe_b64decode(good)
        bad_version = base64.urlsafe_b64encode(b"\x81" + raw[1:]).decode()
        for bad in ("", "nao e token", "abc", good[:40], bad_version, None, 123, "g" * 2001,
                    base64.urlsafe_b64encode(raw + b"x").decode()):
            with self.subTest(bad=str(bad)[:20]), self.assertRaises(ValueError):
                crypto_demo.token_anatomy(bad)

    def test_tamper_breaks_hmac(self):
        token = crypto_demo.demo_encrypt(TEXT)
        out = crypto_demo.tamper(token)
        self.assertNotEqual(out["token"], token)
        self.assertEqual(len(out["token"]), len(token))
        self.assertEqual(token[:out["changed_at"]], out["token"][:out["changed_at"]])
        with self.assertRaises(DecryptionError):
            crypto_demo.demo_decrypt(out["token"])

    def test_fernet_reference_format(self):
        # O formato de anatomia bate com um token gerado pela biblioteca com chave qualquer.
        token = Fernet(Fernet.generate_key()).encrypt(b"a" * 16).decode()
        seg = {s["key"]: s for s in crypto_demo.token_anatomy(token)["segments"]}
        self.assertEqual(seg["ciphertext"]["bytes"], 32)  # 16 bytes + bloco de padding PKCS7
