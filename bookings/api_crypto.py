"""Rotas da criptografia visível: demonstração pública, tokens crus (staff) e KPIs do painel.

A demonstração (POST /api/crypto/demo) usa SÓ a chave de demonstração de
`common.crypto_demo`; nunca toca nos dados reais nem em FIELD_ENCRYPTION_KEYS.
"""

from django.conf import settings
from django.http import JsonResponse
from django.urls import path

from accounts import throttle
from accounts.api import _client_ip
from accounts.decorators import staff_required_json
from common import classic_ciphers as cc
from common import crypto_demo
from common.crypto import DecryptionError
from common.http import ApiError, api, int_from_text, json_error, read_json

from . import stats
from .models import BookingRequest, Field
from .serializers import ALGORITHM

ACTIONS = {
    "caesar": {"encrypt", "decrypt", "bruteforce"},
    "vigenere": {"encrypt", "decrypt"},
    "substitution": {"encrypt", "decrypt"},
    "transposition": {"encrypt", "decrypt"},
    "fernet": {"encrypt", "decrypt", "tamper"},
}
WINDOW = 60


def _bad(code: str, message: str, field: str):
    return ApiError(code, message, 400, {field: message})


def _text(data: dict, limit: int, code: str, label: str) -> str:
    value = data.get("text")
    if not isinstance(value, str) or not value.strip():
        raise _bad(code, f"Digite {label}.", "text")
    if len(value) > limit:
        raise _bad(code, f"O texto pode ter no máximo {limit} caracteres.", "text")
    return value


def _shift(data: dict) -> int:
    value = data.get("shift")
    if (isinstance(value, bool) or not isinstance(value, int)
            or not cc.MIN_SHIFT <= value <= cc.MAX_SHIFT):
        raise _bad("invalid_shift",
                   f"O deslocamento deve ser um número inteiro de {cc.MIN_SHIFT} a {cc.MAX_SHIFT}.",
                   "shift")
    return value


def _key(data: dict) -> str:
    value = data.get("key")
    if (not isinstance(value, str) or not 1 <= len(value) <= cc.MAX_KEY_LEN
            or not all(c.isascii() and c.isalpha() for c in value)):
        raise _bad("invalid_key",
                   f"A chave deve ter de 1 a {cc.MAX_KEY_LEN} letras de A a Z, sem acento nem espaço.",
                   "key")
    return value


def _anatomy(token: str) -> dict:
    try:
        return crypto_demo.token_anatomy(token)
    except ValueError:
        raise _bad("invalid_token",
                   "Isto não parece um token Fernet completo. Cole o token inteiro, começando por gAAAAA.",
                   "text") from None


def _caesar(action: str, data: dict) -> dict:
    text = _text(data, crypto_demo.MAX_TEXT, "invalid_text", "um texto")
    if action == "bruteforce":
        candidates = cc.caesar_bruteforce(text)
        best = max(candidates, key=lambda c: c["score"])
        return {"result": best["text"], "best_shift": best["shift"], "candidates": candidates}
    shift = _shift(data)
    if action == "encrypt":
        return {"result": cc.caesar_encrypt(text, shift), "steps": cc.caesar_steps(text, shift)}
    # Passo a passo da decifragem = cifrar com 26 - k.
    back = cc.ALPHABET_SIZE - shift
    return {"result": cc.caesar_decrypt(text, shift), "steps": cc.caesar_steps(text, back)}


def _vigenere(action: str, data: dict) -> dict:
    text = _text(data, crypto_demo.MAX_TEXT, "invalid_text", "um texto")
    key = _key(data)
    decrypt = action == "decrypt"
    steps = cc.vigenere_steps(text, key, decrypt=decrypt)
    result = cc.vigenere_decrypt(text, key) if decrypt else cc.vigenere_encrypt(text, key)
    return {"result": result, "steps": steps}


def _substitution(action: str, data: dict) -> dict:
    text = _text(data, crypto_demo.MAX_TEXT, "invalid_text", "um texto")
    key = _key(data)
    decrypt = action == "decrypt"
    result = cc.substitution_decrypt(text, key) if decrypt else cc.substitution_encrypt(text, key)
    return {"result": result, "steps": cc.substitution_steps(text, key, decrypt=decrypt),
            "alphabet": cc.substitution_alphabet(key)}


