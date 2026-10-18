from cryptography.fernet import Fernet
from django.test import SimpleTestCase, override_settings

from common.crypto import (
    DecryptionError,
    EncryptionConfigError,
    decrypt,
    encrypt,
)

K1 = Fernet.generate_key().decode()
K2 = Fernet.generate_key().decode()
TEXT = "João 😀 (19) 99911-7711"


@override_settings(FIELD_ENCRYPTION_KEYS=[K1])
class CryptoTests(SimpleTestCase):
    def test_round_trip(self):
        self.assertEqual(decrypt(encrypt(TEXT)), TEXT)

    def test_ciphertext_differs(self):
        self.assertNotEqual(encrypt(TEXT), TEXT)

    def test_two_ciphers_differ(self):
        self.assertNotEqual(encrypt(TEXT), encrypt(TEXT))

    def test_tampered_token(self):
        token = encrypt(TEXT)
        bad = token[:-4] + ("AAAA" if token[-4:] != "AAAA" else "BBBB")
        with self.assertRaises(DecryptionError):
            decrypt(bad)

    def test_garbage_token(self):
        with self.assertRaises(DecryptionError):
            decrypt("nao-e-um-token")

    def test_rotation(self):
        token = encrypt(TEXT)
        with override_settings(FIELD_ENCRYPTION_KEYS=[K2, K1]):
            self.assertEqual(decrypt(token), TEXT)
            new = encrypt(TEXT)  # cifra com K2 (primeira)
        with override_settings(FIELD_ENCRYPTION_KEYS=[K2]):
            self.assertEqual(decrypt(new), TEXT)

    def test_empty_keys(self):
        with override_settings(FIELD_ENCRYPTION_KEYS=[]):
            with self.assertRaises(EncryptionConfigError):
                encrypt(TEXT)
