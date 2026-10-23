import uuid
from datetime import date, datetime, timedelta, timezone as dt_timezone

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from common.http import ApiError

from .events import booking_event
from .models import ALLOWED_TRANSITIONS, AuditEvent, BookingRequest, Field, TimeBlock

CONTACT_MAX = 120
MESSAGE_MAX = 500
MAX_RANGE_DAYS = 31


class BookingError(ApiError):
    status = 400

    def __init__(self, code: str, message: str, fields: dict | None = None):
        super().__init__(code, message, self.status, fields)


class ValidationFailed(BookingError):
    status = 400


class Conflict(BookingError):
    status = 409


class Forbidden(BookingError):
    status = 403


# --- helpers -----------------------------------------------------------------


def _now(now):
    return now if now is not None else timezone.now()


def _is_aware(value) -> bool:
    return (isinstance(value, datetime) and value.tzinfo is not None
            and value.utcoffset() is not None)


def _is_staff(actor) -> bool:
    return bool(getattr(actor, "is_staff", False))


def _require_staff(actor) -> None:
    if not _is_staff(actor):
        raise Forbidden("forbidden", "Você não tem permissão para esta ação.")


def _local(value: datetime) -> datetime:
    return timezone.localtime(value, timezone.get_current_timezone())


def _lock_field(field: Field) -> Field:
    return Field.objects.select_for_update().get(pk=field.pk)


def _check_range(start, end) -> None:
    if not _is_aware(start) or not _is_aware(end):
        raise ValidationFailed(
            "naive_datetime", "Informe data e hora com fuso horário.")
    if end <= start:
        raise ValidationFailed(
            "invalid_range", "O horário final deve ser depois do inicial.")


def _clean_text(value, max_len: int, code: str, label: str, required: bool) -> str:
    if not isinstance(value, str):
        raise ValidationFailed(code, f"{label} inválido.")
    text = value.strip()
    if required and not text:
        raise ValidationFailed(code, f"Informe {label.lower()}.")
    if len(text) > max_len:
        raise ValidationFailed(
            code, f"{label} deve ter no máximo {max_len} caracteres.")
    return text


# --- regras ------------------------------------------------------------------


def validate_window(field: Field, start: datetime, end: datetime,
                    now: datetime | None = None, max_hours: int | None = None) -> None:
    if not field.active:
        raise ValidationFailed("field_inactive", "Este campo não está disponível.")
    _check_range(start, end)
    ls, le = _local(start), _local(end)
    for moment in (ls, le):
        if moment.minute or moment.second or moment.microsecond:
            raise ValidationFailed(
                "not_aligned", "Os horários devem ser em hora cheia.")
    hours = (end - start) / timedelta(hours=1)
    limit = max_hours or settings.BOOKING_MAX_HOURS
    if hours > limit:
        raise ValidationFailed(
            "bad_duration", f"A reserva pode ter de 1 a {limit} horas.")
    if start <= _now(now):
        raise ValidationFailed("in_past", "Escolha um horário no futuro.")
    hours_of_day = settings.BUSINESS_HOURS.get(ls.weekday())
    closed = ValidationFailed("closed", "O campo está fechado neste horário.")
    if hours_of_day is None or le.date() != ls.date():  # sem expediente ou cruza meia-noite
        raise closed
    opens, closes = hours_of_day
    if ls.hour < opens or le.hour > closes:
        raise closed


def find_conflicts(field: Field, start, end, exclude_booking_id: int | None = None) -> dict:
    bookings = BookingRequest.objects.filter(
        field=field, status=BookingRequest.Status.APPROVED,
        start__lt=end, end__gt=start)
    if exclude_booking_id is not None:
        bookings = bookings.exclude(pk=exclude_booking_id)
    blocks = TimeBlock.objects.filter(field=field, start__lt=end, end__gt=start)
    return {"bookings": list(bookings.order_by("start")),
            "blocks": list(blocks.order_by("start"))}


def _raise_on_conflicts(field, start, end, exclude_booking_id=None) -> None:
    found = find_conflicts(field, start, end, exclude_booking_id)
    if found["bookings"]:
        raise Conflict("slot_taken", "Este horário já está reservado.",
                       {"conflicts": [b.pk for b in found["bookings"]]})
    if found["blocks"]:
        raise Conflict("blocked", "Este horário está bloqueado.")


def _emit(booking, kind, actor, audit_action, notify=True) -> None:
    AuditEvent.log(actor, audit_action, booking, field=booking.field_id,
                   status=booking.status)
    if not notify:
        return
    booking_event.send(sender=BookingRequest, booking=booking, kind=kind, actor=actor)


