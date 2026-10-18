// Painel: KPIs acima do Kanban e aba Criptografia (tokens crus, anatomia, decifrar auditado).
import { test } from "node:test";
import assert from "node:assert/strict";

import { installFakeDom, h } from "./fake-dom.mjs";
import { mockFetch, flush, fakeLocation } from "./fake-api.mjs";
import { initPanel, initialTab } from "../panel.js";

const NOW = new Date("2026-10-18T15:00:00-03:00");
const STAFF = { id: 1, name: "Equipe", email: "e@ct.com", is_staff: true };
const TOKEN = "gAAAAABpQ7xYz-CONTATO-TOKEN-0123456789abcdefghijklmnopqrstuvwxyz_ABCDEFG==";
const MTOKEN = "gAAAAABpQ7xYz-MENSAGEM-TOKEN-0123456789abcdefghijklmnopqrstuvwxyz_HIJK==";
const SECRET = "(19) 98888-7777";
const STATS = { pending: 2, approved_next7: 1, booked_hours_next7: 2, occupancy_next7: 8, lost_last30: 0, revenue_next7: "300.00" };

function select(name, id, ...options) {
  return h("select", { name, id }, ...options.map(([v, t]) => h("option", { value: v }, t)));
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
      h("div", { id: "painel-abas", role: "tablist" }, tab("kanban"), tab("pedidos"), tab("bloqueios"), tab("agenda"), tab("cripto")),
      h("section", { id: "painel-kanban", role: "tabpanel" },
        h("section", { "data-kpis": true }, h("ul", { "data-kpi-grid": true }), h("p", { "data-kpi-live": true })),
        h("form", { id: "filtros-kanban" },
          select("field", "kanban-campo", ["", "Todos os campos"]),
          h("input", { name: "date_from", type: "date" }),
          h("input", { name: "date_to", type: "date" }),
          h("input", { name: "q", type: "search" }),
          h("button", { type: "submit" }, "Atualizar"),
          h("div", { "data-form-error": true, hidden: true })),
        h("div", { "data-kanban-status": true, hidden: true }),
        h("div", { "data-kanban-board": true, hidden: true }),
        h("p", { "data-kanban-live": true })),
      h("section", { id: "painel-pedidos", role: "tabpanel", hidden: true },
        h("form", { id: "filtros-pedidos" }, select("status", "", ["pendente", "Pendentes"]), select("field", "", ["", "Todos"]), h("input", { name: "date", type: "date" })),
        h("ul", { "data-orders-list": true }),
        h("div", { "data-orders-status": true, hidden: true })),
      h("section", { id: "painel-bloqueios", role: "tabpanel", hidden: true },
        h("form", { id: "form-bloqueio" }, h("div", { "data-form-error": true, hidden: true }), select("field", ""), h("input", { name: "date", type: "date" }), select("start", ""), select("end", ""), h("input", { name: "reason" }), h("button", { type: "submit" })),
        h("ul", { "data-blocks-list": true }),
        h("div", { "data-blocks-status": true, hidden: true })),
      h("section", { id: "painel-agenda", role: "tabpanel", hidden: true },
        h("form", { id: "filtros-agenda" }, select("field", ""), h("input", { name: "date", type: "date" })),
        h("ol", { "data-agenda-list": true }),
        h("div", { "data-agenda-status": true, hidden: true })),
      h("section", { id: "painel-cripto", role: "tabpanel", hidden: true },
        h("ul", { "data-crypto-list": true }),
        h("div", { "data-crypto-status": true, hidden: true })),
    ),
  );
  globalThis.document.body.append(root);
  return root;
}

function booking(id, status = "pendente") {
  return {
    id,
    field: { id: 2, name: "Campo 2" },
    start: "2026-10-20T18:00:00-03:00",
    end: "2026-10-20T19:00:00-03:00",
    status,
    status_label: status === "pendente" ? "Pendente" : "Aprovado",
    contact_masked: "••••••",
    contact_token: TOKEN,
    message_token: MTOKEN,
    message_present: true,
    created_at: `2026-10-1${id % 10}T10:00:00-03:00`,
    can_cancel: true,
    user: { id: 5, name: "Ana", email: "ana@x.com" },
    decided_by: null,
  };
}

const ANATOMY = { total_bytes: 73, segments: [{ key: "version", label: "Versão", bytes: 1, hex: "80", char_start: 0, char_end: 1 }, { key: "hmac", label: "HMAC-SHA256", bytes: 32, hex_prefix: "00", char_start: 1, char_end: 40 }] };

function routes(extra = {}) {
  return async (call) => {
    const key = `${call.method} ${call.path}`;
    if (extra[key]) return extra[key](call);
    if (key === "GET /api/fields") return [200, { fields: [{ id: 2, name: "Campo 2", price_per_hour: "150.00" }] }];
    if (key === "GET /api/admin/bookings") return [200, { bookings: [booking(7), booking(8, "aprovado")] }];
    if (key === "GET /api/admin/stats") return [200, STATS];
    if (key === "GET /api/admin/bookings/7/cipher") return [200, { id: 7, algorithm: "Fernet (AES-128-CBC + HMAC-SHA256)", contact_token: TOKEN, message_token: MTOKEN, anatomy: { contact: ANATOMY, message: ANATOMY } }];
    if (key === "GET /api/admin/bookings/7/contact") return [200, { contact: SECRET, message: "Mensagem secreta" }];
    if (key === "POST /api/admin/bookings/7/status") return [200, { booking: booking(7, "aprovado") }];
    throw new Error(`unexpected ${key}`);
  };
}

