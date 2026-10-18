import functools

from common.http import json_error


def _unauthenticated():
    return json_error("not_authenticated", "Faça login para continuar.", 401)


def login_required_json(view):
    @functools.wraps(view)
    def wrapper(request, *args, **kwargs):
        user = request.user
        if not user.is_authenticated or not user.is_active:
            return _unauthenticated()
        return view(request, *args, **kwargs)

    return wrapper


def staff_required_json(view):
    @functools.wraps(view)
    def wrapper(request, *args, **kwargs):
        user = request.user
        if not user.is_authenticated or not user.is_active:
            return _unauthenticated()
        if not user.is_staff:
            return json_error("forbidden", "Acesso restrito à equipe.", 403)
        return view(request, *args, **kwargs)

    return wrapper
