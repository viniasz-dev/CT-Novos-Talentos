import { test } from "node:test";
import assert from "node:assert/strict";

import { installFakeDom, h } from "./fake-dom.mjs";
import { mockFetch, flush, fakeLocation } from "./fake-api.mjs";
import { accessState, actionsFor, nextTabIndex, initPanel } from "../panel.js";

const NOW = new Date("2026-10-18T15:00:00-03:00");
const STAFF = { id: 1, name: "Equipe", email: "e@ct.com", is_staff: true };

// ---------- puras ----------

test("accessState distinguishes anonymous, client and staff", () => {
  assert.equal(accessState(null), "anon");
  assert.equal(accessState(undefined), "anon");
  assert.equal(accessState({ is_staff: false }), "denied");
  assert.equal(accessState({ is_staff: true }), "staff");
});

test("actionsFor follows the allowed transitions", () => {
  assert.deepEqual(actionsFor("pendente").map((a) => a.status), ["aprovado", "recusado", "cancelado"]);
  assert.deepEqual(actionsFor("aprovado").map((a) => a.status), ["cancelado"]);
  assert.deepEqual(actionsFor("recusado"), []);
  assert.deepEqual(actionsFor("cancelado"), []);
  assert.equal(actionsFor("pendente")[0].confirm, false, "approve is one click");
  assert.equal(actionsFor("pendente")[1].confirm, true);
});

test("nextTabIndex wraps with arrows, Home and End", () => {
  assert.equal(nextTabIndex(0, "ArrowRight", 3), 1);
  assert.equal(nextTabIndex(2, "ArrowRight", 3), 0);
  assert.equal(nextTabIndex(0, "ArrowLeft", 3), 2);
  assert.equal(nextTabIndex(1, "Home", 3), 0);
  assert.equal(nextTabIndex(1, "End", 3), 2);
  assert.equal(nextTabIndex(1, "Enter", 3), null);
});

// ---------- DOM ----------

function select(name, ...options) {
  return h("select", { name }, ...options.map(([v, t]) => h("option", { value: v }, t)));
}

function buildPage() {
  installFakeDom();
  const tab = (key, label) => h("button", { type: "button", role: "tab", id: `aba-${key}`, "data-tab": key, "aria-controls": `painel-${key}` }, label);
  const statusSelect = select("status", ["", "Todos"], ["pendente", "Pendentes"], ["aprovado", "Aprovados"], ["recusado", "Recusados"], ["cancelado", "Cancelados"]);
  statusSelect.value = "pendente";
  const root = h(
    "div",
    { id: "painel" },
    h("div", { "data-panel-checking": true }),
    h("div", { "data-panel-denied": true, hidden: true }, h("h2", { "data-denied-title": true }), h("p", { "data-denied-text": true }), h("a", { "data-denied-link": true, href: "/" })),
    h(
      "div",
      { "data-panel-shell": true, hidden: true },
      h("div", { id: "painel-abas", role: "tablist" }, tab("pedidos", "Pedidos"), tab("bloqueios", "Bloqueios"), tab("agenda", "Agenda")),
      h("section", { id: "painel-pedidos", role: "tabpanel" },
        h("form", { id: "filtros-pedidos" }, statusSelect, select("field", ["", "Todos os campos"]), h("input", { name: "date", type: "date" })),
        h("ul", { "data-orders-list": true }),
        h("div", { "data-orders-status": true, hidden: true })),
      h("section", { id: "painel-bloqueios", role: "tabpanel", hidden: true },
        h("form", { id: "form-bloqueio" },
          h("div", { "data-form-error": true, hidden: true }),
          select("field"), h("input", { name: "date", type: "date" }), select("start"), select("end"),
          h("input", { name: "reason", id: "bloqueio-motivo" }),
          h("button", { type: "submit" }, "Criar bloqueio")),
        h("ul", { "data-blocks-list": true }),
        h("div", { "data-blocks-status": true, hidden: true })),
      h("section", { id: "painel-agenda", role: "tabpanel", hidden: true },
        h("form", { id: "filtros-agenda" }, select("field"), h("input", { name: "date", type: "date" }),
          h("button", { type: "button", "data-day-prev": true }), h("button", { type: "button", "data-day-next": true })),
        h("ol", { "data-agenda-list": true }),
        h("div", { "data-agenda-status": true, hidden: true })),
    ),
  );
  globalThis.document.body.append(root);
  return root;
}

