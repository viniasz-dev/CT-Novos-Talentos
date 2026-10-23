from django.http import JsonResponse
from django.urls import path

from accounts.decorators import login_required_json
from common.http import (
    ApiError, api, int_from_json, int_from_text, parse_aware_datetime, parse_date, read_json,
)

from . import privacy, services
from .models import BookingRequest, Field
from .serializers import booking_to_dict, field_to_dict


def _not_found():
    return ApiError("not_found", "Não encontrado.", 404)


def _bad_field(message="Informe o campo."):
    return ApiError("invalid_field", message, 400, {"field": message})


def _field_id_from_body(value) -> int:
    result = int_from_json(value)
    if result is None:
        raise _bad_field()
    return result


def _field_id_from_query(raw) -> int:
    if raw is None or not raw.strip().isdigit():
        raise _bad_field()
    result = int_from_text(raw)
    if result is None:
        raise _bad_field()
    return result


def _datetime_field(data: dict, key: str):
    try:
        return parse_aware_datetime(data.get(key))
    except ApiError as exc:
        raise ApiError(exc.code, exc.message, exc.status, {key: exc.message}) from None


def _text_field(data: dict, key: str, code: str, label: str, required: bool) -> str:
    value = data.get(key)
    if value is None and not required:
        return ""
    if not isinstance(value, str):
        message = f"{label} inválido."
        raise ApiError(code, message, 400, {key: message})
    return value


def _active_field(field_id: int) -> Field:
    field = Field.objects.filter(pk=field_id, active=True).first()
    if field is None:
        raise _not_found()
    return field


@api(["GET"])
def fields_view(request):
    fields = Field.objects.filter(active=True).order_by("name", "id")
    return JsonResponse({"fields": [field_to_dict(f) for f in fields]})


@api(["GET"])
def availability_view(request):
    field_id = _field_id_from_query(request.GET.get("field"))
    day = request.GET.get("date")
    date_from, date_to = request.GET.get("from"), request.GET.get("to")
    if day is None and (date_from is None or date_to is None):
        raise ApiError(
            "missing_params",
            "Informe date ou from e to.", 400,
            {"date": "Informe date ou from e to."})
    if day is not None:
        parsed_day = parse_date(day)
    else:
        parsed_from, parsed_to = parse_date(date_from), parse_date(date_to)
    field = _active_field(field_id)
    if day is not None:
        info = services.day_slots(field, parsed_day)
        return JsonResponse({"field": field.id, "date": parsed_day.isoformat(),
                             "open": info["open"], "slots": info["slots"]})
    days = services.month_overview(field, parsed_from, parsed_to)
    return JsonResponse({"field": field.id, "days": days})


@api(["POST", "GET"])
@login_required_json
def bookings_view(request):
    if request.method == "GET":
        bookings = (BookingRequest.objects.filter(user=request.user)
                    .select_related("field").order_by("-start", "-id"))
        return JsonResponse({"bookings": [booking_to_dict(b) for b in bookings]})

    data = read_json(request)
    field_id = _field_id_from_body(data.get("field"))
    kind = data.get("kind") or "avulsa"
    if kind == "torneio":
        raw = data.get("ranges")
        if not isinstance(raw, list) or not all(isinstance(r, dict) for r in raw):
            raise ApiError("bad_ranges", "Escolha pelo menos um período.", 400,
                           {"ranges": "Escolha pelo menos um período."})
        ranges = [(_datetime_field(r, "start"), _datetime_field(r, "end")) for r in raw]
        start = end = None
    else:
        ranges = None
        start = _datetime_field(data, "start")
        end = _datetime_field(data, "end")
    contact = _text_field(data, "contact", "invalid_contact", "Contato", True)
    message = _text_field(data, "message", "invalid_message", "Mensagem", False)
    field = Field.objects.filter(pk=field_id).first()
    if field is None:
        raise _not_found()
    created = services.create_booking_series(
        request.user, field, start, end, contact, message, kind, ranges)
    return JsonResponse({"booking": booking_to_dict(created[0]),
                         "count": len(created)}, status=201)


@api(["POST"])
@login_required_json
def cancel_view(request, pk):
    booking = (BookingRequest.objects.select_related("field")
               .filter(pk=pk, user=request.user).first())
    if booking is None:
        raise _not_found()
    booking = services.cancel_booking(booking, request.user)
    return JsonResponse({"booking": booking_to_dict(booking)})


@api(["GET"])
@login_required_json
def contact_view(request, pk):
    booking = BookingRequest.objects.filter(pk=pk, user=request.user).first()
    if booking is None:
        raise _not_found()
    return JsonResponse(privacy.reveal_contact(booking, request.user))


urlpatterns = [
    path("fields", fields_view),
    path("availability", availability_view),
    path("bookings", bookings_view),
    path("bookings/<int:pk>/cancel", cancel_view),
    path("bookings/<int:pk>/contact", contact_view),
]
