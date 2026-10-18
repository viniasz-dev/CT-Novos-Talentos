import { test } from "node:test";
import assert from "node:assert/strict";

import { installFakeDom, h } from "./fake-dom.mjs";
import { mockFetch, flush, fakeLocation } from "./fake-api.mjs";
import {
  COLUMNS,
  allowedTargets,
  canDrag,
  canMove,
  groupByStatus,
  filterBookings,
  normalizeText,
  durationLabel,
  rangeError,
  conflictText,
} from "../kanban.js";
import { initPanel } from "../panel.js";

// ---------- puras ----------

test("columns are exactly Pendente, Aprovado, Recusado, Cancelado", () => {
  assert.deepEqual(COLUMNS.map((c) => c.status), ["pendente", "aprovado", "recusado", "cancelado"]);
  assert.deepEqual(COLUMNS.map((c) => c.label), ["Pendente", "Aprovado", "Recusado", "Cancelado"]);
});

test("allowedTargets/canDrag/canMove follow the spec transitions", () => {
  assert.deepEqual(allowedTargets("pendente"), ["aprovado", "recusado", "cancelado"]);
  assert.deepEqual(allowedTargets("aprovado"), ["cancelado"]);
  assert.deepEqual(allowedTargets("recusado"), []);
  assert.deepEqual(allowedTargets("cancelado"), []);
  assert.deepEqual(allowedTargets("banana"), []);
  assert.equal(canDrag("pendente"), true);
  assert.equal(canDrag("aprovado"), true);
  assert.equal(canDrag("recusado"), false);
  assert.equal(canDrag("cancelado"), false);
  assert.equal(canMove("pendente", "aprovado"), true);
  assert.equal(canMove("aprovado", "pendente"), false);
  assert.equal(canMove("aprovado", "recusado"), false);
  assert.equal(canMove("cancelado", "aprovado"), false);
  assert.equal(canMove("pendente", "pendente"), false);
  // a lista devolvida é cópia: mexer nela não muda a regra
  allowedTargets("aprovado").push("pendente");
  assert.deepEqual(allowedTargets("aprovado"), ["cancelado"]);
});

const B = (id, status, start, user = {}) => ({ id, status, start, end: start.replace("T18", "T19"), user });

test("groupByStatus puts each booking in its column, earliest first, ignoring unknown statuses", () => {
  const groups = groupByStatus([
    B(3, "pendente", "2026-10-22T18:00:00-03:00"),
    B(1, "pendente", "2026-10-20T18:00:00-03:00"),
    B(2, "aprovado", "2026-10-21T18:00:00-03:00"),
    B(9, "outro", "2026-10-21T18:00:00-03:00"),
  ]);
  assert.deepEqual(Object.keys(groups), ["pendente", "aprovado", "recusado", "cancelado"]);
  assert.deepEqual(groups.pendente.map((b) => b.id), [1, 3]);
  assert.deepEqual(groups.aprovado.map((b) => b.id), [2]);
  assert.deepEqual(groups.recusado, []);
  assert.deepEqual(groupByStatus(null).pendente, []);
});

test("filterBookings matches client name or e-mail, case and accent insensitive", () => {
  const list = [
    B(1, "pendente", "2026-10-20T18:00:00-03:00", { name: "João Silva", email: "joao@x.com" }),
    B(2, "pendente", "2026-10-20T18:00:00-03:00", { name: "Ana", email: "ana@exemplo.test" }),
  ];
  assert.deepEqual(filterBookings(list, { query: "JOAO" }).map((b) => b.id), [1]);
  assert.deepEqual(filterBookings(list, { query: "exemplo" }).map((b) => b.id), [2]);
  assert.equal(filterBookings(list, { query: "  " }).length, 2);
  assert.equal(filterBookings(list, { query: "zzz" }).length, 0);
  assert.equal(normalizeText(" Ação "), "acao");
});

