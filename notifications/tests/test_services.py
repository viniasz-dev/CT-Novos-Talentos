from unittest import mock

from django.core import mail
from django.test import override_settings

from notifications.channels import ChannelDisabled, EmailChannel, WhatsAppChannel
from notifications.models import Notification
from notifications.services import notify_booking_event

from .base import Base


@override_settings(STAFF_NOTIFY_EMAIL="equipe@x.com")
class ServiceTests(Base):
    def test_created_notifies_client_and_staff(self):
        booking = self.book()
        out = notify_booking_event(booking, "created")
        self.assertEqual(len(out), 2)
        self.assertEqual(sorted(m.to[0] for m in mail.outbox),
                         ["ana@x.com", "equipe@x.com"])
        self.assertEqual(Notification.objects.filter(
            channel="email", status="enviado", kind="created").count(), 2)

    def test_approved_only_client(self):
        booking = self.book()
        notify_booking_event(booking, "approved")
        self.assertEqual([m.to for m in mail.outbox], [["ana@x.com"]])

    @override_settings(STAFF_NOTIFY_EMAIL="")
    def test_no_staff_email_skips_staff(self):
        notify_booking_event(self.book(), "created")
        self.assertEqual(len(mail.outbox), 1)

    def test_channel_failure_recorded_class_only(self):
        booking = self.book()
        with mock.patch.object(EmailChannel, "send",
                               side_effect=Exception("senha=abc")):
            with self.assertLogs("notifications", level="WARNING") as logs:
                out = notify_booking_event(booking, "created")
        self.assertTrue(all(n.status == "falhou" and n.error == "Exception" for n in out))
        for n in Notification.objects.all():
            self.assertNotIn("abc", n.error)
        self.assertNotIn("abc", "\n".join(logs.output))

    def test_whatsapp_disabled_is_ignored(self):
        with self.assertRaises(ChannelDisabled):
            WhatsAppChannel().send("+5511", "s", "b")
        booking = self.book()
        out = notify_booking_event(booking, "approved", channels=[WhatsAppChannel()])
        self.assertEqual([(n.channel, n.status) for n in out], [("whatsapp", "ignorado")])
        self.assertEqual(len(mail.outbox), 0)
