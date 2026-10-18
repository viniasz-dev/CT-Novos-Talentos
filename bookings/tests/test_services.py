from datetime import date, datetime, timedelta, timezone as dt_timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.contrib.auth import get_user_model
from django.test import TestCase

from bookings import services
from bookings.events import booking_event
from bookings.models import AuditEvent, BookingRequest, Field, TimeBlock
from bookings.services import Conflict, Forbidden, ValidationFailed

TZ = ZoneInfo("America/Sao_Paulo")
NOW = datetime(2026, 10, 19, 12, 0, tzinfo=TZ)  # segunda-feira


def at(day, hour, minute=0):
    """day: dia de outubro de 2026 (19 = segunda, 24 = sábado)."""
    return datetime(2026, 10, day, hour, minute, tzinfo=TZ)


class Base(TestCase):
    def setUp(self):
        User = get_user_model()
        self.ana = User.objects.create_user("ana", "ana@x.com", "senha-forte-1")
        self.bia = User.objects.create_user("bia", "bia@x.com", "senha-forte-1")
        self.staff = User.objects.create_user("adm", "adm@x.com", "senha-forte-1",
                                              is_staff=True)
        self.field = Field.objects.create(name="Campo 1", price_per_hour=Decimal("100"))

    def book(self, user=None, start=None, end=None, contact="11 99999-0000", message="",
             field=None):
        return services.create_booking(
            user or self.ana, field or self.field,
            start or at(20, 19), end or at(20, 20), contact, message, now=NOW)

    def code(self, exc_type, fn, *args, **kwargs):
        with self.assertRaises(exc_type) as ctx:
            fn(*args, **kwargs)
        return ctx.exception.code


class ValidateWindowTests(Base):
    def check(self, start, end, field=None):
        services.validate_window(field or self.field, start, end, now=NOW)

    def test_end_not_after_start(self):
        self.assertEqual(self.code(ValidationFailed, self.check, at(20, 19), at(20, 19)),
                         "invalid_range")
        self.assertEqual(self.code(ValidationFailed, self.check, at(20, 20), at(20, 19)),
                         "invalid_range")

    def test_not_aligned(self):
        self.assertEqual(
            self.code(ValidationFailed, self.check, at(20, 19, 30), at(20, 20, 30)),
            "not_aligned")

    def test_bad_duration(self):
        self.assertEqual(self.code(ValidationFailed, self.check, at(20, 18), at(20, 23)),
                         "bad_duration")

    def test_limit_four_hours_accepted(self):
        self.check(at(20, 18), at(20, 22))

    def test_last_slot_accepted(self):
        self.check(at(20, 22), at(20, 23))

    def test_past(self):
        self.assertEqual(self.code(ValidationFailed, self.check, at(19, 11), at(19, 12)),
                         "in_past")
        self.assertEqual(self.code(ValidationFailed, self.check, at(19, 12), at(19, 13)),
                         "in_past")

    def test_saturday_closed(self):
        self.assertEqual(self.code(ValidationFailed, self.check, at(24, 19), at(24, 20)),
                         "closed")

    def test_outside_hours_closed(self):
        self.assertEqual(self.code(ValidationFailed, self.check, at(20, 17), at(20, 18)),
                         "closed")
        self.assertEqual(self.code(ValidationFailed, self.check, at(20, 22), at(21, 0)),
                         "closed")
        self.assertEqual(self.code(ValidationFailed, self.check, at(20, 23), at(21, 0)),
                         "closed")

    def test_crossing_midnight_closed(self):
        self.assertEqual(self.code(ValidationFailed, self.check, at(20, 22), at(21, 2)),
                         "closed")

    def test_inactive_field(self):
        self.field.active = False
        self.assertEqual(self.code(ValidationFailed, self.check, at(20, 19), at(20, 20)),
                         "field_inactive")

    def test_naive_datetime(self):
        naive = datetime(2026, 10, 20, 19)
        self.assertEqual(
            self.code(ValidationFailed, self.check, naive, naive + timedelta(hours=1)),
            "naive_datetime")
        self.assertEqual(
            self.code(ValidationFailed, self.check, at(20, 19), datetime(2026, 10, 20, 20)),
            "naive_datetime")

    def test_other_timezone_converted_to_local(self):
        s = datetime(2026, 10, 20, 22, tzinfo=dt_timezone.utc)  # 19:00 local
        self.check(s, s + timedelta(hours=1))

    def test_utc_day_boundary_uses_local_day(self):
        s = datetime(2026, 10, 21, 1, tzinfo=dt_timezone.utc)  # 22:00 local do dia 20
        self.check(s, s + timedelta(hours=1))


