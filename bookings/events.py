from django.dispatch import Signal

# kwargs: booking, kind (created|approved|rejected|cancelled), actor
booking_event = Signal()
