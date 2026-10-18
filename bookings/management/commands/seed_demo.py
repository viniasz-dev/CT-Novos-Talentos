from django.conf import settings
from django.contrib.auth.models import Group, Permission
from django.core.management.base import BaseCommand, CommandError

from accounts.models import User
from bookings.models import AuditEvent, BookingRequest, Field, TimeBlock
from notifications.models import Notification

DEMO_PASSWORD = "Demo-12345-Senha"  # conta de teste, nao real
EQUIPE_GROUP = "Equipe"
# modelo -> acoes de permissao do grupo "Equipe" no /django-admin/
EQUIPE_PERMS = (
    (Field, ("view", "add", "change", "delete")),
    (BookingRequest, ("view", "change")),
    (TimeBlock, ("view", "add", "change", "delete")),
    (AuditEvent, ("view",)),
    (Notification, ("view",)),
)


def ensure_equipe_group() -> Group:
    from django.contrib.contenttypes.models import ContentType
    group, _ = Group.objects.get_or_create(name=EQUIPE_GROUP)
    perms = []
    for model, actions in EQUIPE_PERMS:
        ct = ContentType.objects.get_for_model(model)
        codes = [f"{a}_{model._meta.model_name}" for a in actions]
        perms += list(Permission.objects.filter(content_type=ct, codename__in=codes))
    group.permissions.set(perms)
    return group


class Command(BaseCommand):
    help = "Cria dados de demonstracao (apenas com DEBUG=true)."

    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError("seed_demo so roda com DEBUG=true.")
        Field.objects.get_or_create(
            name="Quadra Society",
            defaults={"description": "Campo society com grama sintetica.",
                      "price_per_hour": "150.00", "active": True},
        )
        for email, name, staff in (
            ("cliente@exemplo.test", "Cliente Um", False),
            ("cliente2@exemplo.test", "Cliente Dois", False),
            ("equipe@exemplo.test", "Equipe", True),
        ):
            if not User.objects.filter(email=email).exists():
                User.objects.create_user(email, DEMO_PASSWORD, name=name, is_staff=staff)
        group = ensure_equipe_group()
        User.objects.get(email="equipe@exemplo.test").groups.add(group)
        self.stdout.write(self.style.SUCCESS("Dados de demonstracao prontos."))
