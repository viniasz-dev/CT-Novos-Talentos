"""Settings de producao carregadas em subprocesso com env simulado e limpo."""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

from cryptography.fernet import Fernet
from django.test import SimpleTestCase

BASE_DIR = Path(__file__).resolve().parents[2]
PYTHON = sys.executable

# Chaves geradas a cada execucao, so para estes testes (nao existem em lugar nenhum).
TEST_FERNET = Fernet.generate_key().decode()
TEST_SECRET = "t3st-only-" + "x9Kp2LmQ7vR4sT8wZ1" * 3

PROD_ENV = {
    "SECRET_KEY": TEST_SECRET,
    "FIELD_ENCRYPTION_KEYS": TEST_FERNET,
    "ALLOWED_HOSTS": "reservas.exemplo.test,www.exemplo.test",
    "CSRF_TRUSTED_ORIGINS": "https://reservas.exemplo.test",
    "DATABASE_URL": "sqlite:///prod-settings-test.sqlite3",
}

PROBE = (
    "import json, django;"
    "from django.conf import settings as s;"
    "django.setup();"
    "print('JSON:' + json.dumps({"
    "'DEBUG': s.DEBUG, 'SESSION_COOKIE_SECURE': s.SESSION_COOKIE_SECURE,"
    "'CSRF_COOKIE_SECURE': s.CSRF_COOKIE_SECURE,"
    "'SECURE_SSL_REDIRECT': s.SECURE_SSL_REDIRECT,"
    "'SECURE_HSTS_SECONDS': s.SECURE_HSTS_SECONDS,"
    "'HSTS_SUB': s.SECURE_HSTS_INCLUDE_SUBDOMAINS,"
    "'HSTS_PRELOAD': s.SECURE_HSTS_PRELOAD,"
    "'ALLOWED_HOSTS': s.ALLOWED_HOSTS,"
    "'CSRF_TRUSTED_ORIGINS': s.CSRF_TRUSTED_ORIGINS}))"
)


def scrubbed_env(**extra):
    keep = {k: v for k, v in os.environ.items() if k in ("SYSTEMROOT", "PATH", "TEMP", "TMP")}
    keep["DJANGO_SETTINGS_MODULE"] = "config.settings"
    # Hermetico: ignora qualquer .env local (README manda copiar .env.example com
    # DEBUG=true) e fixa o modo producao. Os testes podem sobrescrever via extra.
    keep["DISABLE_DOTENV"] = "1"
    keep["DEBUG"] = "false"
    keep.update(extra)
    return keep


def run(args, env):
    return subprocess.run(
        [PYTHON, *args], cwd=BASE_DIR, env=env, capture_output=True, text=True, timeout=120
    )


def probe(env):
    return run(["-c", PROBE], env)


class ProdSettingsFailClosed(SimpleTestCase):
    def assertFails(self, env, text):
        result = probe(env)
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn(text, result.stderr)

    def test_missing_secret_key_fails(self):
        env = {k: v for k, v in PROD_ENV.items() if k != "SECRET_KEY"}
        self.assertFails(scrubbed_env(**env), "SECRET_KEY")

    def test_missing_field_encryption_keys_fails(self):
        env = {k: v for k, v in PROD_ENV.items() if k != "FIELD_ENCRYPTION_KEYS"}
        self.assertFails(scrubbed_env(**env), "FIELD_ENCRYPTION_KEYS")

    def test_placeholder_secret_key_fails(self):
        example = (BASE_DIR / ".env.example").read_text(encoding="utf-8")
        placeholder = re.search(r"^SECRET_KEY=(.+)$", example, re.M).group(1).strip()
        env = dict(PROD_ENV, SECRET_KEY=placeholder)
        self.assertFails(scrubbed_env(**env), "SECRET_KEY")

    def test_dev_secret_key_fails_in_prod(self):
        env = dict(PROD_ENV, SECRET_KEY="dev-insecure-secret-key-do-not-use-in-production")
        self.assertFails(scrubbed_env(**env), "SECRET_KEY")

    def test_short_secret_key_fails(self):
        env = dict(PROD_ENV, SECRET_KEY="curta")
        self.assertFails(scrubbed_env(**env), "SECRET_KEY")

    def test_invalid_fernet_key_fails(self):
        env = dict(PROD_ENV, FIELD_ENCRYPTION_KEYS="isto-nao-e-uma-chave-fernet")
        self.assertFails(scrubbed_env(**env), "FIELD_ENCRYPTION_KEYS")

    def test_dev_fernet_key_fails_in_prod(self):
        env = dict(PROD_ENV, FIELD_ENCRYPTION_KEYS="ZGV2LWluc2VjdXJlLWZlcm5ldC1rZXktMDAwMDAwMDA=")
        self.assertFails(scrubbed_env(**env), "FIELD_ENCRYPTION_KEYS")

    def test_error_messages_do_not_claim_debug_false_only(self):
        env = {k: v for k, v in PROD_ENV.items() if k != "SECRET_KEY"}
        result = probe(scrubbed_env(**env))
        self.assertNotIn("DEBUG=false", result.stderr)


