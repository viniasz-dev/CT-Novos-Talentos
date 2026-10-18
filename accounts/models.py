from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models
from django.utils import timezone

from common.crypto import decrypt, encrypt


class UserManager(BaseUserManager):
    use_in_migrations = True

    def _create(self, email, password, name, **extra):
        if not email:
            raise ValueError("E-mail é obrigatório.")
        user = self.model(email=self.normalize_email(email).lower(), name=name, **extra)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, email, password=None, name="", **extra):
        extra.setdefault("is_staff", False)
        extra.setdefault("is_superuser", False)
        return self._create(email, password, name, **extra)

    def create_superuser(self, email, password=None, name="", **extra):
        extra.setdefault("is_staff", True)
        extra.setdefault("is_superuser", True)
        if not extra["is_staff"] or not extra["is_superuser"]:
            raise ValueError("Superusuário precisa de is_staff e is_superuser.")
        return self._create(email, password, name, **extra)


class User(AbstractBaseUser, PermissionsMixin):
    email = models.EmailField(unique=True)
    name = models.CharField(max_length=150, blank=True)
    phone_enc = models.TextField(blank=True, default="")
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    date_joined = models.DateTimeField(default=timezone.now)

    objects = UserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["name"]

    def save(self, *args, **kwargs):
        if self.email:
            self.email = self.email.lower()
        super().save(*args, **kwargs)

    @property
    def phone(self) -> str:
        return decrypt(self.phone_enc) if self.phone_enc else ""

    @phone.setter
    def phone(self, value: str) -> None:
        self.phone_enc = encrypt(value) if value else ""

    def __str__(self):
        return self.email
