from django.conf import settings
from django.db import models
from django.db.models import F, Q

from common.crypto import decrypt, encrypt

ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    "pendente": {"aprovado", "recusado", "cancelado"},
    "aprovado": {"cancelado"},
    "recusado": set(),
    "cancelado": set(),
}


class Field(models.Model):
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True, default="")
    price_per_hour = models.DecimalField(max_digits=8, decimal_places=2)
    active = models.BooleanField(default=True)
    photo = models.CharField(max_length=255, blank=True, default="")

    def __str__(self):
        return self.name


class BookingRequest(models.Model):
    class Status(models.TextChoices):
        PENDING = "pendente", "Pendente"
        APPROVED = "aprovado", "Aprovado"
        REJECTED = "recusado", "Recusado"
        CANCELLED = "cancelado", "Cancelado"

    class Kind(models.TextChoices):
        SINGLE = "avulsa", "Avulsa"
        MONTHLY = "mensal", "Mensal"
        TOURNAMENT = "torneio", "Torneio"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                             related_name="bookings")
    field = models.ForeignKey(Field, on_delete=models.PROTECT, related_name="bookings")
    start = models.DateTimeField()
    end = models.DateTimeField()
    status = models.CharField(max_length=10, choices=Status.choices,
                              default=Status.PENDING)
    kind = models.CharField(max_length=10, choices=Kind.choices, default=Kind.SINGLE)
    series = models.CharField(max_length=36, blank=True, default="")
    contact_enc = models.TextField(blank=True, default="")
    message_enc = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    decided_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                   on_delete=models.SET_NULL, related_name="+")

    class Meta:
        constraints = [
            models.CheckConstraint(condition=Q(start__lt=F("end")),
                                   name="booking_start_before_end"),
        ]
        indexes = [models.Index(fields=["field", "start"], name="booking_field_start_idx")]

    def set_contact(self, text: str) -> None:
        self.contact_enc = encrypt(text) if text else ""

    def get_contact(self) -> str:
        return decrypt(self.contact_enc) if self.contact_enc else ""

    def set_message(self, text: str) -> None:
        self.message_enc = encrypt(text) if text else ""

    def get_message(self) -> str:
        return decrypt(self.message_enc) if self.message_enc else ""

    @property
    def contact_masked(self) -> str:
        return "••••••"


class TimeBlock(models.Model):
    field = models.ForeignKey(Field, on_delete=models.CASCADE, related_name="blocks")
    start = models.DateTimeField()
    end = models.DateTimeField()
    reason = models.CharField(max_length=200, blank=True, default="")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                   on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=Q(start__lt=F("end")),
                                   name="block_start_before_end"),
        ]
        indexes = [models.Index(fields=["field", "start"], name="block_field_start_idx")]


class AuditEvent(models.Model):
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                              on_delete=models.SET_NULL, related_name="+")
    action = models.CharField(max_length=60)
    object_type = models.CharField(max_length=60)
    object_id = models.CharField(max_length=40)
    meta = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    @classmethod
    def log(cls, actor, action, obj, **meta) -> "AuditEvent":
        return cls.objects.create(
            actor=actor if getattr(actor, "pk", None) else None,
            action=action,
            object_type=type(obj).__name__,
            object_id=str(obj.pk),
            meta=meta,
        )
