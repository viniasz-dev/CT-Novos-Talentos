from django.utils import timezone

_KINDS = {
    "created": ("Pedido de reserva recebido", "Recebemos seu pedido de reserva."),
    "approved": ("Reserva aprovada", "Sua reserva foi aprovada."),
    "rejected": ("Reserva recusada", "Sua reserva foi recusada."),
    "cancelled": ("Reserva cancelada", "Sua reserva foi cancelada."),
}


def render(kind: str, booking) -> tuple[str, str]:
    """Assunto e corpo em pt-BR. Só campo, data, horário e status."""
    if kind not in _KINDS:
        raise ValueError(f"tipo desconhecido: {kind}")
    subject, intro = _KINDS[kind]
    start = timezone.localtime(booking.start)
    end = timezone.localtime(booking.end)
    body = (
        f"{intro}\n\n"
        f"Campo: {booking.field.name}\n"
        f"Data: {start:%d/%m/%Y}\n"
        f"Horário: {start:%H:%M} às {end:%H:%M}\n"
        f"Status: {booking.get_status_display()}\n\n"
        "CT Novos Talentos"
    )
    return f"{subject} - CT Novos Talentos", body
