from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase, override_settings

from accounts.models import User
from bookings.models import Field


class SeedTests(TestCase):
    @override_settings(DEBUG=True)
    def test_idempotent(self):
        call_command("seed_demo")
        call_command("seed_demo")
        self.assertEqual(Field.objects.filter(name="Quadra Society").count(), 1)
        self.assertEqual(User.objects.count(), 3)
        self.assertTrue(User.objects.get(email="equipe@exemplo.test").is_staff)
        self.assertTrue(User.objects.get(email="cliente@exemplo.test").check_password("Demo-12345-Senha"))

    @override_settings(DEBUG=False)
    def test_refuses_without_debug(self):
        with self.assertRaises(CommandError):
            call_command("seed_demo")


class SeedGroupTests(TestCase):
    @override_settings(DEBUG=True)
    def test_group_idempotent(self):
        from django.contrib.auth.models import Group
        call_command("seed_demo")
        n = Group.objects.get(name="Equipe").permissions.count()
        call_command("seed_demo")
        self.assertEqual(Group.objects.filter(name="Equipe").count(), 1)
        self.assertEqual(Group.objects.get(name="Equipe").permissions.count(), n)
        self.assertEqual(User.objects.get(email="equipe@exemplo.test").groups.count(), 1)
