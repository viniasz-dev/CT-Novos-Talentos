import { test } from "node:test";
import assert from "node:assert/strict";

import { installFakeDom, h } from "./fake-dom.mjs";
import { mockFetch, flush, fakeLocation } from "./fake-api.mjs";
import { readQuery, loginUrl, totalPrice, validateBookingForm, initBooking } from "../booking.js";

// ---------- funções puras ----------

test("readQuery keeps a numeric field and a valid date only", () => {
  assert.deepEqual(readQuery("?field=2&date=2026-10-20"), { field: 2, date: "2026-10-20" });
  assert.deepEqual(readQuery("?field=abc&date=2026-02-30"), { field: null, date: null });
  assert.deepEqual(readQuery(""), { field: null, date: null });
  assert.deepEqual(readQuery("?field=-1&date=20/10/2026"), { field: null, date: null });
});

test("loginUrl sends the user back to the same field and day", () => {
  assert.equal(loginUrl(2, "2026-10-20"), "/entrar/?next=%2Freservar%2F%3Ffield%3D2%26date%3D2026-10-20");
  assert.equal(loginUrl(null, null), "/entrar/?next=%2Freservar%2F");
});

test("totalPrice multiplies the hourly price by the hours", () => {
  assert.equal(totalPrice("150.00", 2), 300);
  assert.equal(totalPrice("99.90", 3), 299.7);
  assert.equal(totalPrice("", 2), null);
  assert.equal(totalPrice("150", 0), null);
});

test("validateBookingForm requires contact and enforces limits", () => {
  assert.deepEqual(validateBookingForm({ contact: "(19) 99999-0000", message: "" }), {});
  assert.match(validateBookingForm({ contact: "   ", message: "" }).contact, /Informe/);
  assert.match(validateBookingForm({ contact: "x".repeat(121), message: "" }).contact, /120/);
  assert.match(validateBookingForm({ contact: "ok", message: "y".repeat(501) }).message, /500/);
  // emoji e acentos contam como caracteres, não como bytes
  assert.deepEqual(validateBookingForm({ contact: "João ⚽", message: "ação 🎉" }), {});
});

// ---------- DOM ----------

const NOW = new Date("2026-10-18T15:00:00-03:00");
const FIELDS = [
  { id: 1, name: "Campo 1", description: "Grama sintética", price_per_hour: "120.00", photo: "" },
  { id: 2, name: "Campo 2", description: "", price_per_hour: "150.00", photo: "imgs/c2.jpg" },
];

function daySlots(date, states) {
  return {
    field: 2,
    date,
    open: states.length > 0,
    slots: states.map((state, i) => ({
      start: `${date}T${18 + i}:00:00-03:00`,
      end: `${date}T${19 + i}:00:00-03:00`,
      state,
    })),
  };
}

function overview() {
  const days = {};
  for (let d = 1; d <= 31; d += 1) {
    const date = `2026-10-${String(d).padStart(2, "0")}`;
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const open = weekday >= 1 && weekday <= 5;
    days[date] = { open, free: open ? (date === "2026-10-21" ? 0 : 5) : 0, total: open ? 5 : 0 };
  }
  return { field: 2, days };
}

function stateTemplate(kind, ...children) {
  const tpl = h("template", { "data-state": kind });
  tpl.content.append(h("div", { class: "state" }, ...children));
  return tpl;
}

