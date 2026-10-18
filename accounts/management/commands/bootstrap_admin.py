import os

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = "Cria um superusuário inicial usando variáveis de ambiente."

    def handle(self, *args, **options):
        email = os.environ.get("BOOTSTRAP_ADMIN_EMAIL", "").strip().lower()
        password = os.environ.get("BOOTSTRAP_ADMIN_PASSWORD", "")
        name = os.environ.get("BOOTSTRAP_ADMIN_NAME", "Administrador")

        if not email or not password:
            raise CommandError(
                "Configure BOOTSTRAP_ADMIN_EMAIL e BOOTSTRAP_ADMIN_PASSWORD."
            )

        User = get_user_model()

        if User.objects.filter(email=email).exists():
            self.stdout.write(
                self.style.WARNING(
                    f"Já existe uma conta com o e-mail {email}. Nenhuma alteração feita."
                )
            )
            return

        User.objects.create_superuser(
            email=email,
            password=password,
            name=name,
        )

        self.stdout.write(
            self.style.SUCCESS("Superusuário criado com sucesso.")
        )
