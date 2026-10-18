from cryptography.fernet import InvalidToken
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from accounts.models import User
from bookings.models import BookingRequest
from common.crypto import DecryptionError, first_fernet, rotate_token

BATCH = 500
TARGETS = [
    (BookingRequest, "contact_enc"),
    (BookingRequest, "message_enc"),
    (User, "phone_enc"),
]


def _needs_rotation(token: str) -> bool:
    """True se o token nao foi cifrado com a primeira chave."""
    try:
        first_fernet().decrypt(token.encode("ascii"))
    except (InvalidToken, UnicodeError, ValueError):
        return True
    return False


class Command(BaseCommand):
    help = "Recifra campos cifrados com a primeira chave de FIELD_ENCRYPTION_KEYS."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true",
                            help="Conta o que seria recifrado sem gravar.")

    def handle(self, *args, **opts):
        dry = opts["dry_run"]
        grand = 0
        for model, field in TARGETS:
            total = changed = 0
            pks = list(model.objects.exclude(**{field: ""})
                       .order_by("pk").values_list("pk", flat=True))
            for i in range(0, len(pks), BATCH):
                with transaction.atomic():
                    rows = model.objects.select_for_update().filter(pk__in=pks[i:i + BATCH])
                    for obj in rows:
                        total += 1
                        token = getattr(obj, field)
                        if not _needs_rotation(token):
                            continue
                        changed += 1
                        # Valida com todas as chaves (tambem no dry-run); o lote aborta.
                        try:
                            new = rotate_token(token)
                        except DecryptionError:
                            raise CommandError(
                                f"{model.__name__}#{obj.pk}.{field} não decifra "
                                "com nenhuma chave") from None
                        if not dry:
                            model.objects.filter(pk=obj.pk).update(**{field: new})
            grand += changed
            self.stdout.write(f"{model.__name__}.{field}: {total} lidos, {changed} alterados")
        suffix = " (dry-run, nada gravado)" if dry else ""
        self.stdout.write(f"recifrados: {grand}{suffix}")