class ConflictTests(Base):
    def test_over_approved(self):
        b = self.book()
        services.set_status(b, "aprovado", self.staff, now=NOW)
        self.assertEqual(self.code(Conflict, self.book, self.bia), "slot_taken")

    def test_over_block(self):
        services.create_block(self.field, at(20, 19), at(20, 20), "chuva", self.staff,
                              now=NOW)
        self.assertEqual(self.code(Conflict, self.book, self.bia), "blocked")

    def test_edges_do_not_conflict(self):
        b = self.book(start=at(20, 19), end=at(20, 20))
        services.set_status(b, "aprovado", self.staff, now=NOW)
        self.book(self.bia, at(20, 20), at(20, 21))
        self.book(self.bia, at(20, 18), at(20, 19))

    def test_two_pending_coexist(self):
        self.book(self.ana)
        self.book(self.bia)
        self.assertEqual(BookingRequest.objects.count(), 2)

    def test_same_user_duplicate(self):
        self.book(self.ana)
        self.assertEqual(self.code(Conflict, self.book, self.ana), "duplicate")

    def test_same_user_overlap(self):
        self.book(self.ana, at(20, 19), at(20, 21))
        self.assertEqual(
            self.code(Conflict, self.book, self.ana, at(20, 20), at(20, 22)), "duplicate")

    def test_same_user_adjacent_ok(self):
        self.book(self.ana, at(20, 19), at(20, 20))
        self.book(self.ana, at(20, 20), at(20, 21))

    def test_cancelled_does_not_duplicate(self):
        b = self.book(self.ana)
        services.cancel_booking(b, self.ana, now=NOW)
        self.book(self.ana)

    def test_find_conflicts_only_approved(self):
        pend = self.book(self.ana)
        c = services.find_conflicts(self.field, at(20, 19), at(20, 20))
        self.assertEqual(c["bookings"], [])
        services.set_status(pend, "aprovado", self.staff, now=NOW)
        c = services.find_conflicts(self.field, at(20, 19), at(20, 20))
        self.assertEqual([x.pk for x in c["bookings"]], [pend.pk])
        c = services.find_conflicts(self.field, at(20, 19), at(20, 20),
                                    exclude_booking_id=pend.pk)
        self.assertEqual(c["bookings"], [])


class ContactMessageTests(Base):
    def test_blank_contact(self):
        self.assertEqual(
            self.code(ValidationFailed, self.book, contact="   "), "invalid_contact")

    def test_contact_limit(self):
        self.book(contact="a" * 120)
        self.assertEqual(
            self.code(ValidationFailed, self.book, self.bia, contact="a" * 121),
            "invalid_contact")

    def test_contact_limit_counts_emoji_as_one_char(self):
        self.book(contact="😀" * 120)
        self.assertEqual(
            self.code(ValidationFailed, self.book, self.bia, contact="😀" * 121),
            "invalid_contact")

    def test_message_limit(self):
        self.book(message="m" * 500)
        self.assertEqual(
            self.code(ValidationFailed, self.book, self.bia, message="m" * 501),
            "invalid_message")
        self.assertEqual(
            self.code(ValidationFailed, self.book, self.bia, message="😀" * 501),
            "invalid_message")

    def test_non_string_contact(self):
        self.assertEqual(
            self.code(ValidationFailed, self.book, contact=123), "invalid_contact")

    def test_emoji_roundtrip(self):
        b = self.book(contact="João 😀", message="Vamos de 🏆")
        b = BookingRequest.objects.get(pk=b.pk)
        self.assertEqual(b.get_contact(), "João 😀")
        self.assertEqual(b.get_message(), "Vamos de 🏆")
        self.assertNotIn("João", b.contact_enc)
        self.assertEqual(b.status, "pendente")


