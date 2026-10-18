from django.db import transaction
from django.dispatch import receiver

from bookings.events import booking_event

from .services import notify_booking_event


@receiver(booking_event, dispatch_uid="notifications.booking_event")
def on_booking_event(sender, booking, kind, **kwargs):
    # Só depois do commit: rollback não envia e falha de envio não desfaz a reserva.
    transaction.on_commit(lambda: notify_booking_event(booking, kind), robust=True)
