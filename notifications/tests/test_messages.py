from notifications.messages import render

from .base import SECRET_CONTACT, SECRET_MESSAGE, Base


class RenderTests(Base):
    def test_no_secrets_and_has_fields(self):
        booking = self.book()
        for kind in ("created", "approved", "rejected", "cancelled"):
            subject, body = render(kind, booking)
            text = subject + body
            self.assertNotIn(SECRET_CONTACT, text)
            self.assertNotIn(SECRET_MESSAGE, text)
            self.assertNotIn("senha", text.lower())
            self.assertIn("Campo 1", body)
            self.assertIn("20/10/2026", body)
            self.assertIn("19:00", body)
            self.assertIn("Pendente", body)

    def test_unknown_kind(self):
        with self.assertRaises(ValueError):
            render("x", self.book())
