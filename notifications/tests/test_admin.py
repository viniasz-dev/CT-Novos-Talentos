from django.contrib import admin

from notifications.models import Notification

from .base import Base


class AdminTests(Base):
    def test_readonly(self):
        ma = admin.site._registry[Notification]
        req = type("R", (), {"user": self.staff})()
        self.assertFalse(ma.has_add_permission(req))
        self.assertFalse(ma.has_change_permission(req))
        self.assertFalse(ma.has_delete_permission(req))
