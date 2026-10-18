from cryptography.fernet import Fernet, InvalidToken, MultiFernet
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured


class DecryptionError(Exception):
    pass


class EncryptionConfigError(ImproperlyConfigured):
    pass


def get_fernet() -> MultiFernet:
    """MultiFernet com as chaves de FIELD_ENCRYPTION_KEYS; a primeira cifra."""
    keys = [k for k in (getattr(settings, "FIELD_ENCRYPTION_KEYS", None) or []) if k]
    if not keys:
        raise EncryptionConfigError("FIELD_ENCRYPTION_KEYS nao configurada.")
    try:
        return MultiFernet([Fernet(k.encode() if isinstance(k, str) else k) for k in keys])
    except (ValueError, TypeError) as exc:
        raise EncryptionConfigError("FIELD_ENCRYPTION_KEYS contem chave invalida.") from exc


def first_fernet() -> Fernet:
    """Fernet da primeira chave (a que cifra); usado para saber se precisa rotacionar."""
    keys = [k for k in (getattr(settings, "FIELD_ENCRYPTION_KEYS", None) or []) if k]
    if not keys:
        raise EncryptionConfigError("FIELD_ENCRYPTION_KEYS nao configurada.")
    k = keys[0]
    try:
        return Fernet(k.encode() if isinstance(k, str) else k)
    except (ValueError, TypeError) as exc:
        raise EncryptionConfigError("FIELD_ENCRYPTION_KEYS contem chave invalida.") from exc


def rotate_token(token: str) -> str:
    """Recifra o token com a primeira chave (MultiFernet.rotate)."""
    try:
        return get_fernet().rotate(token.encode("ascii")).decode("ascii")
    except (InvalidToken, UnicodeError, ValueError) as exc:
        raise DecryptionError("Nao foi possivel decifrar o valor.") from exc


def check_encryption_config() -> None:
    """Falha cedo se, fora de DEBUG/testes, as chaves faltam ou sao invalidas."""
    if getattr(settings, "DEBUG", False) or getattr(settings, "TESTING", False):
        return
    get_fernet()


def encrypt(plaintext: str) -> str:
    return get_fernet().encrypt(plaintext.encode("utf-8")).decode("ascii")


def decrypt(token: str) -> str:
    try:
        return get_fernet().decrypt(token.encode("ascii")).decode("utf-8")
    except (InvalidToken, UnicodeError, ValueError) as exc:
        raise DecryptionError("Nao foi possivel decifrar o valor.") from exc
