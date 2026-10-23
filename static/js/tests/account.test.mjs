import { test } from "node:test";
import assert from "node:assert/strict";

import { installFakeDom, h } from "./fake-dom.mjs";
import { mockFetch, flush, fakeLocation } from "./fake-api.mjs";
import { filterBookings, countByStatus, canCancelNow, initAccount } from "../account.js";

const NOW = new Date("2026-10-18T15:00:00-03:00");

function booking(id, status, start = "2026-10-20T18:00:00-03:00", end = "2026-10-20T20:00:00-03:00") {
  const labels = { pendente: "Pendente", aprovado: "Aprovado", recusado: "Recusado", cancelado: "Cancelado" };
  return {
    id,
    field: { id: 2, name: `Campo ${id}` },
    start,
    end,
    status,
    status_label: labels[status],
    contact_masked: "••••••",
    contact_token: "gAAAAABpQ7xYz-CONTATO-TOKEN-0123456789abcdefghijklmnopqrstuvwxyz_ABCDEFG==",
    message_token: "gAAAAABpQ7xYz-MENSAGEM-TOKEN-0123456789abcdefghijklmnopqrstuvwxyz_HIJK==",
    message_present: false,
    created_at: "2026-10-18T10:00:00-03:00",
    can_cancel: status === "pendente" || status === "aprovado",
  };
}

// ---------- puras ----------

test("filterBookings by status, empty means all", () => {
  const list = [booking(1, "pendente"), booking(2, "aprovado"), booking(3, "pendente")];
  assert.deepEqual(filterBookings(list, "").map((b) => b.id), [1, 2, 3]);
  assert.deepEqual(filterBookings(list, "pendente").map((b) => b.id), [1, 3]);
  assert.deepEqual(filterBookings(list, "recusado"), []);
});

test("countByStatus counts every status", () => {
  const list = [booking(1, "pendente"), booking(2, "aprovado"), booking(3, "pendente")];
  assert.deepEqual(countByStatus(list), { "": 3, pendente: 2, aprovado: 1, recusado: 0, cancelado: 0 });
});

test("canCancelNow needs can_cancel and a future start", () => {
  assert.equal(canCancelNow(booking(1, "pendente"), NOW), true);
  assert.equal(canCancelNow(booking(1, "recusado"), NOW), false);
  assert.equal(canCancelNow(booking(1, "aprovado", "2026-10-18T14:00:00-03:00"), NOW), false);
});

// ---------- DOM ----------

function tpl(kind, ...children) {
  const t = h("template", { "data-state": kind });
  t.content.append(h("div", { class: "state" }, ...children));
  return t;
}

function buildPage() {
  installFakeDom();
  const select = h("select", { id: "filtro-status" },
    h("option", { value: "" }, "Todos"),
    h("option", { value: "pendente" }, "Pendentes"),
    h("option", { value: "aprovado" }, "Aprovados"),
    h("option", { value: "recusado" }, "Recusados"),
    h("option", { value: "cancelado" }, "Cancelados"));
  select.value = "";
  const root = h(
    "section",
    { id: "minhas-reservas" },
    select,
    h("div", { "data-list-skeleton": true }),
    h("ul", { id: "lista-reservas", hidden: true }),
    h("div", { "data-list-status": true, hidden: true }),
    tpl("empty", h("h3", {}, "Você ainda não fez nenhuma reserva"), h("a", { href: "/reservar/" }, "Reservar horário")),
    tpl("filtered", h("h3", {}, "Nenhuma reserva com este status")),
    tpl("error", h("h3", {}, "Não foi possível carregar suas reservas"), h("button", { type: "button", "data-retry": true }, "Tentar de novo")),
  );
  globalThis.document.body.append(root);
  return root;
}

async function start(handler, search = "") {
  const root = buildPage();
  const calls = mockFetch(handler);
  const location = fakeLocation(search, "/minhas-reservas/");
  await initAccount(root, { now: NOW, location });
  await flush();
  return { root, calls, location, list: root.querySelector("#lista-reservas"), status: root.querySelector("[data-list-status]") };
}

test("anonymous user is sent to login and back", async () => {
  const { location, list } = await start(async () => [401, { error: { code: "not_authenticated", message: "Faça login para continuar." } }]);
  assert.deepEqual(location.assigned, ["/entrar/?next=%2Fminhas-reservas%2F"]);
  assert.equal(list.children.length, 0);
});

test("no bookings shows the empty state with a CTA", async () => {
  const { status, list } = await start(async () => [200, { bookings: [] }]);
  assert.equal(list.hidden, true);
  assert.equal(status.hidden, false);
  assert.match(status.textContent, /ainda não fez/);
  assert.ok(status.querySelector('a[href="/reservar/"]'));
});

