import { test } from "node:test";
import assert from "node:assert/strict";

import { installFakeDom, h } from "./fake-dom.mjs";
import { mockFetch, flush, fakeLocation } from "./fake-api.mjs";
import { validateReason, blockConflictText, REASON_SUGGESTIONS, BLOCK_SLOT_LABEL } from "../block-mode.js";
import { initBooking } from "../booking.js";

// ---------- puras ----------

test("validateReason requires a reason up to 200 characters (code points)", () => {
  assert.equal(validateReason("Manutenção"), "");
  assert.match(validateReason("   "), /Informe o motivo/);
  assert.match(validateReason(undefined), /Informe o motivo/);
  assert.match(validateReason("x".repeat(201)), /200/);
  assert.equal(validateReason("⚽".repeat(200)), "");
});

test("blockConflictText lists approved bookings and points to the Kanban", () => {
  assert.equal(
    blockConflictText("Existem reservas aprovadas neste intervalo.", { conflicts: [12] }),
    "Existem reservas aprovadas neste intervalo. Pedido aprovado: #12. Cancele no Kanban do painel para liberar o horário.",
  );
  assert.match(blockConflictText("X.", { conflicts: [1, 2] }), /Pedidos aprovados: #1, #2/);
  assert.equal(blockConflictText("X.", {}), "X.");
});

test("suggestions and staff labels", () => {
  assert.deepEqual(REASON_SUGGESTIONS, ["Manutenção", "Evento do CT", "Horário da escolinha"]);
  assert.equal(BLOCK_SLOT_LABEL.booked, "Reservado");
});

// ---------- DOM (modo bloqueio do /reservar/) ----------

const NOW = new Date("2026-10-18T15:00:00-03:00");
const FIELDS = [{ id: 2, name: "Campo 2", description: "", price_per_hour: "150.00", photo: "" }];

function buildPage(mode = "block") {
  installFakeDom();
  const staffAside = h(
    "aside",
    { id: "resumo" },
    h("span", { "data-sum-field": true }),
    h("span", { "data-sum-date": true }),
    h("span", { "data-sum-time": true }),
    h("span", { "data-sum-hours": true }),
    h("p", { "data-block-done": true, hidden: true }),
    h("div", { "data-block-view": true, hidden: true }),
    h(
      "form",
      { id: "form-reserva" },
      h("div", { "data-form-error": true, hidden: true }),
      h("input", { id: "bloqueio-motivo", name: "reason" }),
      h("span", { "data-reason-counter": true }),
      ...["Manutenção", "Evento do CT"].map((r) => h("button", { type: "button", "data-reason-suggestion": r }, r)),
      h("p", { id: "bloqueio-motivo-erro", class: "field__error", hidden: true }),
      h("button", { type: "submit" }, "Bloquear horário"),
    ),
  );
  const root = h(
    "div",
    { id: "reserva", "data-mode": mode, "data-static-base": "/static/", "data-fallback-photo": "/static/fb.jpg" },
    h("section", { id: "campos-reserva" }, h("div", { "data-fields-skeleton": true }), h("div", { "data-fields-list": true, hidden: true }), h("div", { "data-fields-status": true, hidden: true })),
    h("section", { id: "calendario" }, h("button", { type: "button", "data-cal-prev": true }), h("h3", { "data-cal-title": true }), h("button", { type: "button", "data-cal-next": true }), h("div", { "data-cal-body": true }), h("p", { "data-cal-hint": true })),
    h("section", { id: "horarios" }, h("p", { "data-slots-hint": true }), h("div", { "data-slots-skeleton": true, hidden: true }), h("ol", { "data-slots-list": true, hidden: true }), h("div", { "data-slots-status": true, hidden: true })),
    staffAside,
    h("div", { "data-booking-bar": true, hidden: true }, h("strong", { "data-bar-total": true })),
  );
  globalThis.document.body.append(root);
  return root;
}

function overview(fullDay = "2026-10-21") {
  const days = {};
  for (let d = 1; d <= 31; d += 1) {
    const date = `2026-10-${String(d).padStart(2, "0")}`;
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const open = weekday >= 1 && weekday <= 5;
    days[date] = { open, free: open ? (date === fullDay ? 0 : 5) : 0, total: open ? 5 : 0 };
  }
  return { field: 2, days };
}

/** Agenda: 18 livre, 19-21 bloqueado (#3, um bloqueio só), 21 reservado, 22 livre. */
function agenda(date, state) {
  const at = (hh) => `${date}T${String(hh).padStart(2, "0")}:00:00-03:00`;
  const block = { id: 3, reason: "Manutenção <b>", start: at(19), end: at(21) };
  const slots = [18, 19, 20, 21, 22].map((hh) => ({ start: at(hh), end: at(hh + 1), state: "free" }));
  if (state.blocked) {
    slots[1] = { ...slots[1], state: "blocked", block };
    slots[2] = { ...slots[2], state: "blocked", block };
  }
  slots[3] = { ...slots[3], state: "booked", booking: { id: 8, status: "aprovado" } };
  return { open: true, slots };
}

function routes(state, extra = {}) {
  return async (call) => {
    const key = `${call.method} ${call.path}`;
    if (extra[key]) return extra[key](call);
    if (call.path === "/api/fields") return [200, { fields: FIELDS }];
    if (call.path === "/api/availability" && call.query.from) return [200, overview()];
    if (call.path === "/api/admin/agenda") return [200, agenda(call.query.date, state)];
    if (key === "DELETE /api/admin/blocks/3") {
      state.blocked = false;
      return [204, undefined];
    }
    throw new Error(`unexpected ${key} ${JSON.stringify(call.query)}`);
  };
}

async function start(extra = {}, state = { blocked: true }) {
  const root = buildPage();
  const calls = mockFetch(routes(state, extra));
  const location = fakeLocation("?field=2&date=2026-10-20", "/reservar/");
  await initBooking(root, { now: NOW, location, history: null, getUser: async () => ({ id: 1, is_staff: true }) });
  await flush();
  const q = (s) => root.querySelector(s);
  return { root, calls, state, location, q, slot: (i) => q(`button[data-slot="${i}"]`) };
}

test("staff mode reads the day from the admin agenda; booked shows Reservado and stays disabled", async () => {
  const { calls, slot, q } = await start();
  const day = calls.find((c) => c.query.date);
  assert.equal(day.path, "/api/admin/agenda");
  assert.deepEqual(day.query, { field: "2", date: "2026-10-20" });
  assert.ok(!calls.some((c) => c.path === "/api/availability" && c.query.date), "no public day call");
  assert.ok(slot(3).hasAttribute("disabled"));
  assert.match(slot(3).textContent, /Reservado/);
  assert.ok(!slot(1).hasAttribute("disabled"), "blocked slot is clickable for staff");
  assert.match(slot(1).getAttribute("aria-label"), /bloqueado: Manutenção <b>\. Ver bloqueio/);
  assert.match(q("[data-slots-hint]").textContent, /bloquear, ou num bloqueado/);
});

test("full days open in staff mode (blocks to release live there)", async () => {
  const { q } = await start();
  const full = q('button[data-date="2026-10-21"]');
  assert.equal(full.getAttribute("data-state"), "full");
  assert.ok(!full.hasAttribute("disabled"));
  assert.ok(q('button[data-date="2026-10-24"]').hasAttribute("disabled"), "closed saturday still off");
});

test("suggestion chips fill the reason and the counter follows", async () => {
  const { q } = await start();
  q('button[data-reason-suggestion="Evento do CT"]').click();
  assert.equal(q('input[name="reason"]').value, "Evento do CT");
  assert.equal(q("[data-reason-counter]").textContent, "12/200");
  assert.equal(globalThis.document.activeElement, q('input[name="reason"]'));
});

test("summary has no price; bar shows the duration", async () => {
  const { slot, q } = await start();
  slot(0).click();
  assert.match(q("[data-sum-time]").textContent, /18:00 às 19:00/);
  assert.equal(q("[data-bar-total]").textContent, "1 hora");
});

test("submit requires a reason, then posts the block and reloads grid and month", async () => {
  let posted;
  const { calls, slot, q } = await start({
    "POST /api/admin/blocks": (call) => {
      posted = call.body;
      return [201, { block: { id: 4, ...call.body } }];
    },
  });
  slot(4).click();
  q("#form-reserva").dispatch("submit");
  await flush();
  assert.equal(calls.filter((c) => c.method === "POST").length, 0);
  assert.match(q("#bloqueio-motivo-erro").textContent, /Informe o motivo/);
  q('input[name="reason"]').value = "  Manutenção  ";
  const before = calls.length;
  q("#form-reserva").dispatch("submit");
  await flush();
  assert.deepEqual(posted, { field: 2, start: "2026-10-20T22:00:00-03:00", end: "2026-10-20T23:00:00-03:00", reason: "Manutenção" });
  const after = calls.slice(before).map((c) => c.path);
  assert.ok(after.includes("/api/admin/agenda") && after.includes("/api/availability"), "grid and month reloaded");
  assert.match(q("[data-block-done]").textContent, /Bloqueado: Campo 2, .*22:00 às 23:00 \(Manutenção\)/);
  assert.equal(q('input[name="reason"]').value, "");
  assert.ok(!calls.some((c) => c.path === "/api/bookings"), "never the booking endpoint");
});

test("409 slot_taken shows conflicting ids and a link to the Kanban", async () => {
  const { slot, q } = await start({
    "POST /api/admin/blocks": () => [409, { error: { code: "slot_taken", message: "Existem reservas aprovadas neste intervalo.", fields: { conflicts: [8] } } }],
  });
  slot(0).click();
  q('input[name="reason"]').value = "Evento";
  q("#form-reserva").dispatch("submit");
  await flush();
  const box = q("[data-form-error]");
  assert.equal(box.hidden, false);
  assert.match(box.textContent, /Pedido aprovado: #8\. Cancele no Kanban/);
  assert.equal(box.querySelector("a").getAttribute("href"), "/painel/");
});

test("clicking a blocked slot opens the whole block; Liberar asks inline and deletes it", async () => {
  const { calls, slot, q } = await start();
  slot(0).click(); // havia uma seleção: abrir o bloqueio limpa
  slot(2).click();
  const view = q("[data-block-view]");
  assert.equal(view.hidden, false);
  assert.equal(q("#form-reserva").hidden, true);
  assert.match(view.textContent, /19:00 às 21:00/);
  assert.match(view.textContent, /Manutenção <b>/);
  assert.equal(view.querySelectorAll("b").length, 0, "reason is text");
  assert.match(view.textContent, /bloqueio inteiro/);
  assert.equal(slot(1).getAttribute("aria-pressed"), "true", "every slot of the block is marked");
  assert.ok(slot(2).classList.contains("is-viewing"));
  assert.equal(slot(0).getAttribute("aria-pressed"), "false");
  view.querySelector('button[data-action="release"]').click();
  assert.equal(calls.filter((c) => c.method === "DELETE").length, 0, "needs confirmation");
  assert.match(view.textContent, /Liberar 19:00 às 21:00\? O bloqueio inteiro sai da agenda/);
  view.querySelector('button[data-action="confirm-release"]').click();
  await flush();
  assert.deepEqual(calls.filter((c) => c.method === "DELETE").map((c) => c.path), ["/api/admin/blocks/3"]);
  assert.equal(view.hidden, true);
  assert.equal(q("#form-reserva").hidden, false);
  assert.equal(slot(1).getAttribute("data-state"), "free");
  assert.equal(globalThis.document.activeElement, slot(1), "focus back on the freed hour");
  assert.match(q("[data-block-done]").textContent, /Liberado: 19:00 às 21:00/);
});

test("a 2-hour block marks both slots with the same id and one DELETE releases both", async () => {
  const { calls, slot, q } = await start();
  assert.equal(slot(1).getAttribute("data-block-id"), "3");
  assert.equal(slot(2).getAttribute("data-block-id"), "3");
  slot(1).click();
  assert.equal(slot(1).getAttribute("aria-pressed"), "true");
  assert.equal(slot(2).getAttribute("aria-pressed"), "true");
  q("[data-block-view]").querySelector('button[data-action="release"]').click();
  q("[data-block-view]").querySelector('button[data-action="confirm-release"]').click();
  await flush();
  const deletes = calls.filter((c) => c.method === "DELETE");
  assert.deepEqual(deletes.map((c) => c.path), ["/api/admin/blocks/3"]);
  assert.equal(slot(1).getAttribute("data-state"), "free");
  assert.equal(slot(2).getAttribute("data-state"), "free");
});

test("Fechar closes the block view and picking a free slot also closes it", async () => {
  const { slot, q } = await start();
  slot(1).click();
  q("[data-block-view]").querySelector('button[data-action="close-block"]').click();
  assert.equal(q("[data-block-view]").hidden, true);
  assert.equal(slot(1).getAttribute("aria-pressed"), "false");
  slot(1).click();
  slot(0).click();
  assert.equal(q("[data-block-view]").hidden, true);
  assert.equal(slot(0).getAttribute("aria-pressed"), "true");
});

test("client mode is unchanged: public availability, blocked disabled, no admin calls", async () => {
  installFakeDom();
  const root = buildPage("booking");
  const calls = mockFetch(async (call) => {
    if (call.path === "/api/fields") return [200, { fields: FIELDS }];
    if (call.path === "/api/availability" && call.query.from) return [200, overview()];
    if (call.path === "/api/availability") {
      const a = agenda(call.query.date, { blocked: true });
      return [200, { open: true, slots: a.slots.map(({ start, end, state }) => ({ start, end, state })) }];
    }
    throw new Error(`unexpected ${call.path}`);
  });
  await initBooking(root, { now: NOW, location: fakeLocation("?field=2&date=2026-10-20", "/reservar/"), history: null, getUser: async () => null });
  await flush();
  assert.ok(!calls.some((c) => c.path.startsWith("/api/admin")));
  const slot = (i) => root.querySelector(`button[data-slot="${i}"]`);
  assert.ok(slot(1).hasAttribute("disabled"), "blocked not selectable");
  assert.match(slot(3).textContent, /Ocupado/);
  assert.ok(root.querySelector('button[data-date="2026-10-21"]').hasAttribute("disabled"), "full day off for clients");
});