function buildPage() {
  installFakeDom();
  const root = h(
    "div",
    { id: "reserva", "data-static-base": "/static/", "data-fallback-photo": "/static/fb.jpg" },
    h(
      "section",
      { id: "campos-reserva" },
      h("div", { "data-fields-skeleton": true }),
      h("div", { "data-fields-list": true, hidden: true }),
      h("div", { "data-fields-status": true, hidden: true }),
      stateTemplate("empty", h("h3", {}, "Nenhum campo aberto para reserva agora"),
        h("a", { href: "https://wa.me/5519999117711" }, "Chamar no WhatsApp")),
      stateTemplate("error", h("h3", {}, "Não foi possível carregar os campos"),
        h("button", { type: "button", "data-retry": true }, "Tentar de novo")),
    ),
    h(
      "section",
      { id: "calendario" },
      h("button", { type: "button", "data-cal-prev": true }),
      h("h3", { "data-cal-title": true }),
      h("button", { type: "button", "data-cal-next": true }),
      h("div", { "data-cal-body": true }),
      h("p", { "data-cal-hint": true }),
    ),
    h(
      "section",
      { id: "horarios" },
      h("p", { "data-slots-hint": true }),
      h("div", { "data-slots-skeleton": true, hidden: true }),
      h("ol", { "data-slots-list": true, hidden: true }),
      h("div", { "data-slots-status": true, hidden: true }),
    ),
    h(
      "aside",
      { id: "resumo" },
      h("span", { "data-sum-field": true }),
      h("span", { "data-sum-date": true }),
      h("span", { "data-sum-time": true }),
      h("span", { "data-sum-hours": true }),
      h("strong", { "data-sum-total": true }),
      h(
        "form",
        { id: "form-reserva" },
        h("div", { "data-form-error": true, hidden: true }),
        h("input", { id: "reserva-contato", name: "contact" }),
        h("p", { id: "reserva-contato-erro", class: "field__error", hidden: true }),
        h("textarea", { id: "reserva-mensagem", name: "message" }),
        h("p", { id: "reserva-mensagem-erro", class: "field__error", hidden: true }),
        h("span", { "data-counter": true }),
        h("button", { type: "submit" }, "Enviar pedido"),
      ),
      h("div", { "data-success": true, hidden: true }),
    ),
    h("div", { "data-booking-bar": true, hidden: true }, h("strong", { "data-bar-total": true })),
  );
  globalThis.document.body.append(root);
  return root;
}

function defaultRoutes(extra = {}) {
  return async (call) => {
    if (extra[call.method + " " + call.path]) return extra[call.method + " " + call.path](call);
    if (call.path === "/api/fields") return [200, { fields: FIELDS }];
    if (call.path === "/api/availability" && call.query.from) return [200, overview()];
    if (call.path === "/api/availability" && call.query.date) {
      return [200, daySlots(call.query.date, ["free", "free", "booked", "free", "past"])];
    }
    throw new Error(`unexpected ${call.method} ${call.url}`);
  };
}

async function start(search, routes = defaultRoutes(), opts = {}) {
  const root = buildPage();
  const calls = mockFetch(routes);
  const location = fakeLocation(search, "/reservar/");
  await initBooking(root, { now: NOW, location, history: null, getUser: async () => null, ...opts });
  await flush();
  return { root, calls, location };
}

const q = (root, sel) => root.querySelector(sel);

for (const [label, body] of [["{fields: []}", { fields: [] }], ["[]", []], ["null", null]]) {
  test(`no active fields (${label}) shows the empty state and hides the rest`, async () => {
    const { root, calls } = await start("?field=1&date=2026-10-20", async (call) => {
      if (call.path === "/api/fields") return [200, body];
      throw new Error("no other call expected");
    });
    assert.deepEqual(calls.map((c) => c.path), ["/api/fields"]);
    const status = q(root, "[data-fields-status]");
    assert.equal(status.hidden, false);
    assert.match(status.textContent, /Nenhum campo aberto/);
    assert.ok(status.querySelector('[href="https://wa.me/5519999117711"]'));
    for (const id of ["#calendario", "#horarios", "#resumo"]) assert.equal(q(root, id).hidden, true, id);
    assert.equal(q(root, "[data-fields-skeleton]").hidden, true);
  });
}

test("fields failure shows the error state and retry reloads", async () => {
  let fail = true;
  const { root, calls } = await start("", async (call) => {
    if (call.path === "/api/fields") {
      if (fail) throw new TypeError("Failed to fetch");
      return [200, { fields: FIELDS }];
    }
    return defaultRoutes()(call);
  });
  const status = q(root, "[data-fields-status]");
  assert.match(status.textContent, /Não foi possível carregar/);
  fail = false;
  status.querySelector("[data-retry]").click();
  await flush();
  assert.equal(calls.filter((c) => c.path === "/api/fields").length, 2);
  assert.equal(status.hidden, true);
  assert.equal(q(root, "[data-fields-list]").querySelectorAll("button[data-field-id]").length, 2);
});

