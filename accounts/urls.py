from django.urls import path

from . import api

urlpatterns = [
    path("csrf", api.csrf, name="api_csrf"),
    path("auth/register", api.register, name="api_register"),
    path("auth/login", api.login_view, name="api_login"),
    path("auth/logout", api.logout_view, name="api_logout"),
    path("auth/me", api.me, name="api_me"),
]
