from django.utils import timezone

from .models import ALLOWED_TRANSITIONS


def _iso(dt):
    return timezone.localtime(dt).isoformat()


def field_to_dict(field) -> dict:
    return {
        "id": field.id,
        "name": field.name,
        "description": field.description,
        "price_per_hour": str(field.price_per_hour),
        "photo": field.photo,
    }


ALGORITHM = "Fernet (AES-128-CBC + HMAC-SHA256)"
PREVIEW_CHARS = 28


def _preview(token: str):
    return token[:PREVIEW_CHARS] + "…" if token else None


def booking_to_dict(booking, admin: bool = False) -> dict:
    # Contato e mensagem saem como o token Fernet guardado no banco (inútil sem
    # a chave); o texto em claro só sai na rota auditada /contact (staff).
    contact_token = booking.contact_enc or None
    message_token = booking.message_enc or None
    data = {
        "id": booking.id,
        "field": {"id": booking.field_id, "name": booking.field.name},
        "start": _iso(booking.start),
        "end": _iso(booking.end),
        "status": booking.status,
        "status_label": booking.get_status_display(),
        "contact_masked": booking.contact_masked,
        "message_present": bool(booking.message_enc),
        "contact_token": contact_token,
        "message_token": message_token,
        "protected": {
            "algorithm": ALGORITHM,
            "contact_preview": _preview(booking.contact_enc),
            "message_preview": _preview(booking.message_enc),
        },
        "created_at": _iso(booking.created_at),
        # Dono: so antes do inicio (o servidor responde 409 too_late depois).
        "can_cancel": "cancelado" in ALLOWED_TRANSITIONS.get(booking.status, set())
        and (admin or booking.start > timezone.now()),
    }
    if admin:
        u = booking.user
        data["user"] = {"id": u.id, "name": u.name, "email": u.email}
        d = booking.decided_by
        data["decided_by"] = (
            {"id": d.id, "name": d.name, "email": d.email} if d else None
        )
    return data


def block_to_dict(block) -> dict:
    return {
        "id": block.id,
        "field": block.field_id,
        "start": _iso(block.start),
        "end": _iso(block.end),
        "reason": block.reason,
        "created_at": _iso(block.created_at),
    }