function adminBooking(id, status) {
  return {
    id,
    field: { id: 2, name: "Campo 2" },
    start: "2026-10-20T18:00:00-03:00",
    end: "2026-10-20T19:00:00-03:00",
    status,
    status_label: { pendente: "Pendente", aprovado: "Aprovado", recusado: "Recusado", cancelado: "Cancelado" }[status],
    contact_masked: "••••••",
    contact_token: "gAAAAABpQ7xYz-CONTATO-TOKEN-0123456789abcdefghijklmnopqrstuvwxyz_ABCDEFG==",
    message_token: "gAAAAABpQ7xYz-MENSAGEM-TOKEN-0123456789abcdefghijklmnopqrstuvwxyz_HIJK==",
    message_present: true,
    created_at: "2026-10-18T10:00:00-03:00",
    can_cancel: status === "pendente" || status === "aprovado",
    user: { id: 5, name: "Ana <b>", email: "ana@x.com" },
    decided_by: null,
  };
}

function routes(extra = {}) {
  return async (call) => {
    const key = `${call.method} ${call.path}`;
    if (extra[key]) return extra[key](call);
    if (key === "GET /api/fields") return [200, { fields: [{ id: 2, name: "Campo 2", price_per_hour: "150.00" }] }];
    if (key === "GET /api/admin/bookings") return [200, { bookings: [adminBooking(7, "pendente"), adminBooking(8, "aprovado")] }];
    if (key === "GET /api/admin/blocks") return [200, { blocks: [] }];
    if (key === "GET /api/availability") {
      return [200, { field: 2, date: call.query.date, open: true, slots: [18, 19, 20].map((hh) => ({ start: `${call.query.date}T${hh}:00:00-03:00`, end: `${call.query.date}T${hh + 1}:00:00-03:00`, state: "free" })) }];
    }
    if (key === "GET /api/admin/agenda") {
      return [200, { open: true, slots: [
        { start: `${call.query.date}T18:00:00-03:00`, end: `${call.query.date}T19:00:00-03:00`, state: "booked", booking: { id: 8, status: "aprovado" } },
        { start: `${call.query.date}T19:00:00-03:00`, end: `${call.query.date}T20:00:00-03:00`, state: "blocked", block: { id: 3, reason: "Manutenção" } },
        { start: `${call.query.date}T20:00:00-03:00`, end: `${call.query.date}T21:00:00-03:00`, state: "free" },
      ] }];
    }
    throw new Error(`unexpected ${key}`);
  };
}

async function start(user, handler = routes(), extra = {}) {
  const root = buildPage();
  const calls = mockFetch(handler);
  // Agendador inerte por padrão: nenhum timer real de 30 s segura o processo de teste.
  const idle = { setTimeout: () => 0, clearTimeout: () => {} };
  await initPanel(root, { now: NOW, getUser: async () => user, location: fakeLocation("", "/painel/"), ...idle, ...extra });
  await flush();
  return { root, calls, q: (s) => root.querySelector(s) };
}

for (const [label, user, text] of [["anonymous", null, /Entre com uma conta da equipe/], ["client", { id: 2, is_staff: false }, /só para a equipe/]]) {
  test(`${label} sees access denied and no admin data is requested`, async () => {
    const { calls, q } = await start(user);
    assert.equal(calls.filter((c) => c.path.startsWith("/api/admin")).length, 0);
    assert.equal(q("[data-panel-denied]").hidden, false);
    assert.equal(q("[data-panel-shell]").hidden, true);
    assert.equal(q("[data-panel-checking]").hidden, true);
    assert.match(q("[data-denied-text]").textContent, text);
    assert.equal(q("[data-orders-list]").children.length, 0);
  });
}

test("anonymous denied link goes to login with next=/painel/", async () => {
  const { q } = await start(null);
  assert.equal(q("[data-denied-link]").getAttribute("href"), "/entrar/?next=%2Fpainel%2F");
});

