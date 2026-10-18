import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildMonthGrid,
  toggleSlot,
  selectionToRange,
  monthRange,
  shiftMonth,
  dayState,
  isISODate,
} from "../calendar.js";

// ---------- buildMonthGrid ----------

test("buildMonthGrid(2026, 9) starts on the Sunday before Oct 1 and has 5 or 6 weeks", () => {
  const weeks = buildMonthGrid(2026, 9, new Date(2026, 9, 18));
  assert.ok(weeks.length === 5 || weeks.length === 6, `weeks: ${weeks.length}`);
  for (const week of weeks) assert.equal(week.length, 7);
  // 1 de outubro de 2026 é quinta-feira: a grade começa no domingo 27/09.
  assert.equal(weeks[0][0].date, "2026-09-27");
  assert.equal(new Date(2026, 8, 27).getDay(), 0);
  assert.equal(weeks[0][4].date, "2026-10-01");
  const last = weeks.at(-1).at(-1);
  assert.equal(new Date(`${last.date}T12:00:00`).getDay(), 6);
});

test("buildMonthGrid marks days outside the month and days before today", () => {
  const weeks = buildMonthGrid(2026, 9, new Date(2026, 9, 18, 21, 30));
  const days = weeks.flat();
  const byDate = Object.fromEntries(days.map((d) => [d.date, d]));
  assert.equal(byDate["2026-09-27"].inMonth, false);
  assert.equal(byDate["2026-10-01"].inMonth, true);
  assert.equal(byDate["2026-10-31"].inMonth, true);
  assert.equal(byDate["2026-10-17"].isPast, true);
  assert.equal(byDate["2026-10-18"].isPast, false, "today is not past");
  assert.equal(byDate["2026-10-19"].isPast, false);
  assert.equal(byDate["2026-09-27"].isPast, true);
  assert.equal(days.filter((d) => d.inMonth).length, 31);
  // datas únicas e consecutivas
  assert.equal(new Set(days.map((d) => d.date)).size, days.length);
});

test("buildMonthGrid handles December into January and a 6-week month", () => {
  const dec = buildMonthGrid(2026, 11, new Date(2026, 0, 1)).flat();
  assert.equal(dec.at(-1).date, "2027-01-02");
  assert.ok(dec.every((d) => !d.isPast || d.date < "2026-01-01"));
  // agosto de 2026 começa num sábado: 6 semanas
  assert.equal(buildMonthGrid(2026, 7, new Date(2026, 0, 1)).length, 6);
});

// ---------- toggleSlot ----------

const S = (...states) => states.map((state, i) => ({ start: `s${i}`, end: `e${i}`, state }));

test("toggleSlot selects a free slot", () => {
  assert.deepEqual(toggleSlot([], 2, S("free", "free", "free")), [2]);
});

test("toggleSlot ignores booked, blocked, past and closed slots", () => {
  const slots = S("booked", "blocked", "past", "closed", "free");
  for (const i of [0, 1, 2, 3]) {
    assert.deepEqual(toggleSlot([], i, slots), []);
    assert.deepEqual(toggleSlot([4], i, slots), [4]);
  }
  assert.deepEqual(toggleSlot([], 9, slots), [], "out of range");
});

test("toggleSlot extends to a free neighbour on either side", () => {
  const slots = S("free", "free", "free", "free", "free");
  assert.deepEqual(toggleSlot([2], 3, slots), [2, 3]);
  assert.deepEqual(toggleSlot([2, 3], 1, slots), [1, 2, 3]);
});

test("toggleSlot restarts when clicking away from the block", () => {
  const slots = S("free", "free", "free", "free", "free");
  assert.deepEqual(toggleSlot([0, 1], 4, slots), [4]);
  assert.deepEqual(toggleSlot([0, 1, 2], 1, slots), [1], "inside the block restarts too");
});

test("toggleSlot removes an end of the block", () => {
  const slots = S("free", "free", "free", "free");
  assert.deepEqual(toggleSlot([1, 2, 3], 3, slots), [1, 2]);
  assert.deepEqual(toggleSlot([1, 2, 3], 1, slots), [2, 3]);
  assert.deepEqual(toggleSlot([2], 2, slots), []);
});

test("toggleSlot stops at maxSlots (default 4)", () => {
  const slots = S("free", "free", "free", "free", "free", "free");
  assert.deepEqual(toggleSlot([0, 1, 2, 3], 4, slots), [0, 1, 2, 3]);
  assert.deepEqual(toggleSlot([0, 1], 2, slots, 2), [0, 1]);
});

test("toggleSlot never crosses a taken slot in the middle", () => {
  const slots = S("free", "booked", "free", "free");
  assert.deepEqual(toggleSlot([0], 1, slots), [0]);
  assert.deepEqual(toggleSlot([0], 2, slots), [2], "not adjacent: restarts");
});

test("toggleSlot does not mutate its input and accepts unsorted input", () => {
  const slots = S("free", "free", "free");
  const sel = [1, 0];
  const out = toggleSlot(sel, 2, slots);
  assert.deepEqual(sel, [1, 0]);
  assert.deepEqual(out, [0, 1, 2]);
});

// ---------- selectionToRange ----------

test("selectionToRange returns null for an empty selection", () => {
  assert.equal(selectionToRange([], S("free")), null);
  assert.equal(selectionToRange(null, S("free")), null);
});

test("selectionToRange spans first start to last end", () => {
  const slots = S("free", "free", "free");
  assert.deepEqual(selectionToRange([1, 2], slots), { start: "s1", end: "e2" });
  assert.deepEqual(selectionToRange([2, 1], slots), { start: "s1", end: "e2" });
  assert.deepEqual(selectionToRange([0], slots), { start: "s0", end: "e0" });
});

// ---------- helpers ----------

test("monthRange covers the whole month (API limit: 31 days)", () => {
  assert.deepEqual(monthRange(2026, 9), { from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(monthRange(2026, 1), { from: "2026-02-01", to: "2026-02-28" });
  assert.deepEqual(monthRange(2028, 1), { from: "2028-02-01", to: "2028-02-29" });
});

test("shiftMonth wraps years", () => {
  assert.deepEqual(shiftMonth(2026, 11, 1), { year: 2027, month: 0 });
  assert.deepEqual(shiftMonth(2026, 0, -1), { year: 2025, month: 11 });
  assert.deepEqual(shiftMonth(2026, 9, 0), { year: 2026, month: 9 });
});

test("dayState combines grid flags with the month overview", () => {
  const cell = { date: "2026-10-20", inMonth: true, isPast: false };
  assert.equal(dayState(cell, { open: true, free: 3, total: 5 }), "free");
  assert.equal(dayState(cell, { open: true, free: 0, total: 5 }), "full");
  assert.equal(dayState(cell, { open: false, free: 0, total: 0 }), "closed");
  assert.equal(dayState({ ...cell, isPast: true }, { open: true, free: 3, total: 5 }), "past");
  assert.equal(dayState({ ...cell, inMonth: false }, { open: true, free: 3, total: 5 }), "outside");
  assert.equal(dayState(cell, undefined), "unknown");
});

test("isISODate validates real calendar dates only", () => {
  assert.equal(isISODate("2026-10-20"), true);
  assert.equal(isISODate("2026-02-30"), false);
  assert.equal(isISODate("2026-1-2"), false);
  assert.equal(isISODate("20/10/2026"), false);
  assert.equal(isISODate(null), false);
});
