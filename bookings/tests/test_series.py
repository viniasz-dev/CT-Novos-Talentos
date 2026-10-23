from bookings import services
from bookings.models import BookingRequest
from bookings.services import ValidationFailed

from .test_services import NOW, Base, at


class SeriesTests(Base):
    def make(self, kind, start, end, days=1):
        return services.create_booking_series(
            self.ana, self.field, start, end, "11 99999-0000", "", kind, days, now=NOW)

    def test_mensal_creates_four_weekly_bookings(self):
        out = self.make("mensal", at(20, 19), at(20, 20))
        self.assertEqual(len(out), 4)
        self.assertEqual({b.kind for b in out}, {"mensal"})
        self.assertEqual(len({b.series for b in out}), 1)
        self.assertEqual((out[3].start - out[0].start).days, 21)

    def test_torneio_consecutive_days(self):
        out = self.make("torneio", at(20, 19), at(20, 21), days=3)
        self.assertEqual([b.start.day for b in out], [20, 21, 22])

    def test_failure_rolls_back_whole_series_and_names_the_day(self):
        # sexta 23 + 1 dia = sábado 24, campo fechado: nada pode ser criado
        with self.assertRaises(ValidationFailed) as ctx:
            self.make("torneio", at(23, 19), at(23, 20), days=2)
        self.assertIn("24/10", ctx.exception.message)
        self.assertEqual(BookingRequest.objects.count(), 0)

    def test_torneio_needs_days_and_unknown_kind_rejected(self):
        self.assertEqual(self.code(ValidationFailed, self.make, "torneio", at(20, 19), at(20, 20), 1), "bad_days")
        self.assertEqual(self.code(ValidationFailed, self.make, "xyz", at(20, 19), at(20, 20)), "invalid_kind")
