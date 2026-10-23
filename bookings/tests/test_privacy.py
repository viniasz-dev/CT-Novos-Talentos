from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from accounts.models import User
from bookings.models import AuditEvent, BookingRequest, Field
from bookings.privacy import reveal_contact
from common.http import ApiError


class RevealContactTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("a@x.test", "pw-12345-Abc", name="A")
        self.staff = User.objects.create_user("s@x.test", "pw-12345-Abc", name="S")
        self.staff.is_staff = True
        self.staff.save()
        field = Field.objects.create(name="Q", price_per_hour="150.00")
        now = timezone.now()
        self.b = BookingRequest(user=self.user, field=field, start=now,
                                end=now + timedelta(hours=1))
        self.b.set_contact("(19) 99911-7711")
        self.b.set_message("Aniversário às 19h")
        self.b.save()

    def test_staff_reveals_and_audits(self):
        data = reveal_contact(self.b, self.staff)
        self.assertEqual(data, {"contact": "(19) 99911-7711",
                                "message": "Aniversário às 19h"})
        ev = AuditEvent.objects.get(action="booking.decrypted")
        self.assertEqual(ev.actor, self.staff)
        self.assertEqual(ev.object_id, str(self.b.pk))
        self.assertNotIn("99911", str(ev.meta))
        self.assertNotIn("Aniversário", str(ev.meta))

    def test_owner_can_reveal_and_is_audited(self):
        self.assertEqual(reveal_contact(self.b, self.b.user)["contact"], self.b.get_contact())
        self.assertEqual(AuditEvent.objects.filter(action="booking.decrypted").count(), 1)

    def test_non_staff_forbidden_no_event(self):
        from accounts.models import User
        stranger = User.objects.create_user("outro@x.test", "Senha-forte-123", name="Outro")
        with self.assertRaises(ApiError) as ctx:
            reveal_contact(self.b, stranger)
        self.assertEqual(ctx.exception.code, "forbidden")
        self.assertEqual(ctx.exception.status, 403)
        self.assertEqual(AuditEvent.objects.count(), 0)

    def test_corrupt_token_is_409_not_500(self):
        self.b.contact_enc = "lixo-nao-e-token"
        self.b.save()
        with self.assertRaises(ApiError) as ctx:
            reveal_contact(self.b, self.staff)
        self.assertEqual((ctx.exception.status, ctx.exception.code), (409, "decrypt_failed"))
        self.assertEqual(AuditEvent.objects.count(), 0)
