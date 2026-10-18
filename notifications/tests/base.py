from datetime import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.contrib.auth import get_user_model
from django.test import TestCase

from bookings import services
from bookings.models import Field

TZ = ZoneInfo("America/Sao_Paulo")
NOW = datetime(2026, 10, 19, 12, 0, tzinfo=TZ)
SECRET_CONTACT = "SEGREDO-123"
SECRET_MESSAGE = "MSG-SECRETA"


def at(day, hour):
    return datetime(2026, 10, day, hour, 0, tzinfo=TZ)


class Base(TestCase):
    def setUp(self):
        User = get_user_model()
        self.ana = User.objects.create_user("ana@x.com", "senha-forte-1", name="Ana")
        self.staff = User.objects.create_user("adm@x.com", "senha-forte-1", name="Adm",
                                              is_staff=True)
        self.field = Field.objects.create(name="Campo 1", price_per_hour=Decimal("100"))

    def book(self):
        return services.create_booking(self.ana, self.field, at(20, 19), at(20, 20),
                                       SECRET_CONTACT, SECRET_MESSAGE, now=NOW)
