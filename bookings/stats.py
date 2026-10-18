"""Indicadores (KPIs) do topo do Kanban. Tudo no fuso America/Sao_Paulo.

Definições (janelas meio-abertas [início, fim)):
- pending: pedidos `pendente` que ainda não terminaram (end > agora).
- approved_next7 / booked_hours_next7 / revenue_next7: pedidos `aprovado` com
  início em [00:00 de hoje, 00:00 de hoje + 7 dias). Receita = horas x
  price_per_hour do campo (estimada: não considera descontos nem pagamentos).
- occupancy_next7: horas aprovadas da janela / horas de expediente da janela
  (settings.BUSINESS_HOURS x campos ativos, ou só o campo filtrado), 0-100%.
- lost_last30: pedidos `cancelado` ou `recusado` cuja última mudança
  (updated_at, que nesses estados finais é o momento da decisão) caiu em
  [agora - 30 dias, agora].
"""

from datetime import timedelta
from decimal import ROUND_HALF_UP, Decimal

from django.conf import settings
from django.utils import timezone

from .models import BookingRequest, Field
from .services import _day_bounds

WINDOW_DAYS = 7
LOST_DAYS = 30
_CENT = Decimal("0.01")
_TENTH = Decimal("0.1")


def _capacity_hours(lo, days: int) -> int:
    total = 0
    day = lo.date()
    for i in range(days):
        hours = settings.BUSINESS_HOURS.get((day + timedelta(days=i)).weekday())
        if hours:
            total += hours[1] - hours[0]
    return total


def dashboard(now=None, field: Field | None = None) -> dict:
    now = now or timezone.now()
    today = timezone.localtime(now).date()
    lo = _day_bounds(today)[0]
    hi = _day_bounds(today + timedelta(days=WINDOW_DAYS))[0]

    qs = BookingRequest.objects.all()
    if field is not None:
        qs = qs.filter(field=field)
        fields_count = 1
    else:
        qs = qs.filter(field__active=True)
        fields_count = Field.objects.filter(active=True).count()

    pending = qs.filter(status="pendente", end__gt=now).count()
    rows = list(qs.filter(status="aprovado", start__gte=lo, start__lt=hi)
                .values_list("start", "end", "field__price_per_hour"))
    hours = Decimal(0)
    revenue = Decimal(0)
    for start, end, price in rows:
        h = Decimal(int((end - start).total_seconds())) / Decimal(3600)
        hours += h
        revenue += h * price
    capacity = Decimal(_capacity_hours(lo, WINDOW_DAYS) * fields_count)
    occupancy = (hours * 100 / capacity) if capacity else Decimal(0)
    occupancy = min(occupancy, Decimal(100))
    lost = qs.filter(status__in=["cancelado", "recusado"],
                     updated_at__gte=now - timedelta(days=LOST_DAYS),
                     updated_at__lte=now).count()
    return {
        "pending": pending,
        "approved_next7": len(rows),
        "booked_hours_next7": float(hours.quantize(_TENTH, ROUND_HALF_UP)),
        "occupancy_next7": float(occupancy.quantize(_TENTH, ROUND_HALF_UP)),
        "lost_last30": lost,
        "revenue_next7": str(revenue.quantize(_CENT, ROUND_HALF_UP)),
        "window": {"from": lo.isoformat(), "to": hi.isoformat()},
    }
