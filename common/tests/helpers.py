import json
from datetime import datetime, timedelta

from django.test import Client
from django.utils import timezone

from accounts.models import User
from bookings import services
from bookings.models import Field

PW = "pw-12345-Abc"
CONTACT = "(19) 99911-7711"
MESSAGE = "Aniversario do Zeca"


def future_slot(hour=19, days=3):
    tz = timezone.get_current_timezone()
    day = (timezone.now() + timedelta(days=days)).astimezone(tz).date()
    while day.weekday() > 4:
        day += timedelta(days=1)
    start = datetime(day.year, day.month, day.day, hour, tzinfo=tz)
    return start, start + timedelta(hours=1)


def post_json(client, url, data, **extra):
    return client.post(url, json.dumps(data), content_type="application/json", **extra)


class World:
    """Usuarios, campo e helpers comuns."""

    def make_world(self):
        self.user_a = User.objects.create_user("a@x.test", PW, name="A")
        self.user_b = User.objects.create_user("b@x.test", PW, name="B")
        self.staff = User.objects.create_user("s@x.test", PW, name="S", is_staff=True)
        self.field = Field.objects.create(name="Campo 1", price_per_hour="150.00")
        self.start, self.end = future_slot()

    def make_booking(self, user=None, start=None, end=None, contact=CONTACT, message=MESSAGE):
        return services.create_booking(
            user or self.user_a, self.field, start or self.start, end or self.end,
            contact, message)

    def client_for(self, user, **kw):
        c = Client(**kw)
        c.force_login(user)
        return c

    def payload(self, **over):
        data = {"field": self.field.pk, "start": self.start.isoformat(),
                "end": self.end.isoformat(), "contact": CONTACT, "message": MESSAGE}
        data.update(over)
        return data