class StaffCannotBookTests(Base):
    def test_staff_create_booking_forbidden(self):
        with self.assertRaises(Forbidden) as ctx:
            self.book(self.staff)
        self.assertEqual(ctx.exception.code, "staff_cannot_book")
        self.assertEqual(ctx.exception.status, 403)
        self.assertIn("Bloquear horário", ctx.exception.message)
        self.assertFalse(BookingRequest.objects.exists())
        self.assertFalse(AuditEvent.objects.filter(action="booking.created").exists())

    def test_staff_check_runs_before_validation(self):
        # Mesmo com dados ruins a resposta para a equipe é a regra, não um erro de campo.
        with self.assertRaises(Forbidden) as ctx:
            services.create_booking(self.staff, self.field, at(19, 11), at(19, 12), "", now=NOW)
        self.assertEqual(ctx.exception.code, "staff_cannot_book")

    def test_client_still_books(self):
        self.assertEqual(self.book(self.ana).status, "pendente")


class TransitionTests(Base):
    def test_customer_cannot_set_status(self):
        b = self.book()
        self.assertEqual(self.code(Forbidden, services.set_status, b, "aprovado",
                                   self.ana, now=NOW), "forbidden")

    def test_approve_sets_decided_by(self):
        b = self.book()
        b = services.set_status(b, "aprovado", self.staff, now=NOW)
        b.refresh_from_db()
        self.assertEqual(b.status, "aprovado")
        self.assertEqual(b.decided_by, self.staff)

    def test_approve_second_same_slot(self):
        a = self.book(self.ana)
        b = self.book(self.bia)
        services.set_status(a, "aprovado", self.staff, now=NOW)
        self.assertEqual(self.code(Conflict, services.set_status, b, "aprovado",
                                   self.staff, now=NOW), "slot_taken")
        b.refresh_from_db()
        self.assertEqual(b.status, "pendente")

    def test_reject_then_approve_invalid(self):
        b = self.book()
        services.set_status(b, "recusado", self.staff, now=NOW)
        self.assertEqual(self.code(Conflict, services.set_status, b, "aprovado",
                                   self.staff, now=NOW), "invalid_transition")

    def test_unknown_status(self):
        b = self.book()
        self.assertEqual(self.code(Conflict, services.set_status, b, "xyz",
                                   self.staff, now=NOW), "invalid_transition")

    def test_approve_past(self):
        b = self.book()
        self.assertEqual(self.code(ValidationFailed, services.set_status, b, "aprovado",
                                   self.staff, now=at(20, 19, 30)), "in_past")

    def test_approve_over_block(self):
        b = self.book()
        TimeBlock.objects.create(field=self.field, start=at(20, 19), end=at(20, 20))
        self.assertEqual(self.code(Conflict, services.set_status, b, "aprovado",
                                   self.staff, now=NOW), "blocked")

    def test_owner_cancels_pending_and_approved(self):
        p = self.book(self.ana, at(20, 19), at(20, 20))
        a = self.book(self.ana, at(21, 19), at(21, 20))
        services.set_status(a, "aprovado", self.staff, now=NOW)
        self.assertEqual(services.cancel_booking(p, self.ana, now=NOW).status, "cancelado")
        self.assertEqual(services.cancel_booking(a, self.ana, now=NOW).status, "cancelado")

    def test_owner_cancel_after_start_too_late(self):
        b = self.book()
        services.set_status(b, "aprovado", self.staff, now=NOW)
        self.assertEqual(self.code(Conflict, services.cancel_booking, b, self.ana,
                                   now=at(20, 19, 30)), "too_late")
        self.assertEqual(self.code(Conflict, services.cancel_booking, b, self.ana,
                                   now=at(20, 19)), "too_late")

    def test_other_user_cannot_cancel(self):
        b = self.book()
        self.assertEqual(self.code(Forbidden, services.cancel_booking, b, self.bia,
                                   now=NOW), "forbidden")

    def test_staff_cancels_any_even_after_start(self):
        b = self.book()
        services.set_status(b, "aprovado", self.staff, now=NOW)
        out = services.cancel_booking(b, self.staff, now=at(20, 19, 30))
        self.assertEqual(out.status, "cancelado")

    def test_cancel_final_state_invalid(self):
        b = self.book()
        services.cancel_booking(b, self.ana, now=NOW)
        self.assertEqual(self.code(Conflict, services.cancel_booking, b, self.ana,
                                   now=NOW), "invalid_transition")

    def test_cancel_frees_slot(self):
        b = self.book(self.ana)
        services.set_status(b, "aprovado", self.staff, now=NOW)
        services.cancel_booking(b, self.ana, now=NOW)
        self.book(self.bia)