test("staff sees pending orders with actions; user text is not HTML", async () => {
  const { calls, q } = await start(STAFF);
  assert.equal(q("[data-panel-shell]").hidden, false);
  assert.equal(q("[data-panel-denied]").hidden, true);
  const ordersCall = calls.find((c) => c.path === "/api/admin/bookings");
  assert.deepEqual(ordersCall.query, { status: "pendente" });
  const items = q("[data-orders-list]").querySelectorAll("li[data-booking-id]");
  assert.equal(items.length, 2);
  assert.deepEqual([...items].map((li) => li.getAttribute("data-booking-status")), ["pendente", "aprovado"]);
  assert.match(items[0].textContent, /Ana <b>/);
  assert.equal(items[0].querySelectorAll("b").length, 0);
  assert.deepEqual([...items[0].querySelectorAll("button[data-status-to]")].map((b) => b.getAttribute("data-status-to")), ["aprovado", "recusado", "cancelado"]);
  assert.deepEqual([...items[1].querySelectorAll("button[data-status-to]")].map((b) => b.getAttribute("data-status-to")), ["cancelado"]);
});

test("a 403 during the session switches to access denied and clears data", async () => {
  const { q } = await start(STAFF, routes({ "GET /api/admin/bookings": () => [403, { error: { code: "forbidden", message: "Acesso restrito à equipe." } }] }));
  assert.equal(q("[data-panel-denied]").hidden, false);
  assert.equal(q("[data-panel-shell]").hidden, true);
  assert.equal(q("[data-orders-list]").children.length, 0);
});

test("approve posts the status and updates the card", async () => {
  let body;
  const { calls, q } = await start(STAFF, routes({
    "POST /api/admin/bookings/7/status": (call) => {
      body = call.body;
      return [200, { booking: adminBooking(7, "aprovado") }];
    },
  }));
  q('li[data-booking-id="7"]').querySelector('button[data-status-to="aprovado"]').click();
  await flush();
  assert.deepEqual(body, { status: "aprovado" });
  assert.ok(calls.some((c) => c.method === "POST"));
  const item = q('li[data-booking-id="7"]');
  assert.equal(item.querySelector("[data-status]").getAttribute("data-status"), "aprovado");
});

test("reject needs an inline confirmation", async () => {
  const { calls, q } = await start(STAFF, routes({
    "POST /api/admin/bookings/7/status": () => [200, { booking: adminBooking(7, "recusado") }],
  }));
  const item = q('li[data-booking-id="7"]');
  item.querySelector('button[data-status-to="recusado"]').click();
  assert.equal(calls.filter((c) => c.method === "POST").length, 0);
  item.querySelector('button[data-action="confirm"]').click();
  await flush();
  assert.equal(calls.filter((c) => c.method === "POST").length, 1);
});

test("conflict on approve shows the message and reloads", async () => {
  let loads = 0;
  const { q } = await start(STAFF, routes({
    "GET /api/admin/bookings": () => {
      loads += 1;
      return [200, { bookings: [adminBooking(7, "pendente")] }];
    },
    "POST /api/admin/bookings/7/status": () => [409, { error: { code: "slot_taken", message: "Este horário já está reservado." } }],
  }));
  q('button[data-status-to="aprovado"]').click();
  await flush();
  assert.equal(loads, 2);
  assert.match(globalThis.document.getElementById("toasts").textContent, /já está reservado/);
});

test("Ver contato calls the audited route and shows the text", async () => {
  const { calls, q } = await start(STAFF, routes({
    "GET /api/admin/bookings/7/contact": () => [200, { contact: "(19) 9 <i>x</i>", message: "Oi" }],
  }));
  const item = q('li[data-booking-id="7"]');
  item.querySelector('button[data-action="contact"]').click();
  await flush();
  assert.ok(calls.some((c) => c.path === "/api/admin/bookings/7/contact"));
  assert.match(item.textContent, /\(19\) 9 <i>x<\/i>/);
  assert.match(item.textContent, /Oi/);
  assert.equal(item.querySelectorAll("i").length, 0);
});

// ---------- contato revelado não fica no DOM além do necessário ----------

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
    fire() {
      for (const [id, t] of [...timers]) {
        timers.delete(id);
        t.fn();
      }
    },
  };
}

const SECRET = "(19) 98888-7777";

async function revealOn(extra = {}, handler) {
  const clock = fakeTimers();
  const ctx = await start(STAFF, handler || routes({
    "GET /api/admin/bookings/7/contact": () => [200, { contact: SECRET, message: "Mensagem secreta" }],
  }), { setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, ...extra });
  const item = () => ctx.q('li[data-booking-id="7"]');
  item().querySelector('button[data-action="contact"]').click();
  await flush();
  return { ...ctx, clock, item };
}

