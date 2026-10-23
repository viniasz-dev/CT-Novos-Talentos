import os
import sys
from pathlib import Path

import dj_database_url
from cryptography.fernet import Fernet
from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent

# DISABLE_DOTENV=1 e so para testes herméticos (subprocessos); nunca em producao.
if os.environ.get("DISABLE_DOTENV") != "1":
    load_dotenv(BASE_DIR / ".env")


def env_bool(name, default=False):
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


def env_list(name, default=""):
    return [v.strip() for v in os.environ.get(name, default).split(",") if v.strip()]


DEBUG = env_bool("DEBUG", False)
# `manage.py test` roda em modo dev (sem .env); producao continua fechando.
TESTING = "test" in sys.argv[1:2]
DEV_MODE = DEBUG or TESTING

# Chave de desenvolvimento FIXA e INSEGURA: so vale com DEBUG=true.
_DEV_SECRET_KEY = "dev-insecure-secret-key-do-not-use-in-production"
# Chave Fernet de desenvolvimento FIXA e INSEGURA: so vale com DEBUG=true.
_DEV_FERNET_KEY = "ZGV2LWluc2VjdXJlLWZlcm5ldC1rZXktMDAwMDAwMDA="

# Valores de exemplo conhecidos: nunca aceitos fora do modo dev/teste.
_PLACEHOLDER_SECRET_KEYS = {
    _DEV_SECRET_KEY,
    "troque-por-uma-chave-longa-e-aleatoria",
    "changeme",
    "change-me",
    "secret",
}
_PLACEHOLDER_PREFIXES = ("troque", "dev-insecure", "changeme", "change-me", "django-insecure")

SECRET_KEY = os.environ.get("SECRET_KEY", "")
FIELD_ENCRYPTION_KEYS = env_list("FIELD_ENCRYPTION_KEYS")
if DEV_MODE:
    SECRET_KEY = SECRET_KEY or _DEV_SECRET_KEY
    FIELD_ENCRYPTION_KEYS = FIELD_ENCRYPTION_KEYS or [_DEV_FERNET_KEY]
else:
    # Fora de dev/teste (DEBUG falso e nao e `manage.py test`) o app falha fechado.
    if not SECRET_KEY:
        raise ImproperlyConfigured(
            "SECRET_KEY e obrigatoria fora do modo dev/teste (DEBUG falso)."
        )
    if (
        SECRET_KEY in _PLACEHOLDER_SECRET_KEYS
        or SECRET_KEY.lower().startswith(_PLACEHOLDER_PREFIXES)
        or len(SECRET_KEY) < 50
    ):
        raise ImproperlyConfigured(
            "SECRET_KEY invalida fora do modo dev/teste: valor de exemplo/placeholder "
            "ou menor que 50 caracteres. Gere uma chave aleatoria propria."
        )
    if not FIELD_ENCRYPTION_KEYS:
        raise ImproperlyConfigured(
            "FIELD_ENCRYPTION_KEYS e obrigatoria fora do modo dev/teste (DEBUG falso)."
        )
    if _DEV_FERNET_KEY in FIELD_ENCRYPTION_KEYS:
        raise ImproperlyConfigured(
            "FIELD_ENCRYPTION_KEYS contem a chave de desenvolvimento, proibida "
            "fora do modo dev/teste."
        )
    for _key in FIELD_ENCRYPTION_KEYS:
        try:
            Fernet(_key.encode())
        except (ValueError, TypeError) as exc:
            raise ImproperlyConfigured(
                "FIELD_ENCRYPTION_KEYS contem chave Fernet invalida."
            ) from exc

ALLOWED_HOSTS = env_list(
    "ALLOWED_HOSTS",
    "localhost,127.0.0.1,testserver,ct-novos-talentos.onrender.com"
)

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "common",
    "accounts",
    "bookings",
    "notifications",
    "site_pages",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

DATABASES = {
    "default": dj_database_url.config(default="sqlite:///" + str(BASE_DIR / "db.sqlite3"))
}

AUTH_USER_MODEL = "accounts.User"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

if TESTING:
    # Hasher rapido so nos testes (a suite gastava ~60s em hash de senha).
    # Producao mantem os hashers padrao do Django.
    PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]

