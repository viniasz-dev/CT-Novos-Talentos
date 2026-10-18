from django.db import connection
from django.test import TestCase

from accounts.models import User
from accounts.serializers import user_to_dict


class UserModelTests(TestCase):
    def test_create_user_normalizes_email_and_hashes_password(self):
        user = User.objects.create_user("Joao@X.com", "senha-forte-123", name="Joao")
        user.refresh_from_db()
        self.assertEqual(user.email, "joao@x.com")
        self.assertNotEqual(user.password, "senha-forte-123")
        self.assertTrue(user.check_password("senha-forte-123"))
        self.assertTrue(user.is_active)
        self.assertFalse(user.is_staff)

    def test_phone_round_trip_and_encrypted_at_rest(self):
        user = User.objects.create_user("a@b.com", "senha-forte-123", name="A")
        user.phone = "(19) 99911-7711"
        user.save()
        user.refresh_from_db()
        self.assertEqual(user.phone, "(19) 99911-7711")
        with connection.cursor() as cur:
            cur.execute("SELECT phone_enc FROM accounts_user WHERE id = %s", [user.id])
            raw = cur.fetchone()[0]
        self.assertNotEqual(raw, "(19) 99911-7711")
        self.assertNotIn("99911", raw)

    def test_phone_empty(self):
        user = User.objects.create_user("e@b.com", "senha-forte-123")
        self.assertEqual(user.phone, "")

    def test_create_superuser(self):
        admin = User.objects.create_superuser("Adm@X.com", "senha-forte-123", name="Adm")
        self.assertTrue(admin.is_staff)
        self.assertTrue(admin.is_superuser)

    def test_user_to_dict(self):
        user = User.objects.create_user("d@b.com", "senha-forte-123", name="D")
        self.assertEqual(
            user_to_dict(user),
            {"id": user.id, "name": "D", "email": "d@b.com", "is_staff": False},
        )