test("Ocultar removes the revealed contact and restores the masked line", async () => {
  const { item, clock } = await revealOn();
  assert.match(item().textContent, /98888-7777/);
  assert.equal(clock.timers.size, 1);
  assert.equal([...clock.timers.values()][0].ms, 30000);
  item().querySelector('button[data-action="hide-contact"]').click();
  assert.doesNotMatch(item().textContent, /98888-7777|Mensagem secreta/);
  assert.match(item().textContent, /gAAAAABpQ7xYz-CONTATO/);
  assert.doesNotMatch(item().textContent, /••••••/);
  assert.ok(item().querySelector('button[data-action="contact"]'), "can reveal again");
  assert.equal(clock.timers.size, 0, "timer cancelled");
});

test("revealed contact hides itself after the timeout", async () => {
  const { item, clock } = await revealOn();
  clock.fire();
  assert.doesNotMatch(item().textContent, /98888-7777/);
  assert.ok(item().querySelector('button[data-action="contact"]'));
});

test("switching tabs hides every revealed contact", async () => {
  const { item, q, clock } = await revealOn();
  q("#aba-agenda").click();
  await flush();
  assert.doesNotMatch(item().textContent, /98888-7777|Mensagem secreta/);
  assert.equal(clock.timers.size, 0);
});

test("page going to background hides revealed contacts", async () => {
  const { item } = await revealOn();
  const doc = globalThis.document;
  doc.visibilityState = "hidden";
  for (const fn of doc.listeners.visibilitychange || []) fn();
  assert.doesNotMatch(item().textContent, /98888-7777/);
});

