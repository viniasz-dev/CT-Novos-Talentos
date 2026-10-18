from datetime import datetime, timedelta, timezone as dt_tz

from django.test import TestCase

from accounts.models import User
from bookings.models import BookingRequest, Field
from bookings.serializers import booking_to_dict


class SerializerTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("a@x.test", "pw-12345-Abc", name="A")
        self.field = Field.objects.create(name="Q", price_per_hour="150.00")
        start = datetime(2030, 1, 7, 21, 0, tzinfo=dt_tz.utc)  # 18:00 em SP
        self.b = BookingRequest(user=self.user, field=self.field, start=start,
                                end=start + timedelta(hours=1))
        self.b.set_contact("11999998888")
        self.b.set_message("segredo-msg")
        self.b.save()

    def test_no_plaintext(self):
        for admin in (False, True):
            d = booking_to_dict(self.b, admin=admin)
            s = repr(d)
            self.assertNotIn("11999998888", s)
            self.assertNotIn("segredo-msg", s)
            self.assertEqual(d["contact_masked"], "••••••")
            self.assertTrue(d["message_present"])

    def test_tokens_for_owner_and_admin(self):
        for admin in (False, True):
            d = booking_to_dict(self.b, admin=admin)
            self.assertEqual(d["contact_token"], self.b.contact_enc)
            self.assertEqual(d["message_token"], self.b.message_enc)
            self.assertTrue(d["contact_token"].startswith("gAAAAA"))
            self.assertIn("AES-128-CBC", d["protected"]["algorithm"])
            preview = d["protected"]["contact_preview"]
            self.assertEqual(preview, self.b.contact_enc[:28] + "…")
            # contact_masked continua por compatibilidade; a UI não o mostra mais.
            self.assertEqual(d["contact_masked"], "••••••")

    def test_tokens_null_when_empty(self):
        self.b.message_enc = ""
        d = booking_to_dict(self.b)
        self.assertIsNone(d["message_token"])
        self.assertIsNone(d["protected"]["message_preview"])
        self.assertFalse(d["message_present"])

    def test_admin_fields(self):
        self.assertNotIn("user", booking_to_dict(self.b))
        d = booking_to_dict(self.b, admin=True)
        self.assertEqual(d["user"]["email"], "a@x.test")
        self.assertIsNone(d["decided_by"])

    def test_offset(self):
        d = booking_to_dict(self.b)
        self.assertTrue(d["start"].startswith("2030-01-07T18:00:00"))
        self.assertTrue(d["start"].endswith("-03:00"))
        self.assertEqual(d["field"], {"id": self.field.id, "name": "Q"})
        self.assertEqual(d["status_label"], "Pendente")


class CanCancelTests(SerializerTests):
    def test_owner_cannot_cancel_started_booking_but_admin_can(self):
        self.b.status = "aprovado"
        self.b.start = datetime(2020, 1, 7, 21, 0, tzinfo=dt_tz.utc)
        self.b.end = self.b.start + timedelta(hours=1)
        self.assertFalse(booking_to_dict(self.b)["can_cancel"])
        self.assertTrue(booking_to_dict(self.b, admin=True)["can_cancel"])

    def test_status_and_future_rules(self):
        self.assertTrue(booking_to_dict(self.b)["can_cancel"])
        for status, expected in (("aprovado", True), ("recusado", False), ("cancelado", False)):
            self.b.status = status
            self.assertEqual(booking_to_dict(self.b)["can_cancel"], expected, status)
            self.assertEqual(booking_to_dict(self.b, admin=True)["can_cancel"], expected, status)