test("field cards render as radios with price, text never parsed as HTML", async () => {
  const { root } = await start("", async (call) => {
    if (call.path === "/api/fields") {
      return [200, { fields: [...FIELDS, { id: 3, name: "<img src=x onerror=alert(1)>", price_per_hour: "1" }] }];
    }
    return defaultRoutes()(call);
  });
  const cards = q(root, "[data-fields-list]").querySelectorAll("button[data-field-id]");
  assert.equal(cards.length, 3);
  assert.ok([...cards].every((c) => c.getAttribute("role") === "radio" && c.getAttribute("aria-checked") === "false"));
  assert.match(cards[1].textContent, /R\$ 150,00/);
  assert.match(cards[2].textContent, /<img src=x/);
  assert.equal(cards[2].querySelectorAll("img").length, 1, "only the card photo");
});

test("?field= and ?date= preselect the field, month and day", async () => {
  const { root, calls } = await start("?field=2&date=2026-10-20");
  const card = q(root, 'button[data-field-id="2"]');
  assert.equal(card.getAttribute("aria-checked"), "true");
  const overviewCall = calls.find((c) => c.query.from);
  assert.deepEqual(overviewCall.query, { field: "2", from: "2026-10-01", to: "2026-10-31" });
  const dayCall = calls.find((c) => c.query.date);
  assert.deepEqual(dayCall.query, { field: "2", date: "2026-10-20" });
  assert.equal(q(root, 'button[data-date="2026-10-20"]').getAttribute("aria-pressed"), "true");
  assert.equal(q(root, "[data-slots-list]").querySelectorAll("button[data-slot]").length, 5);
  assert.match(q(root, "[data-sum-field]").textContent, /Campo 2/);
  assert.match(q(root, "[data-cal-title]").textContent, /outubro/i);
});

test("calendar disables past, closed and full days", async () => {
  const { root } = await start("?field=2");
  const day = (d) => q(root, `button[data-date="${d}"]`);
  assert.ok(day("2026-10-17").hasAttribute("disabled"), "past");
  assert.ok(day("2026-10-24").hasAttribute("disabled"), "saturday closed");
  assert.ok(day("2026-10-21").hasAttribute("disabled"), "full");
  assert.ok(!day("2026-10-20").hasAttribute("disabled"), "free");
  assert.equal(day("2026-10-20").getAttribute("data-state"), "free");
});

test("arrow keys move focus between available days, skipping disabled ones", async () => {
  const { root } = await start("?field=2&date=2026-10-20");
  const day = (d) => q(root, `button[data-date="${d}"]`);
  assert.equal(day("2026-10-20").getAttribute("tabindex"), "0", "selected day is the tab stop");
  assert.equal(day("2026-10-22").getAttribute("tabindex"), "-1");
  day("2026-10-20").dispatch("keydown", { key: "ArrowRight" });
  assert.equal(globalThis.document.activeElement, day("2026-10-22"), "21 is full: skipped");
  globalThis.document.activeElement.dispatch("keydown", { key: "ArrowDown" });
  assert.equal(globalThis.document.activeElement, day("2026-10-29"));
  globalThis.document.activeElement.dispatch("keydown", { key: "ArrowLeft" });
  assert.equal(globalThis.document.activeElement, day("2026-10-28"));
});

test("picking a day loads its slots; picking slots updates the summary and total", async () => {
  const { root, calls } = await start("?field=2");
  q(root, 'button[data-date="2026-10-22"]').click();
  await flush();
  assert.ok(calls.some((c) => c.query.date === "2026-10-22"));
  const slot = (i) => q(root, `button[data-slot="${i}"]`);
  assert.ok(slot(2).hasAttribute("disabled"), "booked slot disabled");
  slot(0).click();
  slot(1).click();
  assert.equal(slot(0).getAttribute("aria-pressed"), "true");
  assert.equal(slot(1).getAttribute("aria-pressed"), "true");
  assert.match(q(root, "[data-sum-time]").textContent, /18:00.*20:00/);
  assert.match(q(root, "[data-sum-hours]").textContent, /2 horas/);
  assert.equal(q(root, "[data-sum-total]").textContent, "R$ 300,00");
  assert.equal(q(root, "[data-booking-bar]").hidden, false);
  assert.equal(q(root, "[data-bar-total]").textContent, "R$ 300,00");
  slot(1).click();
  assert.equal(q(root, "[data-sum-total]").textContent, "R$ 150,00");
});

test("message counter tracks typed characters", async () => {
  const { root } = await start("?field=2&date=2026-10-20");
  const msg = q(root, 'textarea[name="message"]');
  msg.value = "Bora jogar ⚽";
  msg.dispatch("input");
  assert.match(q(root, "[data-counter]").textContent, /12\/500/);
});