test("a contact arriving after a tab switch is not shown", async () => {
  let release;
  const clock = fakeTimers();
  const { q } = await start(STAFF, routes({
    "GET /api/admin/bookings/7/contact": () => new Promise((r) => (release = () => r([200, { contact: SECRET, message: "" }]))),
  }), { setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
  q('li[data-booking-id="7"]').querySelector('button[data-action="contact"]').click();
  await flush();
  q("#aba-bloqueios").click();
  release();
  await flush();
  assert.doesNotMatch(q("[data-orders-list]").textContent, /98888-7777/);
  assert.equal(clock.timers.size, 0);
});

test("filters reload orders with the chosen params", async () => {
  const { calls, q } = await start(STAFF);
  const form = q("#filtros-pedidos");
  form.querySelector('select[name="status"]').value = "";
  form.querySelector('select[name="field"]').value = "2";
  form.querySelector('input[name="date"]').value = "2026-10-20";
  form.dispatch("change");
  await flush();
  const last = calls.filter((c) => c.path === "/api/admin/bookings").at(-1);
  assert.deepEqual(last.query, { field: "2", date: "2026-10-20" });
});

test("tabs switch panels by click and by arrow keys", async () => {
  const { q } = await start(STAFF);
  q("#aba-bloqueios").click();
  await flush();
  assert.equal(q("#aba-bloqueios").getAttribute("aria-selected"), "true");
  assert.equal(q("#aba-pedidos").getAttribute("aria-selected"), "false");
  assert.equal(q("#painel-bloqueios").hidden, false);
  assert.equal(q("#painel-pedidos").hidden, true);
  q("#aba-bloqueios").dispatch("keydown", { key: "ArrowRight" });
  await flush();
  assert.equal(q("#aba-agenda").getAttribute("aria-selected"), "true");
  assert.equal(globalThis.document.activeElement, q("#aba-agenda"));
});

test("create block posts slot times with offset and reason, then lists it", async () => {
  let posted;
  let blocks = [];
  const { q } = await start(STAFF, routes({
    "POST /api/admin/blocks": (call) => {
      posted = call.body;
      blocks = [{ id: 4, field: 2, start: call.body.start, end: call.body.end, reason: call.body.reason, created_at: "" }];
      return [201, { block: blocks[0] }];
    },
    "GET /api/admin/blocks": () => [200, { blocks }],
  }));
  q("#aba-bloqueios").click();
  await flush();
  const form = q("#form-bloqueio");
  form.querySelector('input[name="date"]').value = "2026-10-20";
  form.querySelector('input[name="date"]').dispatch("change", { target: form.querySelector('input[name="date"]') });
  await flush();
  assert.equal(form.querySelector('select[name="start"]').children.length, 3);
  form.querySelector('select[name="start"]').value = "2026-10-20T18:00:00-03:00";
  form.querySelector('select[name="end"]').value = "2026-10-20T20:00:00-03:00";
  form.querySelector('input[name="reason"]').value = " Manutenção ";
  form.dispatch("submit");
  await flush();
  assert.deepEqual(posted, { field: 2, start: "2026-10-20T18:00:00-03:00", end: "2026-10-20T20:00:00-03:00", reason: "Manutenção" });
  const items = q("[data-blocks-list]").querySelectorAll("li[data-block-id]");
  assert.equal(items.length, 1);
  assert.match(items[0].textContent, /Manutenção/);
});

test("create block 409 lists conflicting booking ids", async () => {
  const { q } = await start(STAFF, routes({
    "POST /api/admin/blocks": () => [409, { error: { code: "conflict", message: "Existem reservas aprovadas neste intervalo.", fields: { conflicts: [12, 15] } } }],
  }));
  q("#aba-bloqueios").click();
  await flush();
  const form = q("#form-bloqueio");
  const date = form.querySelector('input[name="date"]');
  date.value = "2026-10-20";
  date.dispatch("change", { target: date });
  await flush();
  form.querySelector('select[name="start"]').value = "2026-10-20T18:00:00-03:00";
  form.querySelector('select[name="end"]').value = "2026-10-20T20:00:00-03:00";
  form.dispatch("submit");
  await flush();
  assert.match(form.querySelector("[data-form-error]").textContent, /conflita com pedidos #12, #15/i);
});

test("end before start is rejected client-side", async () => {
  const { calls, q } = await start(STAFF);
  q("#aba-bloqueios").click();
  await flush();
  const form = q("#form-bloqueio");
  const date = form.querySelector('input[name="date"]');
  date.value = "2026-10-20";
  date.dispatch("change", { target: date });
  await flush();
  form.querySelector('select[name="start"]').value = "2026-10-20T20:00:00-03:00";
  form.querySelector('select[name="end"]').value = "2026-10-20T19:00:00-03:00";
  form.dispatch("submit");
  await flush();
  assert.equal(calls.filter((c) => c.method === "POST").length, 0);
  assert.match(form.querySelector("[data-form-error]").textContent, /depois do início/);
});

test("delete block asks inline, then sends DELETE", async () => {
  let blocks = [{ id: 4, field: 2, start: "2026-10-20T18:00:00-03:00", end: "2026-10-20T19:00:00-03:00", reason: "Evento", created_at: "" }];
  const { calls, q } = await start(STAFF, routes({
    "GET /api/admin/blocks": () => [200, { blocks }],
    "DELETE /api/admin/blocks/4": () => {
      blocks = [];
      return [204, undefined];
    },
  }));
  q("#aba-bloqueios").click();
  await flush();
  const item = q('li[data-block-id="4"]');
  item.querySelector('button[data-action="delete"]').click();
  assert.equal(calls.filter((c) => c.method === "DELETE").length, 0);
  item.querySelector('button[data-action="confirm"]').click();
  await flush();
  assert.ok(calls.some((c) => c.method === "DELETE" && c.path === "/api/admin/blocks/4"));
  assert.equal(q("[data-blocks-list]").querySelectorAll("li[data-block-id]").length, 0);
});

test("agenda lists the day with bookings and blocks", async () => {
  const { calls, q } = await start(STAFF);
  q("#aba-agenda").click();
  await flush();
  const call = calls.find((c) => c.path === "/api/admin/agenda");
  assert.deepEqual(call.query, { field: "2", date: "2026-10-18" });
  const rows = q("[data-agenda-list]").querySelectorAll("li[data-state]");
  assert.deepEqual([...rows].map((r) => r.getAttribute("data-state")), ["booked", "blocked", "free"]);
  assert.match(rows[0].textContent, /#8/);
  assert.match(rows[1].textContent, /Manutenção/);
  q("[data-day-next]").click();
  await flush();
  assert.equal(calls.filter((c) => c.path === "/api/admin/agenda").at(-1).query.date, "2026-10-19");
});

test("staff with no active fields sees clear empty states, no JS error", async () => {
  const { q } = await start(STAFF, routes({ "GET /api/fields": () => [200, { fields: [] }] }));
  q("#aba-agenda").click();
  await flush();
  assert.match(q("[data-agenda-status]").textContent, /Nenhum campo ativo/);
  q("#aba-bloqueios").click();
  await flush();
  assert.match(q("[data-blocks-status]").textContent, /Nenhum campo ativo/);
});
