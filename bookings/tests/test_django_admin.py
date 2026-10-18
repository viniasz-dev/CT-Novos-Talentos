from datetime import datetime, timedelta

from django.contrib.admin.sites import site
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from accounts.models import User
from bookings import services
from bookings.models import AuditEvent, BookingRequest, Field, TimeBlock

PW = "pw-12345-Abc"


def future_slot(hour=19, days=3):
    tz = timezone.get_current_timezone()
    day = (timezone.now() + timedelta(days=days)).astimezone(tz).date()
    while day.weekday() > 4:
        day += timedelta(days=1)
    start = datetime(day.year, day.month, day.day, hour, tzinfo=tz)
    return start, start + timedelta(hours=1)


class AdminBase(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("c@x.test", PW, name="Cli")
        self.su = User.objects.create_superuser("root@x.test", PW, name="Root")
        self.user2 = User.objects.create_user("c2@x.test", PW, name="Cli Dois")
        self.field = Field.objects.create(name="Campo 1", price_per_hour="150.00")
        self.start, self.end = future_slot()
        self.client.force_login(self.su)

    def booking(self, user=None):
        return services.create_booking(user or self.user, self.field, self.start,
                                       self.end, "(19) 99911-7711", "Aniversario do Zeca")


class BookingAdminTests(AdminBase):
    def test_registered(self):
        for model in (Field, BookingRequest, TimeBlock, AuditEvent):
            self.assertIn(model, site._registry)

    def test_approve_action_skips_conflicts(self):
        a = self.booking()
        b = self.booking(user=self.user2)
        url = reverse("admin:bookings_bookingrequest_changelist")
        r = self.client.post(url, {"action": "approve", "_selected_action": [a.pk, b.pk]},
                             follow=True)
        self.assertEqual(r.status_code, 200)
        a.refresh_from_db()
        b.refresh_from_db()
        self.assertEqual(a.status, "aprovado")
        self.assertEqual(b.status, "pendente")
        self.assertTrue(AuditEvent.objects.filter(action="booking.approved").exists())
        msgs = [str(m) for m in r.context["messages"]]
        self.assertEqual(len(msgs), 2)

    def test_reject_and_cancel_actions(self):
        a = self.booking()
        url = reverse("admin:bookings_bookingrequest_changelist")
        self.client.post(url, {"action": "reject", "_selected_action": [a.pk]}, follow=True)
        a.refresh_from_db()
        self.assertEqual(a.status, "recusado")
        r = self.client.post(url, {"action": "cancel", "_selected_action": [a.pk]},
                             follow=True)
        self.assertEqual(r.status_code, 200)
        a.refresh_from_db()
        self.assertEqual(a.status, "recusado")

    def test_changelist_and_change_hide_contact(self):
        a = self.booking()
        r = self.client.get(reverse("admin:bookings_bookingrequest_changelist"))
        self.assertEqual(r.status_code, 200)
        for page in (r, self.client.get(
                reverse("admin:bookings_bookingrequest_change", args=[a.pk]))):
            self.assertEqual(page.status_code, 200)
            text = page.content.decode()
            self.assertNotIn("99911", text)
            self.assertNotIn("Zeca", text)
            self.assertNotIn(a.contact_enc, text)
            self.assertNotIn(a.message_enc, text)

    def test_filters(self):
        self.booking()
        url = reverse("admin:bookings_bookingrequest_changelist")
        r = self.client.get(url + f"?status__exact=pendente&field__id__exact={self.field.pk}")
        self.assertEqual(r.status_code, 200)

    def test_change_form_cannot_mutate_status(self):
        a = self.booking()
        url = reverse("admin:bookings_bookingrequest_change", args=[a.pk])
        self.client.post(url, {"status": "aprovado"})
        a.refresh_from_db()
        self.assertEqual(a.status, "pendente")

    def test_audit_read_only(self):
        self.booking()
        ev = AuditEvent.objects.first()
        r = self.client.get(reverse("admin:bookings_auditevent_change", args=[ev.pk]))
        self.assertEqual(r.status_code, 200)
        self.assertNotIn(b'name="action"', r.content)
        r = self.client.post(reverse("admin:bookings_auditevent_add"), {})
        self.assertEqual(r.status_code, 403)
        r = self.client.post(reverse("admin:bookings_auditevent_delete", args=[ev.pk]),
                             {"post": "yes"})
        self.assertEqual(r.status_code, 403)


class TimeBlockAdminTests(AdminBase):
    def data(self, start, end):
        ls, le = timezone.localtime(start), timezone.localtime(end)
        return {"field": self.field.pk, "reason": "Chuva",
                "start_0": ls.strftime("%Y-%m-%d"), "start_1": ls.strftime("%H:%M:%S"),
                "end_0": le.strftime("%Y-%m-%d"), "end_1": le.strftime("%H:%M:%S")}

    def test_overlap_with_approved_rejected(self):
        b = self.booking()
        services.set_status(b, "aprovado", self.su)
        r = self.client.post(reverse("admin:bookings_timeblock_add"),
                             self.data(self.start, self.end))
        self.assertEqual(r.status_code, 200)
        self.assertFalse(TimeBlock.objects.exists())
        self.assertContains(r, "errorlist")

    def test_create_via_service_audits(self):
        s, e = future_slot(hour=21)
        r = self.client.post(reverse("admin:bookings_timeblock_add"), self.data(s, e))
        self.assertEqual(r.status_code, 302)
        blk = TimeBlock.objects.get()
        self.assertEqual(blk.created_by, self.su)
        self.assertTrue(AuditEvent.objects.filter(action="block.created").exists())

    def test_delete_via_service_audits(self):
        s, e = future_slot(hour=21)
        blk = services.create_block(self.field, s, e, "x", self.su)
        r = self.client.post(reverse("admin:bookings_timeblock_delete", args=[blk.pk]),
                             {"post": "yes"})
        self.assertEqual(r.status_code, 302)
        self.assertFalse(TimeBlock.objects.exists())
        self.assertTrue(AuditEvent.objects.filter(action="block.deleted").exists())

    def test_bulk_delete_via_service(self):
        s, e = future_slot(hour=21)
        blk = services.create_block(self.field, s, e, "x", self.su)
        self.client.post(reverse("admin:bookings_timeblock_changelist"), {
            "action": "delete_selected", "_selected_action": [blk.pk], "post": "yes"})
        self.assertFalse(TimeBlock.objects.exists())
        self.assertTrue(AuditEvent.objects.filter(action="block.deleted").exists())