test("submit without a slot asks for one and sends nothing", async () => {
  const { root, calls } = await start("?field=2&date=2026-10-20");
  q(root, 'input[name="contact"]').value = "(19) 90000-0000";
  q(root, "#form-reserva").dispatch("submit");
  await flush();
  assert.equal(calls.filter((c) => c.method === "POST").length, 0);
  assert.match(q(root, "[data-form-error]").textContent, /horário/);
});

test("anonymous submit goes to login keeping field and day", async () => {
  const { root, calls, location } = await start("?field=2&date=2026-10-20");
  q(root, 'button[data-slot="0"]').click();
  q(root, 'input[name="contact"]').value = "(19) 90000-0000";
  q(root, "#form-reserva").dispatch("submit");
  await flush();
  assert.equal(calls.filter((c) => c.method === "POST").length, 0);
  assert.deepEqual(location.assigned, ["/entrar/?next=%2Freservar%2F%3Ffield%3D2%26date%3D2026-10-20"]);
});

test("a 401 from the API also goes to login", async () => {
  const { root, location } = await start(
    "?field=2&date=2026-10-20",
    defaultRoutes({
      "POST /api/bookings": () => [401, { error: { code: "not_authenticated", message: "Faça login para continuar." } }],
    }),
    { getUser: async () => ({ id: 1, name: "Ana", is_staff: false }) },
  );
  q(root, 'button[data-slot="0"]').click();
  q(root, 'input[name="contact"]').value = "x";
  q(root, "#form-reserva").dispatch("submit");
  await flush();
  assert.deepEqual(location.assigned, ["/entrar/?next=%2Freservar%2F%3Ffield%3D2%26date%3D2026-10-20"]);
});

test("successful submit posts the range and shows the pending confirmation", async () => {
  let posted;
  const { root } = await start(
    "?field=2&date=2026-10-20",
    defaultRoutes({
      "POST /api/bookings": (call) => {
        posted = call.body;
        return [201, {
          booking: {
            id: 9, field: { id: 2, name: "Campo 2" }, start: call.body.start, end: call.body.end,
            status: "pendente", status_label: "Pendente", can_cancel: true,
            contact_token: "gAAAAABtoken-do-contato-0123456789-abcdefghij", message_token: "gAAAAABtoken-da-mensagem-0123456789-abcdefgh",
          },
        }];
      },
    }),
    { getUser: async () => ({ id: 1, name: "Ana", is_staff: false }) },
  );
  q(root, 'button[data-slot="0"]').click();
  q(root, 'button[data-slot="1"]').click();
  q(root, 'input[name="contact"]').value = "  (19) 90000-0000 ";
  q(root, 'textarea[name="message"]').value = "Time do bairro";
  q(root, "#form-reserva").dispatch("submit");
  await flush();
  assert.deepEqual(posted, {
    field: 2,
    kind: "avulsa",
    start: "2026-10-20T18:00:00-03:00",
    end: "2026-10-20T20:00:00-03:00",
    contact: "(19) 90000-0000",
    message: "Time do bairro",
  });
  const success = q(root, "[data-success]");
  assert.equal(success.hidden, false);
  assert.match(success.textContent, /pendente/i);
  assert.ok(success.querySelector('a[href="/minhas-reservas/?novo=9"]'));
  // o contato aparece como ficou guardado (token), nunca em claro
  assert.match(success.textContent, /Contato \(criptografado\)/);
  assert.match(success.textContent, /gAAAAABtoken-do-contato-01234567…/);
  assert.doesNotMatch(success.textContent, /90000-0000/);
  assert.equal(q(root, "#form-reserva").hidden, true);
});

