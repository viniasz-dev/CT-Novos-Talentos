from django.db import models


class Notification(models.Model):
    class Channel(models.TextChoices):
        EMAIL = "email", "E-mail"
        WHATSAPP = "whatsapp", "WhatsApp"

    class Status(models.TextChoices):
        SENT = "enviado", "Enviado"
        FAILED = "falhou", "Falhou"
        IGNORED = "ignorado", "Ignorado"

    booking = models.ForeignKey("bookings.BookingRequest", null=True, blank=True,
                                on_delete=models.SET_NULL, related_name="notifications")
    channel = models.CharField(max_length=10, choices=Channel.choices)
    kind = models.CharField(max_length=20)
    status = models.CharField(max_length=10, choices=Status.choices)
    error = models.CharField(max_length=200, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]
