import functools
import json
from datetime import date, datetime
from datetime import timezone as dt_timezone

from django.http import HttpResponse, JsonResponse

# Faixa aceita para datas (anos 1900..2200, em UTC para datetimes). Fora dela a
# aritmetica de datetime estoura (ex.: +1 dia em 9999-12-31, astimezone em 0001-01-01)
# e viraria 500; a API responde 400. Ajuste aqui se precisar de outra faixa.
MIN_YEAR, MAX_YEAR = 1900, 2200
# SQLite/PostgreSQL: inteiros acima de 64 bits estouram o driver.
MAX_DB_INT = 2**63 - 1


def int_from_json(value) -> int | None:
    """Inteiro JSON valido para ids (sem bool, dentro de 64 bits) ou None."""
    if isinstance(value, bool) or not isinstance(value, int) or abs(value) > MAX_DB_INT:
        return None
    return value


def int_from_text(raw) -> int | None:
    """Inteiro de query string dentro de 64 bits ou None.

    O limite de tamanho vem antes de int(): Python 3.11+ levanta ValueError
    para textos com mais de 4300 digitos.
    """
    if not isinstance(raw, str):
        return None
    text = raw.strip()
    if not text or len(text) > 20 or not text.isascii():
        return None
    try:
        value = int(text)
    except ValueError:
        return None
    return value if abs(value) <= MAX_DB_INT else None


class ApiError(Exception):
    def __init__(self, code: str, message: str, status: int = 400, fields: dict | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.fields = fields or {}


def json_error(code, message, status, fields=None):
    return JsonResponse(
        {"error": {"code": code, "message": message, "fields": fields or {}}},
        status=status,
    )


def read_json(request) -> dict:
    try:
        data = json.loads(request.body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        data = None
    if not isinstance(data, dict):
        raise ApiError("invalid_json", "Corpo da requisição inválido.", 400)
    return data


def parse_aware_datetime(value: object) -> datetime:
    message = "Informe data e hora ISO 8601 com fuso (ex.: 2026-10-20T19:00:00-03:00)."
    if not isinstance(value, str):
        raise ApiError("invalid_datetime", message, 400)
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        raise ApiError("invalid_datetime", message, 400) from None
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ApiError("invalid_datetime", message, 400)
    try:
        in_utc = parsed.astimezone(dt_timezone.utc)
    except OverflowError:
        raise ApiError("invalid_datetime", message, 400) from None
    if not MIN_YEAR <= in_utc.year <= MAX_YEAR:
        raise ApiError("invalid_datetime", message, 400)
    return parsed


def parse_date(value: object) -> date:
    message = "Informe a data no formato AAAA-MM-DD."
    if not isinstance(value, str):
        raise ApiError("invalid_date", message, 400)
    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        raise ApiError("invalid_date", message, 400) from None
    if not MIN_YEAR <= parsed.year <= MAX_YEAR:
        raise ApiError("invalid_date", message, 400)
    return parsed


def api(methods: list[str]):
    allowed = [m.upper() for m in methods]

    def decorator(view):
        @functools.wraps(view)
        def wrapper(request, *args, **kwargs):
            if request.method not in allowed:
                response = json_error("method_not_allowed", "Método não permitido.", 405)
                response["Allow"] = ", ".join(allowed)
                return response
            try:
                return view(request, *args, **kwargs)
            except ApiError as exc:
                return json_error(exc.code, exc.message, exc.status, exc.fields)

        return wrapper

    return decorator


def csrf_failure(request, reason=""):
    if request.path.startswith("/api/"):
        return json_error(
            "csrf_failed",
            "Sessão expirada ou requisição inválida. Recarregue a página e tente de novo.",
            403,
        )
    return HttpResponse(
        "<!doctype html><html lang='pt-BR'><meta charset='utf-8'>"
        "<title>Requisição recusada</title>"
        "<p>Requisição recusada. Volte, recarregue a página e tente de novo.</p></html>",
        status=403,
        content_type="text/html; charset=utf-8",
    )