class BlockTests(Base):
    def test_block_over_approved(self):
        b = self.book()
        services.set_status(b, "aprovado", self.staff, now=NOW)
        with self.assertRaises(Conflict) as ctx:
            services.create_block(self.field, at(20, 18), at(20, 21), "x", self.staff,
                                  now=NOW)
        self.assertEqual(ctx.exception.code, "slot_taken")
        self.assertEqual(ctx.exception.fields, {"conflicts": [b.pk]})

    def test_block_over_pending_allowed(self):
        self.book()
        services.create_block(self.field, at(20, 19), at(20, 20), "x", self.staff, now=NOW)

    def test_block_then_booking_blocked_then_delete_frees(self):
        blk = services.create_block(self.field, at(20, 19), at(20, 20), "chuva",
                                    self.staff, now=NOW)
        self.assertEqual(self.code(Conflict, self.book), "blocked")
        services.delete_block(blk, self.staff)
        self.assertFalse(TimeBlock.objects.exists())
        self.book()

    def test_block_requires_staff(self):
        self.assertEqual(self.code(Forbidden, services.create_block, self.field,
                                   at(20, 19), at(20, 20), "x", self.ana, now=NOW),
                         "forbidden")
        blk = TimeBlock.objects.create(field=self.field, start=at(20, 19), end=at(20, 20))
        self.assertEqual(self.code(Forbidden, services.delete_block, blk, self.ana),
                         "forbidden")

    def test_block_invalid_range_and_naive(self):
        self.assertEqual(self.code(ValidationFailed, services.create_block, self.field,
                                   at(20, 20), at(20, 19), "x", self.staff, now=NOW),
                         "invalid_range")
        self.assertEqual(self.code(ValidationFailed, services.create_block, self.field,
                                   datetime(2026, 10, 20, 19), at(20, 20), "x", self.staff,
                                   now=NOW), "naive_datetime")