function fakeTimers() {
  const timers = new Map();
  let next = 1;
  return { timers, setTimeout: (fn, ms) => (timers.set(next, { fn, ms }), next++), clearTimeout: (id) => timers.delete(id), fire() { for (const [id, t] of [...timers]) { timers.delete(id); t.fn(); } } };
}

async function start(extra = {}, hash = "") {
  const root = buildPage();
  const calls = mockFetch(routes(extra));
  const clock = fakeTimers();
  const location = fakeLocation("", "/painel/");
  location.hash = hash;
  await initPanel(root, { now: NOW, getUser: async () => STAFF, location, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
  await flush();
  return { root, calls, clock, q: (s) => root.querySelector(s) };
}

test("initialTab honours the hash only for known tabs", () => {
  installFakeDom();
  const tabs = ["kanban", "cripto"].map((k) => h("button", { "data-tab": k }));
  assert.equal(initialTab(tabs, { hash: "#cripto" }), "cripto");
  assert.equal(initialTab(tabs, { hash: "#nada" }), "kanban");
  assert.equal(initialTab(tabs, null), "kanban");
});

test("KPIs load with the Kanban and refresh after a move", async () => {
  const { q, calls } = await start();
  const kpi = q("[data-kpis]");
  assert.equal(kpi.querySelectorAll(".kpi").length, 6);
  assert.match(kpi.textContent, /R\$ 300,00/);
  assert.match(kpi.textContent, /8%/);
  const before = calls.filter((c) => c.path === "/api/admin/stats").length;
  q('li[data-booking-id="7"]').querySelector('[data-action="move"]').click();
  q('li[data-booking-id="7"]').querySelector('button[data-move-to="aprovado"]').click();
  await flush();
  assert.equal(calls.filter((c) => c.path === "/api/admin/stats").length, before + 1);
});

test("Kanban card shows the compact encrypted token, never the mask", async () => {
  const { q } = await start();
  const card = q('li[data-booking-id="7"]');
  assert.match(card.textContent, /🔒 Contato \(criptografado\)/);
  assert.ok(card.querySelector(".ctoken--compact"));
  assert.doesNotMatch(card.textContent, /••••••/);
  assert.equal(card.querySelector('button[data-action="contact"]').textContent, "Descriptografar");
});

test("#cripto opens the Criptografia tab with recent bookings and tokens", async () => {
  const { q, calls } = await start({}, "#cripto");
  assert.equal(q("#painel-cripto").hidden, false);
  assert.ok(calls.some((c) => c.path === "/api/admin/bookings"));
  const items = q("[data-crypto-list]").querySelectorAll("li.cipher-item");
  assert.equal(items.length, 2);
  assert.equal(items[0].getAttribute("data-booking-id"), "8", "newest first");
  assert.match(items[1].textContent, /gAAAAABpQ7xYz-CONTATO-TOKEN-0123…/);
});

test("Criptografia: anatomy toggles from the cipher route", async () => {
  const { q, calls } = await start({}, "#cripto");
  const item = q('li.cipher-item[data-booking-id="7"]');
  const button = item.querySelector('button[data-action="anatomy"]');
  button.click();
  await flush();
  assert.ok(calls.some((c) => c.path === "/api/admin/bookings/7/cipher"));
  assert.equal(button.getAttribute("aria-expanded"), "true");
  assert.equal(item.querySelectorAll("[data-anatomy]").length, 2);
  button.click();
  assert.equal(item.querySelectorAll("[data-anatomy]").length, 0);
});

test("Criptografia: Descriptografar shows before -> after, audits, and Ocultar returns to the token", async () => {
  const { q, calls, clock } = await start({}, "#cripto");
  const item = () => q('li.cipher-item[data-booking-id="7"]');
  item().querySelector('button[data-action="contact"]').click();
  await flush();
  assert.ok(calls.some((c) => c.path === "/api/admin/bookings/7/contact"));
  const text = item().textContent;
  assert.match(text, /Antes \(criptografado\) → depois \(decifrado\)/);
  assert.match(text, /gAAAAABpQ7xYz-CONTAT…→ decifrado: \(19\) 98888-7777/);
  assert.match(text, /registrado na auditoria/);
  assert.equal([...clock.timers.values()][0].ms, 30000);
  item().querySelector('button[data-action="hide-contact"]').click();
  assert.doesNotMatch(item().textContent, /98888-7777|Mensagem secreta/);
  assert.match(item().textContent, /Contato \(criptografado\)/);
  assert.equal(clock.timers.size, 0);
});

test("Criptografia: switching tab hides the plaintext; late reveal is dropped", async () => {
  let release;
  const { q, root } = await start({
    "GET /api/admin/bookings/7/contact": () => new Promise((r) => (release = () => r([200, { contact: SECRET, message: "" }]))),
  }, "#cripto");
  q('li.cipher-item[data-booking-id="7"]').querySelector('button[data-action="contact"]').click();
  await flush();
  q("#aba-agenda").click();
  release();
  await flush();
  assert.doesNotMatch(root.textContent, /98888-7777/);
});

test("KPI 403 switches the panel to access denied", async () => {
  const { q } = await start({ "GET /api/admin/stats": () => [403, { error: { code: "forbidden", message: "Acesso restrito à equipe." } }] });
  assert.equal(q("[data-panel-denied]").hidden, false);
  assert.equal(q("[data-kpi-grid]").children.length, 0);
});
