import logging

from django.conf import settings

from .channels import ChannelDisabled, EmailChannel
from .messages import render
from .models import Notification

logger = logging.getLogger(__name__)


def _record(booking, channel, kind, status, error=""):
    try:
        return Notification.objects.create(booking=booking, channel=channel.name,
                                           kind=kind, status=status, error=error)
    except Exception as exc:  # nunca propaga
        logger.warning("notification record failed: %s", type(exc).__name__)
        return None


def _attempt(channel, booking, kind, to, subject, body):
    try:
        channel.send(to, subject, body)
    except ChannelDisabled:
        return _record(booking, channel, kind, "ignorado")
    except Exception as exc:
        name = type(exc).__name__
        logger.warning("notification %s via %s failed: %s", kind, channel.name, name)
        return _record(booking, channel, kind, "falhou", name[:200])
    return _record(booking, channel, kind, "enviado")


def notify_booking_event(booking, kind: str, channels=None) -> list[Notification]:
    """Envia ao cliente (todos os kinds) e à equipe (created). Nunca levanta."""
    results = []
    try:
        subject, body = render(kind, booking)
        recipients = []
        if booking.user.email:
            recipients.append(booking.user.email)
        staff = getattr(settings, "STAFF_NOTIFY_EMAIL", "")
        if kind == "created" and staff:
            recipients.append(staff)
        for channel in channels or [EmailChannel()]:
            for to in recipients:
                results.append(_attempt(channel, booking, kind, to, subject, body))
    except Exception as exc:
        logger.warning("notify_booking_event failed: %s", type(exc).__name__)
    return [n for n in results if n is not None]
