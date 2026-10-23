from bookings import services
from bookings.models import BookingRequest
from bookings.services import ValidationFailed

from .test_services import NOW, Base, at


class SeriesTests(Base):
    def make(self, kind, start=None, end=None, ranges=None):
        return services.create_booking_series(
            self.ana, self.field, start, end, "11 99999-0000", "", kind, ranges, now=NOW)

    def test_mensal_creates_four_weekly_bookings(self):
        out = self.make("mensal", at(20, 19), at(20, 20))
        self.assertEqual(len(out), 4)
        self.assertEqual({b.kind for b in out}, {"mensal"})
        self.assertEqual(len({b.series for b in out}), 1)
        self.assertEqual((out[3].start - out[0].start).days, 21)

    def test_torneio_free_ranges_any_length_and_days(self):
        # terça 18-23 (5h, mais que o limite avulso de 4h) + quinta 19-20
        out = self.make("torneio", ranges=[(at(22, 19), at(22, 20)), (at(20, 18), at(20, 23))])
        self.assertEqual([(b.start.day, b.end.hour) for b in out], [(20, 23), (22, 20)])

    def test_failure_rolls_back_whole_series_and_names_the_day(self):
        # sábado 24: campo fechado, nada pode ser criado
        with self.assertRaises(ValidationFailed) as ctx:
            self.make("torneio", ranges=[(at(20, 19), at(20, 20)), (at(24, 19), at(24, 20))])
        self.assertIn("24/10", ctx.exception.message)
        self.assertEqual(BookingRequest.objects.count(), 0)

    def test_torneio_needs_ranges_and_unknown_kind_rejected(self):
        self.assertEqual(self.code(ValidationFailed, self.make, "torneio", ranges=[]), "bad_ranges")
        self.assertEqual(self.code(ValidationFailed, self.make, "xyz", at(20, 19), at(20, 20)), "invalid_kind")
