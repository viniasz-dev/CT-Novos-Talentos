from datetime import timedelta
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.test import TestCase
from django.utils import timezone

from accounts.models import User
from bookings.models import ALLOWED_TRANSITIONS, AuditEvent, BookingRequest, Field, TimeBlock


class ModelsTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("a@x.test", "pw-12345-Abc", name="A")
        self.field = Field.objects.create(name="Q", price_per_hour="150.00")
        self.start = timezone.now() + timedelta(days=1)

    def test_booking_start_must_be_before_end(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            BookingRequest.objects.create(
                user=self.user, field=self.field, start=self.start, end=self.start
            )

    def test_block_start_must_be_before_end(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            TimeBlock.objects.create(field=self.field, start=self.start, end=self.start)

    def test_contact_encrypted(self):
        b = BookingRequest(user=self.user, field=self.field, start=self.start,
                           end=self.start + timedelta(hours=1))
        b.set_contact("x")
        b.set_message("oi")
        self.assertNotEqual(b.contact_enc, "x")
        self.assertNotEqual(b.message_enc, "oi")
        self.assertEqual(b.get_contact(), "x")
        self.assertEqual(b.get_message(), "oi")
        self.assertEqual(b.contact_masked, "••••••")

    def test_transitions(self):
        self.assertEqual(ALLOWED_TRANSITIONS, {
            "pendente": {"aprovado", "recusado", "cancelado"},
            "aprovado": {"cancelado"},
            "recusado": set(),
            "cancelado": set(),
        })

    def test_audit_log(self):
        b = BookingRequest.objects.create(
            user=self.user, field=self.field, start=self.start,
            end=self.start + timedelta(hours=1))
        ev = AuditEvent.log(None, "x", b, foo="bar")
        self.assertEqual(ev.object_type, "BookingRequest")
        self.assertEqual(ev.object_id, str(b.pk))
        self.assertEqual(ev.meta, {"foo": "bar"})

    def test_price_rounds(self):
        f = Field.objects.create(name="Z", price_per_hour=Decimal("10.456"))
        f.refresh_from_db()
        self.assertEqual(f.price_per_hour, Decimal("10.46"))