test("409 shows the reason, reloads the grid and clears the selection", async () => {
  let dayLoads = 0;
  const { root } = await start(
    "?field=2&date=2026-10-20",
    async (call) => {
      if (call.method === "POST") {
        return [409, { error: { code: "slot_taken", message: "Este horário já está reservado." } }];
      }
      if (call.query.date) {
        dayLoads += 1;
        return [200, daySlots("2026-10-20", dayLoads > 1 ? ["booked", "free", "booked", "free", "past"] : ["free", "free", "booked", "free", "past"])];
      }
      return defaultRoutes()(call);
    },
    { getUser: async () => ({ id: 1, name: "Ana", is_staff: false }) },
  );
  q(root, 'button[data-slot="0"]').click();
  q(root, 'input[name="contact"]').value = "x";
  q(root, "#form-reserva").dispatch("submit");
  await flush();
  assert.match(q(root, "[data-form-error]").textContent, /já está reservado/);
  assert.equal(dayLoads, 2);
  assert.ok(q(root, 'button[data-slot="0"]').hasAttribute("disabled"));
  assert.equal(q(root, "[data-sum-total]").textContent, "—");
});

test("success uses the field, day and time sent, even if the user changes them mid-request", async () => {
  let release;
  const { root } = await start(
    "?field=2&date=2026-10-20",
    defaultRoutes({
      "POST /api/bookings": () => new Promise((r) => (release = () => r([201, { booking: { id: 9, status: "pendente", status_label: "Pendente" } }]))),
    }),
    { getUser: async () => ({ id: 1, name: "Ana", is_staff: false }) },
  );
  q(root, 'button[data-slot="0"]').click();
  q(root, 'input[name="contact"]').value = "x";
  q(root, "#form-reserva").dispatch("submit");
  await flush();
  // enquanto o POST não volta, a pessoa troca de campo
  q(root, 'button[data-field-id="1"]').click();
  await flush();
  release();
  await flush();
  const success = q(root, "[data-success]");
  assert.equal(success.hidden, false);
  assert.match(success.textContent, /Campo 2/);
  assert.doesNotMatch(success.textContent, /Campo 1/);
  assert.match(success.textContent, /20 de outubro/);
  assert.match(success.textContent, /18:00 às 19:00/);
});

test("a session check failure re-enables the submit button", async () => {
  const { root, calls } = await start("?field=2&date=2026-10-20", defaultRoutes(), {
    getUser: async () => {
      throw new TypeError("offline");
    },
  });
  q(root, 'button[data-slot="0"]').click();
  q(root, 'input[name="contact"]').value = "x";
  const submit = q(root, 'button[type="submit"]');
  q(root, "#form-reserva").dispatch("submit");
  await flush();
  assert.equal(submit.disabled, false);
  assert.equal(submit.classList.contains("is-busy"), false);
  assert.equal(calls.filter((c) => c.method === "POST").length, 0);
  assert.match(globalThis.document.getElementById("toasts").textContent, /sessão/);
});

test("keyboard focus on a day survives the month grid being rebuilt", async () => {
  let failOverview = true;
  const { root } = await start("?field=2&date=2026-10-20", async (call) => {
    if (call.query.from && failOverview) throw new TypeError("offline");
    return defaultRoutes()(call);
  });
  const old = q(root, 'button[data-date="2026-10-22"]');
  assert.ok(!old.hasAttribute("disabled"), "unknown days stay pickable");
  old.focus();
  failOverview = false;
  q(root, "[data-cal-hint]").querySelector("button").click();
  await flush();
  const now = q(root, 'button[data-date="2026-10-22"]');
  assert.notEqual(now, old, "grid was rebuilt");
  assert.equal(globalThis.document.activeElement, now);
  assert.equal(now.getAttribute("tabindex"), "0");
});

test("day load failure shows a retry inside the slots area", async () => {
  let fail = true;
  const { root } = await start("?field=2&date=2026-10-20", async (call) => {
    if (call.query.date) {
      if (fail) return [500, undefined];
      return [200, daySlots("2026-10-20", ["free"])];
    }
    return defaultRoutes()(call);
  });
  const status = q(root, "[data-slots-status]");
  assert.equal(status.hidden, false);
  assert.match(status.textContent, /Não foi possível carregar os horários/);
  fail = false;
  status.querySelector("button[data-retry]").click();
  await flush();
  assert.equal(q(root, "[data-slots-list]").querySelectorAll("button[data-slot]").length, 1);
});

test("a closed day shows a clear message instead of an empty grid", async () => {
  const { root } = await start("?field=2&date=2026-10-24", async (call) => {
    if (call.query.date) return [200, { field: 2, date: "2026-10-24", open: false, slots: [] }];
    return defaultRoutes()(call);
  });
  const status = q(root, "[data-slots-status]");
  assert.equal(status.hidden, false);
  assert.match(status.textContent, /fechado/i);
});