class AvailabilityTests(Base):
    def test_day_slots_states(self):
        approved = self.book(self.ana, at(20, 19), at(20, 20))
        services.set_status(approved, "aprovado", self.staff, now=NOW)
        services.create_block(self.field, at(20, 21), at(20, 22), "x", self.staff, now=NOW)
        self.book(self.bia, at(20, 22), at(20, 23))  # pendente não bloqueia
        out = services.day_slots(self.field, date(2026, 10, 20), now=NOW)
        self.assertTrue(out["open"])
        states = {s["start"][11:13]: s["state"] for s in out["slots"]}
        self.assertEqual(states, {"18": "free", "19": "booked", "20": "free",
                                  "21": "blocked", "22": "free"})
        self.assertEqual(out["slots"][0]["start"], "2026-10-20T18:00:00-03:00")
        self.assertEqual(out["slots"][0]["end"], "2026-10-20T19:00:00-03:00")

    def test_day_slots_past(self):
        out = services.day_slots(self.field, date(2026, 10, 19), now=at(19, 20, 30))
        states = [s["state"] for s in out["slots"]]
        self.assertEqual(states, ["past", "past", "past", "free", "free"])

    def test_closed_day(self):
        self.assertEqual(services.day_slots(self.field, date(2026, 10, 24), now=NOW),
                         {"open": False, "slots": []})

    def test_month_overview(self):
        b = self.book(self.ana, at(20, 19), at(20, 21))
        services.set_status(b, "aprovado", self.staff, now=NOW)
        out = services.month_overview(self.field, date(2026, 10, 19), date(2026, 10, 25),
                                      now=NOW)
        self.assertEqual(len(out), 7)
        self.assertEqual(out["2026-10-20"], {"open": True, "free": 3, "total": 5})
        self.assertEqual(out["2026-10-21"], {"open": True, "free": 5, "total": 5})
        self.assertEqual(out["2026-10-24"], {"open": False, "free": 0, "total": 0})
        self.assertEqual(out["2026-10-19"], {"open": True, "free": 5, "total": 5})

    def test_month_overview_range_limit(self):
        services.month_overview(self.field, date(2026, 10, 1), date(2026, 11, 1), now=NOW)
        with self.assertRaises(ValidationFailed) as ctx:
            services.month_overview(self.field, date(2026, 10, 1), date(2026, 11, 2),
                                    now=NOW)
        self.assertEqual(ctx.exception.code, "bad_range")
        with self.assertRaises(ValidationFailed):
            services.month_overview(self.field, date(2026, 10, 5), date(2026, 10, 1),
                                    now=NOW)


class EventTests(Base):
    def setUp(self):
        super().setUp()
        self.events = []

        def receiver(sender, **kw):
            self.events.append((kw["kind"], kw["booking"].pk, kw["actor"]))

        self.receiver = receiver
        booking_event.connect(receiver)
        self.addCleanup(booking_event.disconnect, receiver)

    def actions(self):
        return list(AuditEvent.objects.order_by("id").values_list("action", flat=True))

    def test_created(self):
        b = self.book()
        self.assertEqual(self.events, [("created", b.pk, self.ana)])
        self.assertEqual(self.actions(), ["booking.created"])
        ev = AuditEvent.objects.get()
        self.assertEqual(ev.object_id, str(b.pk))
        self.assertNotIn("99999", str(ev.meta))

    def test_approved_rejected_cancelled(self):
        a = self.book(self.ana, at(20, 19), at(20, 20))
        r = self.book(self.bia, at(21, 19), at(21, 20))
        services.set_status(a, "aprovado", self.staff, now=NOW)
        services.set_status(r, "recusado", self.staff, now=NOW)
        services.cancel_booking(a, self.ana, now=NOW)
        self.assertEqual([e[0] for e in self.events],
                         ["created", "created", "approved", "rejected", "cancelled"])
        self.assertEqual(self.actions(),
                         ["booking.created", "booking.created", "booking.approved",
                          "booking.rejected", "booking.cancelled"])

    def test_blocks_audit_only(self):
        blk = services.create_block(self.field, at(20, 19), at(20, 20), "x", self.staff,
                                    now=NOW)
        services.delete_block(blk, self.staff)
        self.assertEqual(self.actions(), ["block.created", "block.deleted"])
        self.assertEqual(self.events, [])

    def test_failure_emits_nothing(self):
        self.code(ValidationFailed, self.book, contact=" ")
        self.assertEqual(self.events, [])
        self.assertEqual(self.actions(), [])
