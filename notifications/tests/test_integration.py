from django.core import mail
from django.db import transaction
from django.test import override_settings

from bookings import services
from common.tests.helpers import World, post_json
from notifications.models import Notification

from .base import NOW, Base


@override_settings(STAFF_NOTIFY_EMAIL="equipe@x.com")
class IntegrationTests(Base):
    def test_create_sends_after_commit(self):
        with self.captureOnCommitCallbacks(execute=True) as cbs:
            self.book()
        self.assertEqual(len(cbs), 1)
        self.assertEqual(len(mail.outbox), 2)
        self.assertEqual(Notification.objects.filter(status="enviado").count(), 2)

    def test_not_sent_before_commit(self):
        with self.captureOnCommitCallbacks(execute=False):
            self.book()
        self.assertEqual(len(mail.outbox), 0)

    def test_approve_notifies_only_client(self):
        booking = self.book()
        with self.captureOnCommitCallbacks(execute=True):
            services.set_status(booking, "aprovado", self.staff, now=NOW)
        # o pedido criado antes do bloco não envia (sem executar callbacks); só a aprovação
        self.assertEqual([m.to for m in mail.outbox], [["ana@x.com"]])
        self.assertEqual(Notification.objects.filter(kind="approved").count(), 1)

    def test_rollback_sends_nothing(self):
        with self.captureOnCommitCallbacks(execute=True) as cbs:
            try:
                with transaction.atomic():
                    self.book()
                    raise RuntimeError("boom")
            except RuntimeError:
                pass
        self.assertEqual(cbs, [])
        self.assertEqual(len(mail.outbox), 0)

    @override_settings(EMAIL_BACKEND="notifications.tests.backends.Boom")
    def test_smtp_failure_keeps_booking(self):
        with self.assertLogs("notifications", level="WARNING") as logs:
            with self.captureOnCommitCallbacks(execute=True):
                booking = self.book()
        booking.refresh_from_db()
        self.assertEqual(booking.status, "pendente")
        rows = list(Notification.objects.all())
        self.assertEqual(len(rows), 2)
        for n in rows:
            self.assertEqual((n.status, n.error), ("falhou", "SMTPException"))
        blob = "\n".join(logs.output) + "".join(n.error for n in rows)
        self.assertNotIn("abc", blob)


@override_settings(EMAIL_BACKEND="notifications.tests.backends.Timeout")
class SmtpTimeoutApiTests(World, Base):
    def test_timeout_records_failure_and_api_returns_201(self):
        self.make_world()
        client = self.client_for(self.user_a)
        with self.assertLogs("notifications", level="WARNING"):
            with self.captureOnCommitCallbacks(execute=True):
                r = post_json(client, "/api/bookings", self.payload())
        self.assertEqual(r.status_code, 201)
        rows = list(Notification.objects.all())
        self.assertTrue(rows)
        for n in rows:
            self.assertEqual((n.status, n.error), ("falhou", "TimeoutError"))

    def test_email_timeout_setting_default(self):
        from django.conf import settings
        self.assertEqual(settings.EMAIL_TIMEOUT, 10)
