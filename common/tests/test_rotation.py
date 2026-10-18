from datetime import timedelta
from io import StringIO

from cryptography.fernet import Fernet
from django.core.management import call_command
from django.test import SimpleTestCase, TestCase, override_settings
from django.utils import timezone

from accounts.models import User
from bookings.models import BookingRequest, Field
from common.crypto import (
    DecryptionError,
    EncryptionConfigError,
    check_encryption_config,
    decrypt,
    encrypt,
    rotate_token,
)

K1 = Fernet.generate_key().decode()
K2 = Fernet.generate_key().decode()


class RotateTokenTests(SimpleTestCase):
    def test_rotate_token(self):
        with override_settings(FIELD_ENCRYPTION_KEYS=[K1]):
            token = encrypt("segredo")
        with override_settings(FIELD_ENCRYPTION_KEYS=[K2, K1]):
            new = rotate_token(token)
            self.assertEqual(decrypt(new), "segredo")
        with override_settings(FIELD_ENCRYPTION_KEYS=[K2]):
            self.assertEqual(decrypt(new), "segredo")
        with override_settings(FIELD_ENCRYPTION_KEYS=[K1]):
            with self.assertRaises(DecryptionError):
                decrypt(new)

    def test_rotate_invalid_token(self):
        with override_settings(FIELD_ENCRYPTION_KEYS=[K1]):
            with self.assertRaises(DecryptionError):
                rotate_token("lixo")


class CheckConfigTests(SimpleTestCase):
    def test_missing_keys_fail_in_prod(self):
        with override_settings(DEBUG=False, TESTING=False, FIELD_ENCRYPTION_KEYS=[]):
            with self.assertRaises(EncryptionConfigError):
                check_encryption_config()

    def test_valid_keys_pass(self):
        with override_settings(DEBUG=False, TESTING=False, FIELD_ENCRYPTION_KEYS=[K1, K2]):
            check_encryption_config()

    def test_invalid_key_clear_message(self):
        with override_settings(DEBUG=False, TESTING=False,
                               FIELD_ENCRYPTION_KEYS=["nao-e-fernet"]):
            with self.assertRaises(EncryptionConfigError) as ctx:
                check_encryption_config()
        self.assertIn("invalida", str(ctx.exception))

    def test_skipped_in_debug_and_testing(self):
        with override_settings(DEBUG=True, TESTING=False, FIELD_ENCRYPTION_KEYS=[]):
            check_encryption_config()
        with override_settings(DEBUG=False, TESTING=True, FIELD_ENCRYPTION_KEYS=[]):
            check_encryption_config()


class RotateCommandTests(TestCase):
    def setUp(self):
        with override_settings(FIELD_ENCRYPTION_KEYS=[K1]):
            self.user = User.objects.create_user("a@x.test", "pw-12345-Abc", name="A")
            self.user.phone = "1199"
            self.user.save()
            field = Field.objects.create(name="Q", price_per_hour="150.00")
            now = timezone.now()
            self.b = BookingRequest(user=self.user, field=field, start=now,
                                    end=now + timedelta(hours=1))
            self.b.set_contact("contato")
            self.b.set_message("mensagem")
            self.b.save()
        self.old = (self.user.phone_enc, self.b.contact_enc, self.b.message_enc)

    def run_cmd(self, *args):
        out = StringIO()
        call_command("rotate_encryption", *args, stdout=out)
        return out.getvalue()

    def snapshot(self):
        self.user.refresh_from_db()
        self.b.refresh_from_db()
        return (self.user.phone_enc, self.b.contact_enc, self.b.message_enc)

    def test_rotates_and_is_idempotent(self):
        with override_settings(FIELD_ENCRYPTION_KEYS=[K2, K1]):
            out = self.run_cmd()
            self.assertIn("recifrados: 3", out)
            new = self.snapshot()
            self.assertNotEqual(new, self.old)
            second = self.run_cmd()
            self.assertIn("recifrados: 0", second)
            self.assertEqual(self.snapshot(), new)
        with override_settings(FIELD_ENCRYPTION_KEYS=[K2]):
            self.assertEqual(self.b.get_contact(), "contato")
            self.assertEqual(self.b.get_message(), "mensagem")
            self.assertEqual(self.user.phone, "1199")

    def test_dry_run_changes_nothing(self):
        with override_settings(FIELD_ENCRYPTION_KEYS=[K2, K1]):
            out = self.run_cmd("--dry-run")
            self.assertIn("dry-run", out)
            self.assertIn("recifrados: 3", out)
        self.assertEqual(self.snapshot(), self.old)


class RotateCorruptTokenTests(RotateCommandTests):
    def corrupt(self):
        BookingRequest.objects.filter(pk=self.b.pk).update(contact_enc="lixo")

    def test_corrupt_token_raises_command_error(self):
        from django.core.management.base import CommandError
        self.corrupt()
        with override_settings(FIELD_ENCRYPTION_KEYS=[K2, K1]):
            for args in ((), ("--dry-run",)):
                with self.assertRaises(CommandError) as ctx:
                    self.run_cmd(*args)
                self.assertIn(f"BookingRequest#{self.b.pk}.contact_enc", str(ctx.exception))
                self.assertIn("não decifra com nenhuma chave", str(ctx.exception))