LANGUAGE_CODE = "pt-br"
TIME_ZONE = "America/Sao_Paulo"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATICFILES_DIRS = [BASE_DIR / "static"]
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedStaticFilesStorage"},
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

LOGIN_URL = "/entrar/"
CSRF_FAILURE_VIEW = "common.http.csrf_failure"

# Regras de reserva: weekday (0=segunda) -> (hora_abre, hora_fecha).
BUSINESS_HOURS = {d: (18, 23) for d in range(5)}
BOOKING_MAX_HOURS = 4

# Notificacoes
STAFF_NOTIFY_EMAIL = os.environ.get("STAFF_NOTIFY_EMAIL", "ctnovostalentos@hotmail.com")
WHATSAPP_ENABLED = env_bool("WHATSAPP_ENABLED", False)
DEFAULT_FROM_EMAIL = os.environ.get(
    "DEFAULT_FROM_EMAIL", "CT Novos Talentos <nao-responda@localhost>"
)
if DEV_MODE:
    EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"
else:
    EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
EMAIL_HOST = os.environ.get("EMAIL_HOST", "localhost")
EMAIL_PORT = int(os.environ.get("EMAIL_PORT", "587"))
EMAIL_HOST_USER = os.environ.get("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.environ.get("EMAIL_HOST_PASSWORD", "")
EMAIL_USE_TLS = env_bool("EMAIL_USE_TLS", True)
# Sem timeout o smtplib espera para sempre e a requisicao de reserva trava.
EMAIL_TIMEOUT = int(os.environ.get("EMAIL_TIMEOUT", "10"))

# Rate limit (por IP, cache local)
# Number of reverse proxies in front of the app that append to X-Forwarded-For.
# 0 = ignore the header and use REMOTE_ADDR only (header is spoofable).
TRUSTED_PROXY_COUNT = int(os.environ.get("TRUSTED_PROXY_COUNT", "0"))
LOGIN_MAX_ATTEMPTS = 5
# Falhas por IP (qualquer e-mail) na mesma janela.
LOGIN_MAX_ATTEMPTS_PER_IP = int(os.environ.get("LOGIN_MAX_ATTEMPTS_PER_IP", "30"))
LOGIN_WINDOW_SECONDS = 900
REGISTER_MAX_PER_HOUR = 10
PASSWORD_RESET_MAX_PER_HOUR = int(os.environ.get("PASSWORD_RESET_MAX_PER_HOUR", "10"))
# Demonstração pública de criptografia (/api/crypto/demo): operações por IP por minuto.
CRYPTO_DEMO_MAX_PER_MINUTE = int(os.environ.get("CRYPTO_DEMO_MAX_PER_MINUTE", "60"))

if not DEV_MODE:
    SECURE_SSL_REDIRECT = True
    # HSTS conservador por padrao (1h); subir aos poucos, ver docs/DEPLOY.md.
    SECURE_HSTS_SECONDS = int(os.environ.get("SECURE_HSTS_SECONDS", "3600"))
    SECURE_HSTS_INCLUDE_SUBDOMAINS = env_bool("SECURE_HSTS_INCLUDE_SUBDOMAINS", False)
    SECURE_HSTS_PRELOAD = env_bool("SECURE_HSTS_PRELOAD", False)
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SESSION_COOKIE_SECURE = True
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    CSRF_COOKIE_SECURE = True
    CSRF_COOKIE_SAMESITE = "Lax"
    CSRF_TRUSTED_ORIGINS = env_list("CSRF_TRUSTED_ORIGINS")
    SECURE_CONTENT_TYPE_NOSNIFF = True
    SECURE_REFERRER_POLICY = "same-origin"

# Erros 500 (django.request) e de seguranca (django.security) vao para o console/stderr,
# visiveis nos logs da plataforma. Mensagens de excecao nao carregam segredos.
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"plain": {"format": "%(asctime)s %(levelname)s %(name)s %(message)s"}},
    "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "plain"}},
    "loggers": {
        "django.request": {"handlers": ["console"], "level": "ERROR", "propagate": False},
        "django.security": {"handlers": ["console"], "level": "ERROR", "propagate": False},
    },
}