def _transposition(action: str, data: dict) -> dict:
    text = _text(data, crypto_demo.MAX_TEXT, "invalid_text", "um texto")
    key = _key(data)
    if len(key) < 2:
        raise _bad("invalid_key", "A chave da transposição deve ter pelo menos 2 letras.", "key")
    if action == "decrypt":
        result = cc.transposition_decrypt(text, key)
        return {"result": result, "grid": cc.transposition_grid(result, key)}
    return {"result": cc.transposition_encrypt(text, key), "grid": cc.transposition_grid(text, key)}


def _fernet(action: str, data: dict) -> dict:
    if action == "encrypt":
        text = _text(data, crypto_demo.MAX_TEXT, "invalid_text", "um texto")
        token = crypto_demo.demo_encrypt(text)
        return {"result": token, "anatomy": crypto_demo.token_anatomy(token)}
    token = _text(data, crypto_demo.MAX_TOKEN, "invalid_token", "o token").strip()
    anatomy = _anatomy(token)
    if action == "tamper":
        bad = crypto_demo.tamper(token)
        try:
            crypto_demo.demo_decrypt(bad["token"])
            ok = True  # nunca deveria acontecer: o HMAC cobre o texto cifrado
        except DecryptionError:
            ok = False
        return {"result": bad["token"], "changed_at": bad["changed_at"],
                "anatomy": crypto_demo.token_anatomy(bad["token"]), "decrypt_ok": ok}
    try:
        plain = crypto_demo.demo_decrypt(token)
    except DecryptionError:
        raise ApiError(
            "decrypt_failed",
            "Não deu para decifrar: o HMAC não confere. O token foi adulterado, está "
            "incompleto ou foi gerado com outra chave (a chave da demonstração muda "
            "quando o servidor reinicia).", 400, {"text": "Token rejeitado."}) from None
    return {"result": plain, "anatomy": anatomy}


HANDLERS = {"caesar": _caesar, "vigenere": _vigenere, "substitution": _substitution,
            "transposition": _transposition, "fernet": _fernet}


@api(["POST"])
def demo(request):
    key = f"crypto-demo:{_client_ip(request)}"
    limit = settings.CRYPTO_DEMO_MAX_PER_MINUTE
    if throttle.check(key, limit, WINDOW):
        return json_error("rate_limited",
                          "Muitas operações em pouco tempo. Espere um minuto e tente de novo.", 429)
    throttle.hit(key, WINDOW)
    data = read_json(request)
    cipher = data.get("cipher")
    if not isinstance(cipher, str) or cipher not in ACTIONS:
        raise _bad("invalid_cipher", "Escolha a cifra: caesar, vigenere, substitution, transposition ou fernet.", "cipher")
    action = data.get("action")
    if not isinstance(action, str) or action not in ACTIONS[cipher]:
        allowed = ", ".join(sorted(ACTIONS[cipher]))
        raise _bad("invalid_action", f"Ação inválida para esta cifra. Use: {allowed}.", "action")
    return JsonResponse(HANDLERS[cipher](action, data))


def _maybe_anatomy(token: str):
    if not token:
        return None
    try:
        return crypto_demo.token_anatomy(token)
    except ValueError:
        return None  # token corrompido no banco: mostra o texto cru, sem 500


@api(["GET"])
@staff_required_json
def booking_cipher(request, pk):
    booking = BookingRequest.objects.filter(pk=pk).first()
    if booking is None:
        raise ApiError("not_found", "Pedido não encontrado.", 404)
    return JsonResponse({
        "id": booking.pk,
        "algorithm": ALGORITHM,
        "contact_token": booking.contact_enc or None,
        "message_token": booking.message_enc or None,
        "anatomy": {
            "contact": _maybe_anatomy(booking.contact_enc),
            "message": _maybe_anatomy(booking.message_enc),
        },
    })


@api(["GET"])
@staff_required_json
def admin_stats(request):
    raw = request.GET.get("field")
    field = None
    if raw not in (None, ""):
        field_id = int_from_text(raw)
        if field_id is None or field_id < 1:
            raise ApiError("invalid_field", "Valor inválido para field.", 400,
                           {"field": "Informe um número inteiro."})
        field = Field.objects.filter(pk=field_id).first()
        if field is None:
            raise ApiError("not_found", "Campo não encontrado.", 404)
    return JsonResponse(stats.dashboard(field=field))


urlpatterns = [
    path("crypto/demo", demo),
    path("admin/bookings/<int:pk>/cipher", booking_cipher),
    path("admin/stats", admin_stats),
]