class ProdSettingsValues(SimpleTestCase):
    def load(self, **overrides):
        result = probe(scrubbed_env(**dict(PROD_ENV, **overrides)))
        self.assertEqual(result.returncode, 0, result.stderr)
        line = next(l for l in result.stdout.splitlines() if l.startswith("JSON:"))
        return json.loads(line[5:])

    def test_secure_defaults(self):
        cfg = self.load()
        self.assertIs(cfg["DEBUG"], False)
        self.assertIs(cfg["SESSION_COOKIE_SECURE"], True)
        self.assertIs(cfg["CSRF_COOKIE_SECURE"], True)
        self.assertIs(cfg["SECURE_SSL_REDIRECT"], True)
        self.assertGreater(cfg["SECURE_HSTS_SECONDS"], 0)
        self.assertEqual(cfg["ALLOWED_HOSTS"], ["reservas.exemplo.test", "www.exemplo.test"])
        self.assertEqual(cfg["CSRF_TRUSTED_ORIGINS"], ["https://reservas.exemplo.test"])

    def test_hsts_conservative_by_default(self):
        cfg = self.load()
        self.assertEqual(cfg["SECURE_HSTS_SECONDS"], 3600)
        self.assertIs(cfg["HSTS_SUB"], False)
        self.assertIs(cfg["HSTS_PRELOAD"], False)

    def test_hsts_rampup_from_env(self):
        cfg = self.load(
            SECURE_HSTS_SECONDS="31536000",
            SECURE_HSTS_INCLUDE_SUBDOMAINS="true",
            SECURE_HSTS_PRELOAD="true",
        )
        self.assertEqual(cfg["SECURE_HSTS_SECONDS"], 31536000)
        self.assertIs(cfg["HSTS_SUB"], True)
        self.assertIs(cfg["HSTS_PRELOAD"], True)

    def test_empty_allowed_hosts_in_prod(self):
        env = {k: v for k, v in PROD_ENV.items() if k != "ALLOWED_HOSTS"}
        result = probe(scrubbed_env(**env))
        self.assertEqual(result.returncode, 0, result.stderr)
        line = next(l for l in result.stdout.splitlines() if l.startswith("JSON:"))
        self.assertEqual(json.loads(line[5:])["ALLOWED_HOSTS"], [])


class CheckDeploy(SimpleTestCase):
    def test_check_deploy_has_no_warnings_with_full_hsts(self):
        env = scrubbed_env(
            **PROD_ENV,
            SECURE_HSTS_SECONDS="31536000",
            SECURE_HSTS_INCLUDE_SUBDOMAINS="true",
            SECURE_HSTS_PRELOAD="true",
        )
        result = run(["manage.py", "check", "--deploy", "--fail-level", "WARNING"], env)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("no issues", result.stdout + result.stderr)

    def test_check_deploy_default_hsts_has_no_error(self):
        # HSTS curto/sem subdominios gera so avisos de baixa severidade; nada de ERROR.
        result = run(
            ["manage.py", "check", "--deploy", "--fail-level", "ERROR"],
            scrubbed_env(**PROD_ENV),
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


class EnvExample(SimpleTestCase):
    FERNET_RE = re.compile(r"\b[A-Za-z0-9_-]{43}=")

    def test_env_example_has_no_real_looking_secrets(self):
        text = (BASE_DIR / ".env.example").read_text(encoding="utf-8")
        self.assertIsNone(self.FERNET_RE.search(text))
        values = dict(
            line.split("=", 1)
            for line in text.splitlines()
            if "=" in line and not line.lstrip().startswith("#")
        )
        self.assertEqual(values["FIELD_ENCRYPTION_KEYS"].strip(), "")
        self.assertEqual(values["EMAIL_HOST_PASSWORD"].strip(), "")
        self.assertLess(len(values["SECRET_KEY"].strip()), 40)
