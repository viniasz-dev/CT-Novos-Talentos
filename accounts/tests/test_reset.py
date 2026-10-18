import re

from django.core import mail
from django.test import TestCase

from accounts.models import User


class PasswordResetTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("joao@x.com", "senha-forte-123", name="Joao")

    def test_pages_render(self):
        r = self.client.get("/senha/reset/")
        self.assertEqual(r.status_code, 200)
        self.assertContains(r, "csrfmiddlewaretoken")
        self.assertEqual(self.client.get("/senha/reset/enviado/").status_code, 200)
        self.assertEqual(self.client.get("/senha/reset/concluido/").status_code, 200)

    def test_same_result_existing_and_unknown(self):
        a = self.client.post("/senha/reset/", {"email": "joao@x.com"})
        b = self.client.post("/senha/reset/", {"email": "ninguem@x.com"})
        self.assertRedirects(a, "/senha/reset/enviado/")
        self.assertRedirects(b, "/senha/reset/enviado/")
        self.assertEqual(len(mail.outbox), 1)

    def test_email_link_sets_new_password(self):
        self.client.post("/senha/reset/", {"email": "joao@x.com"})
        body = mail.outbox[0].body
        self.assertEqual(mail.outbox[0].to, ["joao@x.com"])
        self.assertTrue(mail.outbox[0].subject.strip())
        self.assertNotIn("senha-forte-123", body)
        m = re.search(r"http://[^\s/]+(/senha/reset/[^\s]+)", body)
        self.assertTrue(m, body)
        r = self.client.get(m.group(1), follow=True)
        self.assertEqual(r.status_code, 200)
        r = self.client.post(
            r.request["PATH_INFO"],
            {"new_password1": "nova-senha-987", "new_password2": "nova-senha-987"},
        )
        self.assertRedirects(r, "/senha/reset/concluido/")
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("nova-senha-987"))

    def test_email_uses_project_template_in_portuguese(self):
        self.client.post("/senha/reset/", {"email": "joao@x.com"})
        body = mail.outbox[0].body
        self.assertIn("Recebemos um pedido para redefinir a senha", body)
        self.assertIn("CT Novos Talentos", body)
        # O texto padrão do Django repete o e-mail ("você é: ...") e assina com o domínio.
        self.assertNotIn("Caso você tenha esquecido", body)
