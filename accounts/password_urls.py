from django.contrib.auth import views as auth_views
from django.conf import settings
from django.http import HttpResponseRedirect
from django.urls import path, reverse_lazy

from accounts import throttle
from accounts.api import _client_ip


class ThrottledPasswordResetView(auth_views.PasswordResetView):
    """Limita pedidos por IP; ao exceder, responde como sucesso (sem enviar nada)."""

    def post(self, request, *args, **kwargs):
        key = f"pwreset:{_client_ip(request)}"
        if throttle.check(key, settings.PASSWORD_RESET_MAX_PER_HOUR, 3600):
            return HttpResponseRedirect(self.get_success_url())
        throttle.hit(key, 3600)
        return super().post(request, *args, **kwargs)

urlpatterns = [
    path(
        "reset/",
        ThrottledPasswordResetView.as_view(
            # Sem isto o Django usa o padrão "password_reset_email.html" e ignora o texto do CT.
            email_template_name="registration/password_reset_email.txt",
            success_url=reverse_lazy("password_reset_done"),
        ),
        name="password_reset",
    ),
    path("reset/enviado/", auth_views.PasswordResetDoneView.as_view(), name="password_reset_done"),
    path(
        "reset/concluido/",
        auth_views.PasswordResetCompleteView.as_view(),
        name="password_reset_complete",
    ),
    path(
        "reset/<uidb64>/<token>/",
        auth_views.PasswordResetConfirmView.as_view(
            success_url=reverse_lazy("password_reset_complete"),
        ),
        name="password_reset_confirm",
    ),
]