test("renders bookings with status badges and cancel only where allowed", async () => {
  const { list } = await start(async () => [200, {
    bookings: [booking(1, "pendente"), booking(2, "recusado"), booking(3, "aprovado", "2026-10-18T14:00:00-03:00", "2026-10-18T15:00:00-03:00")],
  }]);
  const items = list.querySelectorAll("li[data-booking-id]");
  assert.equal(items.length, 3);
  assert.equal(items[0].querySelector("[data-status]").getAttribute("data-status"), "pendente");
  // marcador de status no próprio card (a faixa colorida não depende de :has())
  assert.deepEqual([...items].map((li) => li.getAttribute("data-booking-status")), ["pendente", "recusado", "aprovado"]);
  assert.match(items[0].textContent, /Pendente/);
  assert.match(items[0].textContent, /18:00.*20:00/);
  assert.ok(items[0].querySelector('button[data-action="cancel"]'));
  assert.equal(items[1].querySelector('button[data-action="cancel"]'), null);
  assert.equal(items[2].querySelector('button[data-action="cancel"]'), null, "already started");
  // contato e mensagem aparecem criptografados, com link para a página explicativa
  assert.match(items[0].textContent, /🔒 Contato \(criptografado\)gAAAAABpQ7xYz-CONTATO-TOKEN-0123…/);
  assert.match(items[0].textContent, /Mensagem \(criptografada\)/);
  assert.doesNotMatch(items[0].textContent, /••••••/);
  assert.equal(items[0].querySelector('button[data-action="contact"]'), null, "clients cannot decrypt");
});

test("filter narrows the list and updates option counts", async () => {
  const { root, list, status } = await start(async () => [200, { bookings: [booking(1, "pendente"), booking(2, "aprovado")] }]);
  const select = root.querySelector("#filtro-status");
  assert.match(select.querySelector('option[value="pendente"]').textContent, /\(1\)/);
  select.value = "aprovado";
  select.dispatch("change");
  assert.deepEqual([...list.querySelectorAll("li[data-booking-id]")].map((li) => li.getAttribute("data-booking-id")), ["2"]);
  select.value = "recusado";
  select.dispatch("change");
  assert.equal(list.hidden, true);
  assert.match(status.textContent, /Nenhuma reserva com este status/);
});

test("cancel asks inline first, keep restores, confirm posts and updates", async () => {
  const { list, calls } = await start(async (call) => {
    if (call.method === "POST") {
      return [200, { booking: { ...booking(1, "cancelado"), can_cancel: false } }];
    }
    return [200, { bookings: [booking(1, "pendente")] }];
  });
  let item = list.querySelector('li[data-booking-id="1"]');
  item.querySelector('button[data-action="cancel"]').click();
  assert.equal(calls.filter((c) => c.method === "POST").length, 0, "no request before confirming");
  assert.match(item.textContent, /Cancelar este pedido\?/);
  item.querySelector('button[data-action="keep"]').click();
  assert.ok(item.querySelector('button[data-action="cancel"]'));

  item.querySelector('button[data-action="cancel"]').click();
  item.querySelector('button[data-action="confirm-cancel"]').click();
  await flush();
  const post = calls.find((c) => c.method === "POST");
  assert.equal(post.path, "/api/bookings/1/cancel");
  item = list.querySelector('li[data-booking-id="1"]');
  assert.equal(item.querySelector("[data-status]").getAttribute("data-status"), "cancelado");
  assert.equal(item.querySelector('button[data-action="cancel"]'), null);
});

test("cancel conflict shows the reason and reloads the list", async () => {
  let gets = 0;
  const { list } = await start(async (call) => {
    if (call.method === "POST") {
      return [409, { error: { code: "too_late", message: "Não é possível cancelar depois do início do horário." } }];
    }
    gets += 1;
    return [200, { bookings: [booking(1, "pendente")] }];
  });
  const item = list.querySelector('li[data-booking-id="1"]');
  item.querySelector('button[data-action="cancel"]').click();
  item.querySelector('button[data-action="confirm-cancel"]').click();
  await flush();
  assert.equal(gets, 2);
  assert.match(globalThis.document.getElementById("toasts").textContent, /depois do início/);
});

test("load failure shows error with retry", async () => {
  let fail = true;
  const { status, list } = await start(async () => {
    if (fail) throw new TypeError("offline");
    return [200, { bookings: [booking(5, "aprovado")] }];
  });
  assert.match(status.textContent, /Não foi possível carregar/);
  fail = false;
  status.querySelector("[data-retry]").click();
  await flush();
  assert.equal(list.querySelectorAll("li[data-booking-id]").length, 1);
});

test("?novo= highlights the booking just created", async () => {
  const { list } = await start(async () => [200, { bookings: [booking(1, "pendente"), booking(9, "pendente")] }], "?novo=9");
  assert.ok(list.querySelector('li[data-booking-id="9"]').classList.contains("is-new"));
  assert.ok(!list.querySelector('li[data-booking-id="1"]').classList.contains("is-new"));
});
