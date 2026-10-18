from django.contrib.auth.models import Group, Permission
from django.test import TestCase
from django.urls import reverse

from accounts.models import User
from bookings.management.commands.seed_demo import EQUIPE_GROUP

PW = "pw-12345-Abc"


class UserAdminTests(TestCase):
    def setUp(self):
        self.su = User.objects.create_superuser("root@x.test", PW, name="Root")
        self.client.force_login(self.su)

    def test_change_page_hides_phone(self):
        u = User.objects.create_user("c@x.test", PW, name="Cli")
        u.phone = "(19) 99911-7711"
        u.save()
        r = self.client.get(reverse("admin:accounts_user_change", args=[u.pk]))
        self.assertEqual(r.status_code, 200)
        text = r.content.decode()
        self.assertNotIn("phone_enc", text)
        self.assertNotIn(u.phone_enc, text)
        self.assertNotIn("99911", text)

    def test_changelist_and_password_change(self):
        u = User.objects.create_user("c@x.test", PW, name="Cli")
        self.assertEqual(self.client.get(reverse("admin:accounts_user_changelist")).status_code, 200)
        url = reverse("admin:auth_user_password_change", args=[u.pk])
        r = self.client.get(url)
        self.assertEqual(r.status_code, 200)

    def test_superuser_creates_user(self):
        r = self.client.post(reverse("admin:accounts_user_add"), {
            "email": "novo@x.test", "name": "Novo",
            "password1": "Outra-Senha-9876", "password2": "Outra-Senha-9876"})
        self.assertEqual(r.status_code, 302, getattr(r, "context", None) and r.context["adminform"].form.errors)
        self.assertTrue(User.objects.get(email="novo@x.test").check_password("Outra-Senha-9876"))


class EquipeGroupAdminTests(TestCase):
    def setUp(self):
        from django.core.management import call_command
        from django.test import override_settings
        with override_settings(DEBUG=True):
            call_command("seed_demo")
        self.staff = User.objects.get(email="equipe@exemplo.test")
        self.client.force_login(self.staff)

    def test_staff_sees_bookings_not_users(self):
        r = self.client.get(reverse("admin:bookings_bookingrequest_changelist"))
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.client.get(reverse("admin:bookings_auditevent_changelist")).status_code, 200)
        self.assertEqual(self.client.get(reverse("admin:notifications_notification_changelist")).status_code, 200)
        self.assertEqual(self.client.get(reverse("admin:accounts_user_changelist")).status_code, 403)

    def test_group_has_no_user_perms_and_is_view_only_on_audit(self):
        g = Group.objects.get(name=EQUIPE_GROUP)
        codes = set(g.permissions.values_list("codename", flat=True))
        self.assertFalse({c for c in codes if c.endswith("_user")})
        self.assertIn("view_auditevent", codes)
        self.assertNotIn("change_auditevent", codes)
        self.assertIn("change_bookingrequest", codes)

    def test_user_perm_grant_opens_user_admin(self):
        perm = Permission.objects.get(codename="view_user", content_type__app_label="accounts")
        self.staff.user_permissions.add(perm)
        self.client.force_login(User.objects.get(pk=self.staff.pk))
        self.assertEqual(self.client.get(reverse("admin:accounts_user_changelist")).status_code, 200)
