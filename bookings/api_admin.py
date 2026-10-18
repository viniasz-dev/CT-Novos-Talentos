from django.http import HttpResponse, JsonResponse
from django.urls import path
from django.utils import timezone

from accounts.decorators import staff_required_json
from common.http import (
    ApiError, api, int_from_json, int_from_text, parse_aware_datetime, parse_date, read_json,
)

from . import privacy, services
from .models import BookingRequest, Field, TimeBlock
from .serializers import block_to_dict, booking_to_dict

STATUSES = {value for value, _ in BookingRequest.Status.choices}
# Teto do intervalo date_from..date_to da lista do painel (Kanban): no máximo um ano.
MAX_LIST_RANGE_DAYS = 366


def _int(value, name: str, code: str = "invalid_field") -> int:
    # bool e subclasse de int; float/str/None nao sao aceitos
    result = int_from_json(value)
    if result is None:
        raise ApiError(code, f"Valor inválido para {name}.", 400, {name: "Informe um número inteiro."})
    return result


def _query_int(request, name: str):
    raw = request.GET.get(name)
    if raw in (None, ""):
        return None
    value = int_from_text(raw)
    if value is None:
        raise ApiError("invalid_field", f"Valor inválido para {name}.", 400,
                       {name: "Informe um número inteiro."})
    return value


def _query_date(request, name: str = "date"):
    raw = request.GET.get(name)
    if raw in (None, ""):
        return None
    try:
        return parse_date(raw)
    except ApiError as exc:
        raise ApiError(exc.code, exc.message, exc.status, {name: exc.message}) from None


def _day_range(day):
    return services._day_bounds(day)


def _get_field(pk: int) -> Field:
    try:
        return Field.objects.get(pk=pk)
    except Field.DoesNotExist:
        raise ApiError("not_found", "Campo não encontrado.", 404) from None


def _get_booking(pk: int) -> BookingRequest:
    try:
        return BookingRequest.objects.select_related(
            "field", "user", "decided_by").get(pk=pk)
    except BookingRequest.DoesNotExist:
        raise ApiError("not_found", "Pedido não encontrado.", 404) from None


@api(["GET"])
@staff_required_json
def bookings_list(request):
    qs = BookingRequest.objects.select_related("field", "user", "decided_by")
    status = request.GET.get("status")
    if status not in (None, ""):
        if status not in STATUSES:
            raise ApiError("invalid_status", "Status inválido.", 400)
        qs = qs.filter(status=status)
    field_id = _query_int(request, "field")
    if field_id is not None:
        qs = qs.filter(field_id=field_id)
    day = _query_date(request)
    if day is not None:
        lo, hi = _day_range(day)
        qs = qs.filter(start__gte=lo, start__lt=hi)
    # Intervalo de dias (inclusivo, dia local de São Paulo) pelo início da reserva: Kanban.
    date_from = _query_date(request, "date_from")
    date_to = _query_date(request, "date_to")
    if date_from and date_to and date_to < date_from:
        message = "A data final deve ser igual ou depois da inicial."
        raise ApiError("invalid_range", message, 400, {"date_to": message})
    if date_from and date_to and (date_to - date_from).days > MAX_LIST_RANGE_DAYS:
        message = f"O período pode ter no máximo {MAX_LIST_RANGE_DAYS} dias."
        raise ApiError("invalid_range", message, 400, {"date_to": message})
    if date_from is not None:
        qs = qs.filter(start__gte=_day_range(date_from)[0])
    if date_to is not None:
        qs = qs.filter(start__lt=_day_range(date_to)[1])
    qs = qs.order_by("-start", "-id")
    return JsonResponse({"bookings": [booking_to_dict(b, admin=True) for b in qs]})


@api(["POST"])
@staff_required_json
def booking_status(request, pk):
    data = read_json(request)
    status = data.get("status")
    if not isinstance(status, str) or status not in STATUSES:
        raise ApiError("invalid_status", "Status inválido.", 400)
    booking = _get_booking(pk)
    booking = services.set_status(booking, status, request.user)
    booking = _get_booking(booking.pk)
    return JsonResponse({"booking": booking_to_dict(booking, admin=True)})


@api(["GET"])
@staff_required_json
def booking_contact(request, pk):
    booking = _get_booking(pk)
    return JsonResponse(privacy.reveal_contact(booking, request.user))


@api(["GET", "POST"])
@staff_required_json
def blocks(request):
    if request.method == "GET":
        qs = TimeBlock.objects.all()
        field_id = _query_int(request, "field")
        if field_id is not None:
            qs = qs.filter(field_id=field_id)
        day = _query_date(request)
        if day is not None:
            lo, hi = _day_range(day)
            qs = qs.filter(start__lt=hi, end__gt=lo)
        return JsonResponse(
            {"blocks": [block_to_dict(b) for b in qs.order_by("start", "id")]})
    data = read_json(request)
    field_id = _int(data.get("field"), "field")
    start = parse_aware_datetime(data.get("start"))
    end = parse_aware_datetime(data.get("end"))
    reason = data.get("reason", "")
    if reason is None:
        reason = ""
    if not isinstance(reason, str):
        raise ApiError("invalid_reason", "O motivo deve ser um texto.", 400)
    if len(reason.strip()) > 200:
        raise ApiError("invalid_reason", "O motivo deve ter no máximo 200 caracteres.", 400)
    field = _get_field(field_id)
    block = services.create_block(field, start, end, reason, request.user)
    return JsonResponse({"block": block_to_dict(block)}, status=201)


@api(["DELETE"])
@staff_required_json
def block_detail(request, pk):
    try:
        block = TimeBlock.objects.select_related("field").get(pk=pk)
    except TimeBlock.DoesNotExist:
        raise ApiError("not_found", "Bloqueio não encontrado.", 404) from None
    services.delete_block(block, request.user)
    return HttpResponse(status=204)


@api(["GET"])
@staff_required_json
def agenda(request):
    field_id = _query_int(request, "field")
    day = _query_date(request)
    fields = {}
    if field_id is None:
        fields["field"] = "Campo obrigatório."
    if day is None:
        fields["date"] = "Data obrigatória."
    if fields:
        raise ApiError("invalid_params", "Informe campo e data.", 400, fields)
    field = _get_field(field_id)
    info = services.day_slots(field, day)
    lo, hi = _day_range(day)
    approved, block_rows = services._load(field, lo, hi)
    out = []
    for slot in info["slots"]:
        s = parse_aware_datetime(slot["start"])
        e = parse_aware_datetime(slot["end"])
        item = dict(slot)
        booking = next((b for b in approved if b.start < e and b.end > s), None)
        block = next((b for b in block_rows if b.start < e and b.end > s), None)
        if booking:
            item["booking"] = {
                "id": booking.pk,
                "start": timezone.localtime(booking.start).isoformat(),
                "end": timezone.localtime(booking.end).isoformat(),
                "status": booking.status,
            }
        if block:
            item["block"] = {
                "id": block.pk,
                "reason": block.reason,
                "start": timezone.localtime(block.start).isoformat(),
                "end": timezone.localtime(block.end).isoformat(),
            }
        out.append(item)
    return JsonResponse({"open": info["open"], "slots": out})


urlpatterns = [
    path("admin/bookings", bookings_list),
    path("admin/bookings/<int:pk>/status", booking_status),
    path("admin/bookings/<int:pk>/contact", booking_contact),
    path("admin/blocks", blocks),
    path("admin/blocks/<int:pk>", block_detail),
    path("admin/agenda", agenda),
]