# --- escrita -----------------------------------------------------------------


STAFF_CANNOT_BOOK = 'A equipe não faz reservas; use "Bloquear horário".'


MONTHLY_WEEKS = 4
TOURNAMENT_MAX_RANGES = 20


def create_booking_series(user, field: Field, start: datetime | None, end: datetime | None,
                          contact: str, message: str = "", kind: str = "avulsa",
                          ranges: list | None = None,
                          now: datetime | None = None) -> list[BookingRequest]:
    """avulsa: 1 pedido; mensal: mesmo horário por 4 semanas; torneio: lista livre de
    períodos `ranges` [(start, end)], de qualquer duração dentro do expediente. Tudo ou
    nada; a equipe é avisada uma vez só (1º pedido)."""
    if kind == "avulsa":
        return [create_booking(user, field, start, end, contact, message, now=now)]
    if kind == "mensal":
        items = [(start + timedelta(weeks=i), end + timedelta(weeks=i))
                 for i in range(MONTHLY_WEEKS)]
    elif kind == "torneio":
        items = sorted(ranges or [])
        if not 1 <= len(items) <= TOURNAMENT_MAX_RANGES:
            raise ValidationFailed(
                "bad_ranges",
                f"Torneio: escolha de 1 a {TOURNAMENT_MAX_RANGES} períodos.")
    else:
        raise ValidationFailed("invalid_kind", "Tipo de reserva inválido.")
    series, out = str(uuid.uuid4()), []
    with transaction.atomic():
        for i, (s, e) in enumerate(items):
            try:
                out.append(create_booking(user, field, s, e, contact, message, now=now,
                                          kind=kind, series=series, notify=i == 0))
            except BookingError as exc:
                # ponytail: dia em horário local de SP; refaz a mensagem dizendo qual data falhou
                raise type(exc)(exc.code, f"Dia {_local(s):%d/%m}: {exc.message}",
                                exc.fields) from None
    return out


def create_booking(user, field: Field, start: datetime, end: datetime, contact: str,
                   message: str = "", now: datetime | None = None,
                   kind: str = "avulsa", series: str = "", notify: bool = True
                   ) -> BookingRequest:
    # A equipe tira horários com bloqueios (create_block), nunca com pedidos.
    if _is_staff(user):
        raise Forbidden("staff_cannot_book", STAFF_CANNOT_BOOK)
    contact = _clean_text(contact, CONTACT_MAX, "invalid_contact", "Contato", True)
    message = _clean_text(message if message is not None else "", MESSAGE_MAX,
                          "invalid_message", "Mensagem", False)
    with transaction.atomic():
        locked = _lock_field(field)
        validate_window(locked, start, end, now,
                        max_hours=24 if kind == "torneio" else None)
        _raise_on_conflicts(locked, start, end)
        mine = BookingRequest.objects.filter(
            user=user, field=locked, start__lt=end, end__gt=start,
            status__in=[BookingRequest.Status.PENDING, BookingRequest.Status.APPROVED])
        if mine.exists():
            raise Conflict("duplicate",
                           "Você já tem um pedido neste horário para este campo.")
        booking = BookingRequest(user=user, field=locked, start=start, end=end,
                                 status=BookingRequest.Status.PENDING,
                                 kind=kind, series=series)
        booking.set_contact(contact)
        booking.set_message(message)
        booking.save()
        _emit(booking, "created", user, "booking.created", notify)
    return booking


def _transition(booking, new_status, actor, now, kind, action, *, owner_rules=False):
    with transaction.atomic():
        locked_field = _lock_field(booking.field)
        booking.refresh_from_db()
        booking.field = locked_field
        if new_status not in ALLOWED_TRANSITIONS.get(booking.status, set()):
            raise Conflict("invalid_transition",
                           "Esta mudança de estado não é permitida.")
        if owner_rules and not _is_staff(actor) and _now(now) >= booking.start:
            raise Conflict("too_late",
                           "Não é possível cancelar depois do início do horário.")
        if new_status == BookingRequest.Status.APPROVED:
            validate_window(locked_field, booking.start, booking.end, now)
            _raise_on_conflicts(locked_field, booking.start, booking.end,
                                exclude_booking_id=booking.pk)
            booking.decided_by = actor
        elif new_status == BookingRequest.Status.REJECTED:
            booking.decided_by = actor
        booking.status = new_status
        booking.save()
        _emit(booking, kind, actor, action)
    return booking


