from django.conf import settings
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import IntegrityError, transaction
from django.http import HttpResponse, JsonResponse
from django.views.decorators.csrf import ensure_csrf_cookie

from accounts import throttle
from accounts.models import User
from accounts.serializers import user_to_dict
from common.http import ApiError, api, json_error, read_json

REQUIRED = "Campo obrigatório."


def _client_ip(request) -> str:
    remote = request.META.get("REMOTE_ADDR", "") or "unknown"
    n = getattr(settings, "TRUSTED_PROXY_COUNT", 0)
    if n > 0:
        parts = [p.strip() for p in request.META.get("HTTP_X_FORWARDED_FOR", "").split(",") if p.strip()]
        if len(parts) >= n:
            return parts[-n]
    return remote


def _text(data: dict, name: str, fields: dict) -> str:
    value = data.get(name)
    if not isinstance(value, str) or not value.strip():
        fields[name] = REQUIRED
        return ""
    return value.strip()


def _too_many():
    return json_error(
        "too_many_attempts",
        "Muitas tentativas. Aguarde alguns minutos e tente de novo.",
        429,
    )


@ensure_csrf_cookie
@api(["GET"])
def csrf(request):
    return HttpResponse(status=204)


@api(["POST"])
def register(request):
    data = read_json(request)
    key = f"register:{_client_ip(request)}"
    if throttle.check(key, settings.REGISTER_MAX_PER_HOUR, 3600):
        return _too_many()
    throttle.hit(key, 3600)

    fields: dict = {}
    name = _text(data, "name", fields)
    email = _text(data, "email", fields).lower()
    phone = _text(data, "phone", fields)
    password = data.get("password")
    if not isinstance(password, str) or not password:
        fields["password"] = REQUIRED
        password = ""
    if email and "email" not in fields:
        try:
            validate_email(email)
        except ValidationError:
            fields["email"] = "Informe um e-mail válido."
    if password:
        candidate = User(email=email, name=name)
        try:
            validate_password(password, candidate)
        except ValidationError as exc:
            fields["password"] = " ".join(exc.messages)
    if fields:
        raise ApiError("validation_error", "Revise os campos informados.", 400, fields)

    taken = ApiError("email_taken", "Este e-mail já está cadastrado.", 409, {"email": "E-mail já cadastrado."})
    if User.objects.filter(email__iexact=email).exists():
        raise taken
    try:
        with transaction.atomic():
            user = User.objects.create_user(email, password, name=name)
            user.phone = phone
            user.save(update_fields=["phone_enc"])
    except IntegrityError:
        raise taken from None
    login(request, user, backend="django.contrib.auth.backends.ModelBackend")
    return JsonResponse({"user": user_to_dict(user)}, status=201)


@api(["POST"])
def login_view(request):
    data = read_json(request)
    fields: dict = {}
    email = _text(data, "email", fields).lower()
    password = data.get("password")
    if not isinstance(password, str) or not password:
        fields["password"] = REQUIRED
    if fields:
        raise ApiError("validation_error", "Revise os campos informados.", 400, fields)

    ip = _client_ip(request)
    ip_key = f"login-ip:{ip}"
    key = f"login:{ip}:{email}"
    window = settings.LOGIN_WINDOW_SECONDS
    # Por IP primeiro: impede espalhar uma senha por muitas contas.
    if throttle.check(ip_key, settings.LOGIN_MAX_ATTEMPTS_PER_IP, window):
        return _too_many()
    if throttle.check(key, settings.LOGIN_MAX_ATTEMPTS, window):
        return _too_many()
    user = authenticate(request, username=email, password=password)
    if user is None or not user.is_active:
        throttle.hit(key, window)
        throttle.hit(ip_key, window)
        return json_error("invalid_credentials", "E-mail ou senha incorretos.", 401)
    throttle.reset(key)
    login(request, user)
    return JsonResponse({"user": user_to_dict(user)})


@api(["POST"])
def logout_view(request):
    logout(request)
    return HttpResponse(status=204)


@api(["GET"])
def me(request):
    user = request.user
    if user.is_authenticated and user.is_active:
        return JsonResponse({"user": user_to_dict(user)})
    return JsonResponse({"user": None})