test("durationLabel, rangeError and conflictText", () => {
  assert.equal(durationLabel("2026-10-20T18:00:00-03:00", "2026-10-20T19:00:00-03:00"), "1 hora");
  assert.equal(durationLabel("2026-10-20T18:00:00-03:00", "2026-10-20T21:00:00-03:00"), "3 horas");
  assert.equal(durationLabel("x", "y"), "");
  assert.equal(rangeError("2026-10-18", "2026-11-17"), "");
  assert.equal(rangeError("2026-10-18", "2026-10-18"), "");
  assert.match(rangeError("2026-10-18", "2026-10-17"), /depois da inicial/);
  assert.equal(rangeError("", ""), "");
  assert.equal(rangeError("2026-01-01", "2027-01-02"), "", "366 days ok");
  assert.match(rangeError("2026-01-01", "2027-01-03"), /no máximo 366 dias/);
  assert.equal(conflictText("Este horário já está reservado.", { conflicts: [12] }), "Este horário já está reservado. Já aprovado no mesmo horário: pedido #12.");
  assert.match(conflictText("X.", { conflicts: [1, 2] }), /pedidos #1, #2/);
  assert.equal(conflictText("Bloqueado.", {}), "Bloqueado.");
});

// ---------- DOM ----------

const NOW = new Date("2026-10-18T15:00:00-03:00");
const STAFF = { id: 1, name: "Equipe", email: "e@ct.com", is_staff: true };

function select(name, ...options) {
  return h("select", { name }, ...options.map(([v, t]) => h("option", { value: v }, t)));
}

function buildPage() {
  installFakeDom();
  const tab = (key) => h("button", { type: "button", role: "tab", id: `aba-${key}`, "data-tab": key, "aria-controls": `painel-${key}` }, key);
  const root = h(
    "div",
    { id: "painel" },
    h("div", { "data-panel-checking": true }),
    h("div", { "data-panel-denied": true, hidden: true }, h("h2", { "data-denied-title": true }), h("p", { "data-denied-text": true }), h("a", { "data-denied-link": true, href: "/" })),
    h(
      "div",
      { "data-panel-shell": true, hidden: true },
      h("div", { id: "painel-abas", role: "tablist" }, tab("kanban"), tab("pedidos"), tab("bloqueios"), tab("agenda")),
      h("section", { id: "painel-kanban", role: "tabpanel" },
        h("form", { id: "filtros-kanban" },
          select("field", ["", "Todos os campos"]),
          h("input", { name: "date_from", id: "kanban-de", type: "date" }),
          h("input", { name: "date_to", id: "kanban-ate", type: "date" }),
          h("p", { id: "kanban-ate-erro", class: "field__error", hidden: true }),
          h("input", { name: "q", type: "search" }),
          h("button", { type: "submit" }, "Atualizar"),
          h("div", { "data-form-error": true, hidden: true })),
        h("div", { "data-kanban-status": true, hidden: true }),
        h("div", { "data-kanban-board": true, hidden: true }),
        h("p", { "data-kanban-live": true })),
      h("section", { id: "painel-pedidos", role: "tabpanel", hidden: true },
        h("form", { id: "filtros-pedidos" }, select("status", ["pendente", "Pendentes"]), select("field", ["", "Todos"]), h("input", { name: "date", type: "date" })),
        h("ul", { "data-orders-list": true }),
        h("div", { "data-orders-status": true, hidden: true })),
      h("section", { id: "painel-bloqueios", role: "tabpanel", hidden: true },
        h("form", { id: "form-bloqueio" }, h("div", { "data-form-error": true, hidden: true }), select("field"), h("input", { name: "date", type: "date" }), select("start"), select("end"), h("input", { name: "reason" }), h("button", { type: "submit" })),
        h("ul", { "data-blocks-list": true }),
        h("div", { "data-blocks-status": true, hidden: true })),
      h("section", { id: "painel-agenda", role: "tabpanel", hidden: true },
        h("form", { id: "filtros-agenda" }, select("field"), h("input", { name: "date", type: "date" })),
        h("ol", { "data-agenda-list": true }),
        h("div", { "data-agenda-status": true, hidden: true })),
    ),
  );
  globalThis.document.body.append(root);
  return root;
}

const LABEL = { pendente: "Pendente", aprovado: "Aprovado", recusado: "Recusado", cancelado: "Cancelado" };

function booking(id, status, { day = "20", user = { id: 5, name: "Ana <b>", email: "ana@x.com" } } = {}) {
  return {
    id,
    field: { id: 2, name: "Campo 2" },
    start: `2026-10-${day}T18:00:00-03:00`,
    end: `2026-10-${day}T20:00:00-03:00`,
    status,
    status_label: LABEL[status],
    contact_masked: "••••••",
    contact_token: "gAAAAABpQ7xYz-CONTATO-TOKEN-0123456789abcdefghijklmnopqrstuvwxyz_ABCDEFG==",
    message_token: "gAAAAABpQ7xYz-MENSAGEM-TOKEN-0123456789abcdefghijklmnopqrstuvwxyz_HIJK==",
    message_present: false,
    created_at: "2026-10-18T10:00:00-03:00",
    can_cancel: status === "pendente" || status === "aprovado",
    user,
    decided_by: null,
  };
}

function routes(state, extra = {}) {
  return async (call) => {
    const key = `${call.method} ${call.path}`;
    if (extra[key]) return extra[key](call);
    if (key === "GET /api/fields") return [200, { fields: [{ id: 2, name: "Campo 2", price_per_hour: "150.00" }] }];
    if (key === "GET /api/admin/bookings") return [200, { bookings: state.bookings }];
    const m = key.match(/^POST \/api\/admin\/bookings\/(\d+)\/status$/);
    if (m) {
      const id = Number(m[1]);
      state.bookings = state.bookings.map((b) => (b.id === id ? booking(id, call.body.status) : b));
      return [200, { booking: state.bookings.find((b) => b.id === id) }];
    }
    throw new Error(`unexpected ${key}`);
  };
}

function fakeTimers() {
  const timers = new Map();
  let next = 1;
  return {
    timers,
    setTimeout: (fn, ms) => {
      const id = next++;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  };
}

async function start(extra = {}, bookings = [booking(7, "pendente"), booking(8, "aprovado"), booking(9, "recusado", { day: "21" }), booking(10, "cancelado")]) {
  const root = buildPage();
  const state = { bookings };
  const calls = mockFetch(routes(state, extra));
  const clock = fakeTimers();
  await initPanel(root, { now: NOW, getUser: async () => STAFF, location: fakeLocation("", "/painel/"), setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
  await flush();
  const q = (s) => root.querySelector(s);
  const col = (status) => q(`section[data-column="${status}"]`);
  const card = (id) => q(`li[data-booking-id="${id}"]`);
  return { root, calls, state, clock, q, col, card };
}

const posts = (calls) => calls.filter((c) => c.method === "POST");

test("Kanban is the default tab and loads today..+30 days for all fields", async () => {
  const { calls, q, col } = await start();
  assert.equal(q("#aba-kanban").getAttribute("aria-selected"), "true");
  assert.equal(q("#painel-kanban").hidden, false);
  assert.equal(q("#painel-pedidos").hidden, true);
  const call = calls.find((c) => c.path === "/api/admin/bookings");
  assert.deepEqual(call.query, { date_from: "2026-10-18", date_to: "2026-11-17" });
  assert.equal(calls.filter((c) => c.path === "/api/admin/bookings").length, 1, "orders tab not loaded");
  for (const [status, n] of [["pendente", 1], ["aprovado", 1], ["recusado", 1], ["cancelado", 1]]) {
    assert.equal(col(status).querySelector("[data-count]").textContent, String(n), status);
  }
});

test("cards show field, time range, duration, client, created-at, badge; text is not HTML", async () => {
  const { card } = await start();
  const c = card(7);
  const text = c.textContent;
  assert.match(text, /#7/);
  assert.match(text, /Campo 2/);
  assert.match(text, /18:00 às 20:00/);
  assert.match(text, /2 horas/);
  assert.match(text, /Ana <b>/);
  assert.match(text, /ana@x\.com/);
  assert.match(text, /Pedido em 18\/10\/2026/);
  assert.match(text, /Contato \(criptografado\)/);
  assert.match(text, /gAAAAABpQ7xYz-CONTATO-TOKEN-0123…/);
  assert.doesNotMatch(text, /••••••/);
  assert.equal(c.querySelectorAll("b").length, 0);
  assert.equal(c.querySelector("[data-status]").getAttribute("data-status"), "pendente");
});

test("only pendente/aprovado cards are draggable and have move controls with valid targets", async () => {
  const { card } = await start();
  const targets = (id) => [...card(id).querySelectorAll("button[data-move-to]")].map((b) => b.getAttribute("data-move-to"));
  assert.equal(card(7).getAttribute("draggable"), "true");
  assert.deepEqual(targets(7), ["aprovado", "recusado", "cancelado"]);
  assert.equal(card(8).getAttribute("draggable"), "true");
  assert.deepEqual(targets(8), ["cancelado"]);
  for (const id of [9, 10]) {
    assert.equal(card(id).getAttribute("draggable"), null, `#${id} final`);
    assert.equal(card(id).querySelector('[data-action="move"]'), null);
  }
});

test("empty columns show an empty state", async () => {
  const { col } = await start({}, [booking(7, "pendente")]);
  assert.match(col("recusado").textContent, /Nenhum pedido recusado/);
  assert.equal(col("recusado").querySelector("[data-count]").textContent, "0");
});

test("Mover para… is keyboard operable; approve posts directly, refreshes and keeps focus on the card", async () => {
  const { calls, card, col, q } = await start();
  const trigger = card(7).querySelector('[data-action="move"]');
  trigger.click();
  const menu = card(7).querySelector("[data-move-menu]");
  assert.equal(menu.hidden, false);
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  const options = menu.querySelectorAll("button[data-move-to]");
  assert.equal(globalThis.document.activeElement, options[0], "first option focused");
  menu.dispatch("keydown", { key: "ArrowDown" });
  assert.equal(globalThis.document.activeElement, options[1]);
  menu.dispatch("keydown", { key: "Escape" });
  assert.equal(menu.hidden, true);
  assert.equal(globalThis.document.activeElement, trigger);
  trigger.click();
  options[0].click();
  await flush();
  assert.deepEqual(posts(calls).map((c) => [c.path, c.body]), [["/api/admin/bookings/7/status", { status: "aprovado" }]]);
  assert.ok(col("aprovado").querySelector('li[data-booking-id="7"]'), "card now in Aprovado");
  assert.equal(col("aprovado").querySelector("[data-count]").textContent, "2");
  assert.equal(calls.filter((c) => c.path === "/api/admin/bookings").length, 2, "board refreshed");
  assert.equal(globalThis.document.activeElement, card(7).querySelector('[data-action="move"]'), "focus follows the card");
  assert.match(q("[data-kanban-live]").textContent, /#7 aprovado/);
});

test("reject asks an inline confirmation; Voltar restores the controls", async () => {
  const { calls, card } = await start();
  card(7).querySelector('[data-action="move"]').click();
  card(7).querySelector('button[data-move-to="recusado"]').click();
  assert.equal(posts(calls).length, 0);
  assert.match(card(7).textContent, /Recusar o pedido #7\?/);
  card(7).querySelector('button[data-action="keep"]').click();
  assert.ok(card(7).querySelector('[data-action="move"]'));
  assert.equal(globalThis.document.activeElement, card(7).querySelector('[data-action="move"]'));
  card(7).querySelector('[data-action="move"]').click();
  card(7).querySelector('button[data-move-to="cancelado"]').click();
  card(7).querySelector('button[data-action="confirm"]').click();
  await flush();
  assert.deepEqual(posts(calls)[0].body, { status: "cancelado" });
  assert.equal(card(7).getAttribute("data-booking-status"), "cancelado");
});

test("409 on approve shows the server message and conflicting id inline, card stays", async () => {
  const { calls, card, col, q } = await start({
    "POST /api/admin/bookings/7/status": () => [409, { error: { code: "slot_taken", message: "Este horário já está reservado.", fields: { conflicts: [8] } } }],
  });
  card(7).querySelector('[data-action="move"]').click();
  card(7).querySelector('button[data-move-to="aprovado"]').click();
  await flush();
  assert.ok(col("pendente").querySelector('li[data-booking-id="7"]'), "still pending");
  const error = card(7).querySelector("[data-card-error]");
  assert.equal(error.hidden, false);
  assert.match(error.textContent, /já está reservado.*pedido #8/);
  assert.match(q("[data-kanban-live]").textContent, /não foi movido/);
  assert.equal(calls.filter((c) => c.path === "/api/admin/bookings").length, 1, "no reload wipes the message");
  assert.equal(card(7).getAttribute("aria-busy"), null);
});

function dataTransfer() {
  return { data: {}, setData(k, v) { this.data[k] = v; }, getData(k) { return this.data[k]; }, effectAllowed: "", dropEffect: "" };
}

test("drag highlights valid columns, dims invalid ones, and a drop on Aprovado approves", async () => {
  const { calls, card, col, q } = await start();
  const dt = dataTransfer();
  card(8).dispatch("dragstart", { dataTransfer: dt });
  assert.equal(dt.data["text/plain"], "8");
  assert.equal(col("aprovado").getAttribute("data-drop"), "source");
  assert.equal(col("cancelado").getAttribute("data-drop"), "valid");
  assert.equal(col("pendente").getAttribute("data-drop"), "invalid");
  assert.equal(col("recusado").getAttribute("data-drop"), "invalid");
  card(8).dispatch("dragend", { dataTransfer: dt });
  assert.equal(col("cancelado").getAttribute("data-drop"), null, "cleared");

  card(7).dispatch("dragstart", { dataTransfer: dataTransfer() });
  let prevented = false;
  col("aprovado").dispatch("dragover", { dataTransfer: dt, preventDefault() { prevented = true; } });
  assert.ok(prevented, "valid column accepts the drop");
  assert.ok(col("aprovado").classList.contains("is-over"));
  col("aprovado").dispatch("drop", { dataTransfer: dt });
  await flush();
  assert.deepEqual(posts(calls).map((c) => c.body), [{ status: "aprovado" }]);
  assert.ok(col("aprovado").querySelector('li[data-booking-id="7"]'));
  assert.equal(q("[data-kanban-board]").classList.contains("is-dragging"), false);
});

test("drop on an invalid column shows the rejection and calls no API", async () => {
  const { calls, card, col } = await start();
  card(8).dispatch("dragstart", { dataTransfer: dataTransfer() });
  let prevented = false;
  col("pendente").dispatch("dragover", { preventDefault() { prevented = true; } });
  assert.ok(prevented, "every column takes the drop so the user gets an answer");
  assert.equal(col("pendente").classList.contains("is-over"), false, "invalid column is not lit");
  col("pendente").dispatch("drop", {});
  await flush();
  assert.match(card(8).querySelector("[data-card-error]").textContent, /Não dá para mover o pedido #8 de Aprovado para Pendente/);
  card(8).dispatch("dragstart", { dataTransfer: dataTransfer() });
  col("recusado").dispatch("drop", {});
  await flush();
  assert.equal(posts(calls).length, 0);
});

test("releasing outside the board (after hovering an invalid column) shows nothing", async () => {
  const { calls, card, col, q } = await start();
  card(8).dispatch("dragstart", { dataTransfer: dataTransfer() });
  col("pendente").dispatch("dragenter", {});
  col("pendente").dispatch("dragover", { preventDefault() {} });
  col("pendente").dispatch("dragleave", { relatedTarget: null });
  card(8).dispatch("dragend", {});
  await flush();
  assert.equal(card(8).querySelector("[data-card-error]").hidden, true);
  assert.equal(card(8).querySelector("[data-card-error]").textContent, "");
  assert.doesNotMatch(q("[data-kanban-live]").textContent, /Não dá para mover/);
  assert.equal(col("pendente").getAttribute("data-drop"), null, "drag state cleared");
  assert.equal(posts(calls).length, 0);
});

test("drop on a valid column moves the card", async () => {
  const { calls, card, col } = await start();
  card(8).dispatch("dragstart", { dataTransfer: dataTransfer() });
  col("cancelado").dispatch("dragover", { preventDefault() {} });
  assert.ok(col("cancelado").classList.contains("is-over"));
  col("cancelado").dispatch("drop", {});
  // cancelar pede confirmação inline no card
  card(8).querySelector('button[data-action="confirm"]').click();
  await flush();
  assert.deepEqual(posts(calls).map((c) => [c.path, c.body]), [["/api/admin/bookings/8/status", { status: "cancelado" }]]);
  assert.ok(col("cancelado").querySelector('li[data-booking-id="8"]'));
});

function deferred() {
  let release;
  const promise = new Promise((r) => (release = r));
  return { promise, release };
}

test("a refresh during a slow move keeps the 409 visible on the live card; filters are locked meanwhile", async () => {
  const slow = deferred();
  const { calls, card, q } = await start({
    "POST /api/admin/bookings/7/status": () => slow.promise,
  });
  card(7).querySelector('[data-action="move"]').click();
  card(7).querySelector('button[data-move-to="aprovado"]').click();
  await flush();
  const form = q("#filtros-kanban");
  for (const control of form.querySelectorAll("select, input, button")) {
    assert.equal(control.disabled, true, control.getAttribute("name") || control.textContent);
    assert.equal(control.getAttribute("aria-disabled"), "true");
  }
  const loads = () => calls.filter((c) => c.path === "/api/admin/bookings").length;
  form.dispatch("submit");
  await flush();
  assert.equal(loads(), 1, "no reload while a move is in flight");
  const old = card(7);
  // algo recria o quadro durante a chamada (ex.: busca digitada antes do travamento)
  form.querySelector('input[name="q"]').dispatch("input");
  assert.notEqual(card(7), old, "card was re-rendered");
  slow.release([409, { error: { code: "slot_taken", message: "Este horário já está reservado.", fields: { conflicts: [8] } } }]);
  await flush();
  const error = card(7).querySelector("[data-card-error]");
  assert.equal(error.hidden, false);
  assert.match(error.textContent, /já está reservado.*#8/);
  for (const control of form.querySelectorAll("select, input, button")) assert.equal(control.disabled, false);
  assert.equal(form.querySelector("button").getAttribute("aria-disabled"), null);
});

test("a second move while one is in flight says to wait (no silent no-op, no confirmation opened)", async () => {
  const slow = deferred();
  const { calls, card, col, q } = await start({
    "POST /api/admin/bookings/7/status": () => slow.promise,
  });
  card(7).querySelector('[data-action="move"]').click();
  card(7).querySelector('button[data-move-to="aprovado"]').click();
  await flush();
  // outro card: menu + recusar
  card(8).querySelector('[data-action="move"]').click();
  card(8).querySelector('button[data-move-to="cancelado"]').click();
  assert.match(card(8).querySelector("[data-card-error]").textContent, /Aguarde o pedido anterior terminar/);
  assert.equal(card(8).querySelector('button[data-action="confirm"]'), null, "no confirmation opened");
  assert.match(q("[data-kanban-live]").textContent, /Aguarde o pedido anterior terminar/);
  // arrastar também avisa
  card(8).dispatch("dragstart", { dataTransfer: dataTransfer() });
  col("cancelado").dispatch("drop", {});
  assert.match(card(8).querySelector("[data-card-error]").textContent, /Aguarde/);
  assert.equal(posts(calls).length, 1);
  slow.release([200, { booking: booking(7, "aprovado") }]);
  await flush();
});

test("a confirmation opened before another move started also says to wait on Sim", async () => {
  const slow = deferred();
  const { calls, card } = await start({
    "POST /api/admin/bookings/7/status": () => slow.promise,
  });
  card(8).querySelector('[data-action="move"]').click();
  card(8).querySelector('button[data-move-to="cancelado"]').click();
  card(7).querySelector('[data-action="move"]').click();
  card(7).querySelector('button[data-move-to="aprovado"]').click();
  await flush();
  card(8).querySelector('button[data-action="confirm"]').click();
  assert.match(card(8).querySelector("[data-card-error]").textContent, /Aguarde o pedido anterior terminar/);
  assert.equal(posts(calls).length, 1);
  slow.release([200, { booking: booking(7, "aprovado") }]);
  await flush();
});

for (const [label, handler] of [
  ["500", () => [500, { error: { code: "server_error", message: "O servidor teve um problema." } }]],
  ["network error", () => { throw new TypeError("Failed to fetch"); }],
]) {
  test(`a failed move (${label}) keeps the card in its column and restores "Mover para…"`, async () => {
    const { card, col } = await start({ "POST /api/admin/bookings/7/status": handler });
    card(7).querySelector('[data-action="move"]').click();
    card(7).querySelector('button[data-move-to="recusado"]').click();
    card(7).querySelector('button[data-action="confirm"]').click();
    await flush();
    assert.ok(col("pendente").querySelector('li[data-booking-id="7"]'));
    const error = card(7).querySelector("[data-card-error]");
    assert.equal(error.hidden, false);
    assert.ok(error.textContent.length > 0);
    const trigger = card(7).querySelector('[data-action="move"]');
    assert.ok(trigger, "move button back");
    assert.ok(!trigger.disabled, "enabled");
    assert.equal(card(7).getAttribute("aria-busy"), null);
    assert.equal(globalThis.document.activeElement, trigger);
  });
}

test("cards are named groups", async () => {
  const { card } = await start();
  assert.equal(card(7).getAttribute("role"), "group");
  assert.match(card(7).getAttribute("aria-label"), /Pedido #7/);
});

test("filters: field/dates reload from the API, search filters locally, bad range blocks the request", async () => {
  const people = [
    booking(7, "pendente", { user: { name: "João Silva", email: "joao@x.com" } }),
    booking(11, "pendente", { user: { name: "Bia", email: "bia@exemplo.test" } }),
  ];
  const { calls, q, col } = await start({}, people);
  const form = q("#filtros-kanban");
  const search = form.querySelector('input[name="q"]');
  search.value = "JOAO";
  search.dispatch("input");
  assert.deepEqual([...col("pendente").querySelectorAll("li[data-booking-id]")].map((li) => li.getAttribute("data-booking-id")), ["7"]);
  form.dispatch("change", { target: search });
  assert.equal(calls.filter((c) => c.path === "/api/admin/bookings").length, 1, "search does not refetch");

  form.querySelector('select[name="field"]').value = "2";
  form.querySelector('input[name="date_from"]').value = "2026-10-20";
  form.querySelector('input[name="date_to"]').value = "2026-10-25";
  form.dispatch("change", { target: form.querySelector('input[name="date_to"]') });
  await flush();
  assert.deepEqual(calls.filter((c) => c.path === "/api/admin/bookings").at(-1).query, { field: "2", date_from: "2026-10-20", date_to: "2026-10-25" });

  form.querySelector('input[name="date_to"]').value = "2026-10-19";
  form.dispatch("submit");
  await flush();
  assert.equal(calls.filter((c) => c.path === "/api/admin/bookings").length, 2, "no request with bad range");
  assert.match(form.querySelector("#kanban-ate-erro").textContent, /depois da inicial/);
});

test("Atualizar reloads; load error shows a retry state", async () => {
  let fail = false;
  const state = { bookings: [booking(7, "pendente")] };
  const { calls, q } = await start({
    "GET /api/admin/bookings": () => (fail ? [500, { error: { code: "server_error", message: "Falhou." } }] : [200, { bookings: state.bookings }]),
  });
  fail = true;
  q("#filtros-kanban").dispatch("submit");
  await flush();
  assert.equal(calls.filter((c) => c.path === "/api/admin/bookings").length, 2);
  assert.match(q("[data-kanban-status]").textContent, /Não foi possível carregar o Kanban/);
  fail = false;
  q("[data-kanban-status]").querySelector("[data-retry]").click();
  await flush();
  assert.equal(q("[data-kanban-status]").hidden, true);
  assert.ok(q('li[data-booking-id="7"]'));
});

test("contact reveal on a card is audited, hides on Ocultar and on board refresh", async () => {
  const SECRET = "(19) 98888-7777";
  const { calls, card, clock, q } = await start({
    "GET /api/admin/bookings/7/contact": () => [200, { contact: SECRET, message: "" }],
  });
  card(7).querySelector('button[data-action="contact"]').click();
  await flush();
  assert.ok(calls.some((c) => c.path === "/api/admin/bookings/7/contact"));
  assert.match(card(7).textContent, /98888-7777/);
  assert.equal([...clock.timers.values()][0].ms, 30000);
  card(7).querySelector('button[data-action="hide-contact"]').click();
  assert.doesNotMatch(card(7).textContent, /98888-7777/);
  card(7).querySelector('button[data-action="contact"]').click();
  await flush();
  q("#filtros-kanban").dispatch("submit");
  await flush();
  assert.doesNotMatch(q("[data-kanban-board]").textContent, /98888-7777/);
  assert.equal(clock.timers.size, 0, "timer cancelled");
});

test("a 403 while moving switches the panel to access denied", async () => {
  const { card, q } = await start({
    "POST /api/admin/bookings/7/status": () => [403, { error: { code: "forbidden", message: "Acesso restrito à equipe." } }],
  });
  card(7).querySelector('[data-action="move"]').click();
  card(7).querySelector('button[data-move-to="aprovado"]').click();
  await flush();
  assert.equal(q("[data-panel-denied]").hidden, false);
  assert.equal(q("[data-kanban-board]").children.length, 0);
});
