from django.conf import settings
from django.core.mail import send_mail


class ChannelDisabled(Exception):
    """Canal desligado por configuração; nada é enviado."""


class EmailChannel:
    name = "email"

    def send(self, to: str, subject: str, body: str) -> None:
        send_mail(subject, body, settings.DEFAULT_FROM_EMAIL, [to], fail_silently=False)


class WhatsAppChannel:
    """Adaptador da WhatsApp Cloud API. Desligado por padrão; a chamada real fica
    para quando houver credenciais e templates aprovados (ver README)."""

    name = "whatsapp"

    def send(self, to: str, subject: str, body: str) -> None:
        if not getattr(settings, "WHATSAPP_ENABLED", False):
            raise ChannelDisabled("whatsapp desligado")
        raise NotImplementedError("Integração com a Cloud API não configurada")