def set_status(booking: BookingRequest, new_status: str, actor,
               now: datetime | None = None) -> BookingRequest:
    _require_staff(actor)
    kinds = {"aprovado": ("approved", "booking.approved"),
             "recusado": ("rejected", "booking.rejected"),
             "cancelado": ("cancelled", "booking.cancelled")}
    if new_status not in kinds:
        raise Conflict("invalid_transition", "Esta mudança de estado não é permitida.")
    kind, action = kinds[new_status]
    return _transition(booking, new_status, actor, now, kind, action)


def cancel_booking(booking: BookingRequest, actor,
                   now: datetime | None = None) -> BookingRequest:
    if not _is_staff(actor) and booking.user_id != getattr(actor, "pk", None):
        raise Forbidden("forbidden", "Você não tem permissão para esta ação.")
    return _transition(booking, BookingRequest.Status.CANCELLED, actor, now,
                       "cancelled", "booking.cancelled", owner_rules=True)


def create_block(field: Field, start: datetime, end: datetime, reason: str, actor,
                 now: datetime | None = None) -> TimeBlock:
    _require_staff(actor)
    _check_range(start, end)
    reason = reason.strip() if isinstance(reason, str) else ""
    if len(reason) > 200:
        raise ValidationFailed("invalid_reason",
                               "O motivo deve ter no máximo 200 caracteres.")
    with transaction.atomic():
        locked = _lock_field(field)
        approved = find_conflicts(locked, start, end)["bookings"]
        if approved:
            raise Conflict("slot_taken",
                           "Existem reservas aprovadas neste intervalo.",
                           {"conflicts": [b.pk for b in approved]})
        block = TimeBlock.objects.create(field=locked, start=start, end=end,
                                         reason=reason, created_by=actor)
        AuditEvent.log(actor, "block.created", block, field=locked.pk)
    return block


def delete_block(block: TimeBlock, actor) -> None:
    _require_staff(actor)
    with transaction.atomic():
        _lock_field(block.field)
        AuditEvent.log(actor, "block.deleted", block, field=block.field_id)
        block.delete()


# --- disponibilidade ---------------------------------------------------------


def _day_bounds(day: date):
    tz = timezone.get_current_timezone()
    start = datetime(day.year, day.month, day.day, tzinfo=tz)
    nxt = day + timedelta(days=1)
    return start, datetime(nxt.year, nxt.month, nxt.day, tzinfo=tz)


def _slots(day: date, now, approved, blocks) -> dict:
    hours = settings.BUSINESS_HOURS.get(day.weekday())
    if hours is None:
        return {"open": False, "slots": []}
    tz = timezone.get_current_timezone()
    slots = []
    for hour in range(hours[0], hours[1]):
        s = datetime(day.year, day.month, day.day, hour, tzinfo=tz)
        # aritmética em UTC para não depender de fold/DST
        s_utc = s.astimezone(dt_timezone.utc)
        e_utc = s_utc + timedelta(hours=1)
        e = e_utc.astimezone(tz)
        if s <= now:
            state = "past"
        elif any(b.start < e_utc and b.end > s_utc for b in approved):
            state = "booked"
        elif any(b.start < e_utc and b.end > s_utc for b in blocks):
            state = "blocked"
        else:
            state = "free"
        slots.append({"start": s.isoformat(),
                      "end": e.isoformat(), "state": state})
    return {"open": True, "slots": slots}


def _load(field, lo, hi):
    approved = list(BookingRequest.objects.filter(
        field=field, status=BookingRequest.Status.APPROVED, start__lt=hi, end__gt=lo))
    blocks = list(TimeBlock.objects.filter(field=field, start__lt=hi, end__gt=lo))
    return approved, blocks


def day_slots(field: Field, day: date, now: datetime | None = None) -> dict:
    lo, hi = _day_bounds(day)
    approved, blocks = _load(field, lo, hi)
    return _slots(day, _now(now), approved, blocks)


def month_overview(field: Field, date_from: date, date_to: date,
                   now: datetime | None = None) -> dict[str, dict]:
    if date_to < date_from or (date_to - date_from) > timedelta(days=MAX_RANGE_DAYS):
        raise ValidationFailed(
            "bad_range",
            f"O intervalo deve ter no máximo {MAX_RANGE_DAYS} dias.")
    current = _now(now)
    lo, _ = _day_bounds(date_from)
    _, hi = _day_bounds(date_to)
    approved, blocks = _load(field, lo, hi)
    out = {}
    day = date_from
    while day <= date_to:
        info = _slots(day, current, approved, blocks)
        out[day.isoformat()] = {
            "open": info["open"],
            "free": sum(1 for s in info["slots"] if s["state"] == "free"),
            "total": len(info["slots"]),
        }
        day += timedelta(days=1)
    return out
