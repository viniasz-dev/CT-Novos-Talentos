import hashlib

from django.core.cache import cache

_PREFIX = "throttle:"


def _full(key: str) -> str:
    # Hash: a chave pode conter texto do usuario (e-mail com espacos/tamanho
    # arbitrario), invalido em Memcached e indesejavel em qualquer cache.
    return _PREFIX + hashlib.sha256(key.encode("utf-8")).hexdigest()[:32]


def check(key: str, limit: int, window: int) -> bool:
    """True when the key already reached `limit` hits inside the window."""
    return (cache.get(_full(key)) or 0) >= limit


def hit(key: str, window: int) -> None:
    full = _full(key)
    # add() sets the expiry only on the first hit, giving a fixed window.
    if cache.add(full, 1, window):
        return
    try:
        cache.incr(full)
    except ValueError:
        cache.add(full, 1, window)


def reset(key: str) -> None:
    cache.delete(_full(key))
