"""Fernet de DEMONSTRAÇÃO para a página /criptografia/.

A chave da demonstração é gerada ao acaso quando o processo sobe
(`Fernet.generate_key()`), fica só na memória e nunca é derivada de
`settings.FIELD_ENCRYPTION_KEYS` nem igual a ela. Assim, nada que alguém cifre
na demonstração serve para ler os dados reais, e um token real colado na
demonstração não decifra. Efeito colateral: ao reiniciar o servidor (ou em
outro processo/worker) a chave muda e tokens antigos da demo não decifram mais.

Formato do token Fernet (antes do base64 URL-safe):
    versão (1 byte, 0x80) | timestamp (8 bytes, big-endian, segundos Unix)
    | IV (16 bytes) | texto cifrado AES-128-CBC (n * 16 bytes) | HMAC-SHA256 (32 bytes)
"""

import base64
import binascii
import re
from datetime import datetime
from zoneinfo import ZoneInfo

from cryptography.fernet import Fernet, InvalidToken

from common.crypto import DecryptionError

MAX_TEXT = 500
MAX_TOKEN = 2000
VERSION = 0x80
_HEAD = 1 + 8 + 16  # versão + timestamp + IV
_HMAC = 32
_MIN_LEN = _HEAD + 16 + _HMAC
_B64 = re.compile(r"^[A-Za-z0-9_-]+={0,2}$")
_TZ = ZoneInfo("America/Sao_Paulo")

_DEMO_KEY = Fernet.generate_key()
_demo = Fernet(_DEMO_KEY)


def _check_text(text) -> str:
    if not isinstance(text, str):
        raise ValueError("O texto deve ser uma string.")
    if len(text) > MAX_TEXT:
        raise ValueError(f"O texto pode ter no máximo {MAX_TEXT} caracteres.")
    return text


def _token_bytes(token) -> tuple[str, bytes]:
    if not isinstance(token, str):
        raise ValueError("O token deve ser uma string.")
    token = token.strip()
    if not token or len(token) > MAX_TOKEN or not _B64.match(token):
        raise ValueError("Token Fernet malformado.")
    try:
        raw = base64.urlsafe_b64decode(token + "=" * (-len(token) % 4))
    except (binascii.Error, ValueError):
        raise ValueError("Token Fernet malformado.") from None
    if len(raw) < _MIN_LEN or raw[0] != VERSION or (len(raw) - _HEAD - _HMAC) % 16:
        raise ValueError("Token Fernet malformado.")
    return token, raw


def demo_encrypt(text) -> str:
    return _demo.encrypt(_check_text(text).encode("utf-8")).decode("ascii")


def demo_decrypt(token) -> str:
    if not isinstance(token, str) or len(token) > MAX_TOKEN:
        raise DecryptionError("Token inválido.")
    try:
        return _demo.decrypt(token.strip().encode("ascii")).decode("utf-8")
    except (InvalidToken, UnicodeError, ValueError) as exc:
        raise DecryptionError("Não foi possível decifrar o token.") from exc


def _chars(byte_offset: int) -> int:
    # Posição aproximada no texto base64 (4 caracteres a cada 3 bytes).
    return (byte_offset * 8) // 6


def token_anatomy(token) -> dict:
    """Separa o token nos 5 campos SEM usar chave (nada aqui é segredo)."""
    token, raw = _token_bytes(token)
    n = len(raw)
    ct_len = n - _HEAD - _HMAC
    ts = int.from_bytes(raw[1:9], "big")
    try:
        iso = datetime.fromtimestamp(ts, _TZ).isoformat()
    except (OverflowError, OSError, ValueError):
        iso = None
    bounds = [0, 1, 9, _HEAD, _HEAD + ct_len, n]
    chars = [_chars(b) for b in bounds[:-1]] + [len(token.rstrip("="))]
    segments = [
        {"key": "version", "label": "Versão", "bytes": 1, "hex": raw[0:1].hex()},
        {"key": "timestamp", "label": "Timestamp", "bytes": 8, "hex": raw[1:9].hex(),
         "value": ts, "iso": iso},
        {"key": "iv", "label": "IV", "bytes": 16, "hex": raw[9:_HEAD].hex()},
        {"key": "ciphertext", "label": "Texto cifrado", "bytes": ct_len,
         "hex_prefix": raw[_HEAD:_HEAD + 8].hex()},
        {"key": "hmac", "label": "HMAC-SHA256", "bytes": _HMAC,
         "hex_prefix": raw[n - _HMAC:n - _HMAC + 8].hex()},
    ]
    for i, seg in enumerate(segments):
        seg["char_start"], seg["char_end"] = chars[i], chars[i + 1]
    return {"total_bytes": n, "token_length": len(token), "segments": segments}


def tamper(token) -> dict:
    """Troca um bit do primeiro byte do texto cifrado: o HMAC deixa de bater."""
    token, raw = _token_bytes(token)
    changed = bytearray(raw)
    changed[_HEAD] ^= 0x01
    new = base64.urlsafe_b64encode(bytes(changed)).decode("ascii")
    at = next((i for i, (a, b) in enumerate(zip(token, new)) if a != b), _chars(_HEAD))
    return {"token": new, "changed_at": at}
