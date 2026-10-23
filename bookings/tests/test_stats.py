from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from django.test import Client, TestCase

from accounts.models import User
from bookings import stats
from bookings.models import BookingRequest, Field
from common.tests.helpers import PW

SP = ZoneInfo("America/Sao_Paulo")
NOW = datetime(2030, 1, 7, 10, 0, tzinfo=SP)  # segunda-feira


def at(day, hour):
    return datetime(2030, 1, day, hour, 0, tzinfo=SP)


class StatsMathTests(TestCase):
    def setUp(self):
        Field.objects.all().delete()  # campo padrão da migration 0002
        self.user = User.objects.create_user("a@x.test", PW, name="A")
        self.f1 = Field.objects.create(name="Campo 1", price_per_hour="150.00")
        self.f2 = Field.objects.create(name="Campo 2", price_per_hour="100.00", active=False)

    def book(self, start, hours=1, status="aprovado", field=None):
        return BookingRequest.objects.create(user=self.user, field=field or self.f1, start=start,
                                             end=start + timedelta(hours=hours), status=status)

    def test_empty_db_is_zero(self):
        BookingRequest.objects.all().delete()
        Field.objects.all().delete()
        d = stats.dashboard(now=NOW)
        self.assertEqual(
            {k: d[k] for k in ("pending", "approved_next7", "booked_hours_next7",
                               "occupancy_next7", "lost_last30", "revenue_next7")},
            {"pending": 0, "approved_next7": 0, "booked_hours_next7": 0.0,
             "occupancy_next7": 0.0, "lost_last30": 0, "revenue_next7": "0.00"})

    def fixture(self):
        self.book(at(7, 0))             # exatamente no início da janela: entra
        self.book(at(7, 19), hours=2)   # segunda 19-21
        self.book(at(11, 18))           # sexta 18-19
        self.book(at(14, 18))           # segunda seguinte 00:00 = fim exclusivo: fora
        self.book(at(4, 18))            # antes da janela: fora
        self.book(at(8, 18), status="pendente")   # pendente futuro: conta
        self.book(at(6, 8), status="pendente")    # pendente que já terminou: não conta
        self.book(at(9, 20), field=self.f2)       # campo inativo: fora do total
        old = self.book(at(8, 21), status="cancelado")
        older = self.book(at(8, 22), status="recusado")
        BookingRequest.objects.filter(pk=old.pk).update(updated_at=NOW - timedelta(days=10))
        BookingRequest.objects.filter(pk=older.pk).update(updated_at=NOW - timedelta(days=31))

    def test_known_fixture(self):
        self.fixture()
        d = stats.dashboard(now=NOW)
        self.assertEqual(d["pending"], 1)
        self.assertEqual(d["approved_next7"], 3)
        self.assertEqual(d["booked_hours_next7"], 4.0)
        # expediente seg-sex 18-23 = 5 dias x 5 h = 25 h (1 campo ativo); 4/25 = 16%
        self.assertEqual(d["occupancy_next7"], 16.0)
        self.assertEqual(d["revenue_next7"], "600.00")
        self.assertEqual(d["lost_last30"], 1)
        self.assertTrue(d["window"]["from"].startswith("2030-01-07T00:00:00"))
        self.assertTrue(d["window"]["to"].startswith("2030-01-14T00:00:00"))

    def test_field_filter(self):
        self.fixture()
        d = stats.dashboard(now=NOW, field=self.f2)
        self.assertEqual((d["approved_next7"], d["occupancy_next7"], d["revenue_next7"]),
                         (1, 4.0, "100.00"))

    def test_two_active_fields_double_capacity(self):
        self.f2.active = True
        self.f2.save()
        self.book(at(7, 19), hours=5)
        self.assertEqual(stats.dashboard(now=NOW)["occupancy_next7"], 10.0)  # 5 / 50

    def test_occupancy_capped_and_rounded(self):
        self.book(at(12, 0), hours=1)   # sábado: fora do expediente, mas aprovado
        self.assertEqual(stats.dashboard(now=NOW)["occupancy_next7"], 4.0)
        Field.objects.filter(pk=self.f1.pk).update(price_per_hour="33.33")
        self.book(at(8, 18), hours=2)
        d = stats.dashboard(now=NOW)
        self.assertEqual(d["revenue_next7"], "99.99")
        self.assertEqual(d["occupancy_next7"], 12.0)


class StatsApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("a@x.test", PW, name="A")
        self.staff = User.objects.create_user("s@x.test", PW, name="S", is_staff=True)
        self.field = Field.objects.create(name="Campo 1", price_per_hour="150.00")

    def staff_client(self):
        c = Client()
        c.force_login(self.staff)
        return c

    def test_authz(self):
        self.assertEqual(Client().get("/api/admin/stats").status_code, 401)
        c = Client()
        c.force_login(self.user)
        self.assertEqual(c.get("/api/admin/stats").status_code, 403)
        self.assertEqual(self.staff_client().post("/api/admin/stats").status_code, 405)

    def test_ok_and_keys(self):
        r = self.staff_client().get("/api/admin/stats")
        self.assertEqual(r.status_code, 200)
        for key in ("pending", "approved_next7", "booked_hours_next7", "occupancy_next7",
                    "lost_last30", "revenue_next7"):
            self.assertIn(key, r.json())

    def test_field_param(self):
        c = self.staff_client()
        self.assertEqual(c.get(f"/api/admin/stats?field={self.field.pk}").status_code, 200)
        self.assertEqual(c.get("/api/admin/stats?field=999999").status_code, 404)
        for bad in ("abc", "1.5", "-3", "0", "9" * 40):
            with self.subTest(bad=bad):
                r = c.get(f"/api/admin/stats?field={bad}")
                self.assertEqual((r.status_code, r.json()["error"]["code"]), (400, "invalid_field"))
