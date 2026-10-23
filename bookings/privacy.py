from common.crypto import DecryptionError
from common.http import ApiError

from .models import AuditEvent, BookingRequest


def reveal_contact(booking: BookingRequest, actor) -> dict:
    """Decifra contato e mensagem para staff ou para o dono do pedido e audita (sem o conteudo no meta)."""
    if not (getattr(actor, "is_staff", False) or booking.user_id == getattr(actor, "pk", None)):
        raise ApiError("forbidden", "Acesso negado.", 403)
    try:
        data = {"contact": booking.get_contact(), "message": booking.get_message()}
    except DecryptionError:
        raise ApiError("decrypt_failed",
                       "Não foi possível decifrar; verifique as chaves.", 409) from None
    AuditEvent.log(actor, "booking.decrypted", booking)
    return data
