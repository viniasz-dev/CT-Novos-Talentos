import { test } from "node:test";
import assert from "node:assert/strict";

import { installFakeDom, h } from "./fake-dom.mjs";
import { normalizeFields, photoUrl, todayISO, loadFields, nextOpenDate, initHeroVideo } from "../home.js";
import { initMenu } from "../ui.js";

test("normalizeFields accepts list, wrapped list and garbage", () => {
  assert.deepEqual(normalizeFields([{ id: 1 }]), [{ id: 1 }]);
  assert.deepEqual(normalizeFields({ fields: [{ id: 2 }] }), [{ id: 2 }]);
  assert.deepEqual(normalizeFields([]), []);
  assert.deepEqual(normalizeFields(null), []);
  assert.deepEqual(normalizeFields({}), []);
});

test("photoUrl resolves static-relative, absolute and empty photos", () => {
  assert.equal(photoUrl("imgs/a.jpeg", "/static/", "/static/fb.jpg"), "/static/imgs/a.jpeg");
  assert.equal(photoUrl("/media/a.jpg", "/static/", "fb"), "/media/a.jpg");
  assert.equal(photoUrl("https://cdn.x/a.jpg", "/static/", "fb"), "https://cdn.x/a.jpg");
  assert.equal(photoUrl("", "/static/", "fb"), "fb");
  assert.equal(photoUrl(null, "/static/", "fb"), "fb");
});

test("photoUrl rejects protocol-relative and backslash hosts", () => {
  assert.equal(photoUrl("//evil.com/x.jpg", "/static/", "fb"), "fb");
  assert.equal(photoUrl("/\\evil.com/x.jpg", "/static/", "fb"), "fb");
  assert.equal(photoUrl("\\\\evil.com/x.jpg", "/static/", "fb"), "fb");
});

test("todayISO uses Sao Paulo date", () => {
  // 02:00 UTC on Oct 21 is still Oct 20 in Sao Paulo (UTC-3)
  assert.equal(todayISO(new Date("2026-10-21T02:00:00Z")), "2026-10-20");
});

// ---------- loadFields with a fake DOM (mirrors templates/pages/index.html) ----------

function buildCampos() {
  installFakeDom();
  calls = [];
  const empty = h("template", { "data-state": "empty" });
  empty.content.append(h("div", { class: "state" }, h("h3", {}, "Nenhum campo aberto para reserva agora")));
  const error = h("template", { "data-state": "error" });
  error.content.append(
    h("div", { class: "state state--error" },
      h("h3", {}, "Não foi possível carregar os campos"),
      h("button", { type: "button", "data-retry": true }, "Tentar de novo")),
  );
  const root = h(
    "div",
    { id: "campos", "data-static-base": "/static/", "data-fallback-photo": "/static/fb.jpg" },
    h("ul", { "data-campos-skeleton": true }),
    h("p", { "data-campos-skeleton": true }, "Carregando campos…"),
    h("ul", { "data-campos-list": true, hidden: true }),
    h("div", { "data-campos-status": true, hidden: true }),
    empty,
    error,
  );
  globalThis.document.body.append(root);
  return root;
}

function respond(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "application/json" },
    json: async () => body,
  };
}

function parts(root) {
  return {
    list: root.querySelector("[data-campos-list]"),
    status: root.querySelector("[data-campos-status]"),
    skeletons: root.querySelectorAll("[data-campos-skeleton]"),
  };
}

let calls = [];

for (const [label, body] of [["[]", []], ["null", null], ["{}", {}], ["{fields: []}", { fields: [] }]]) {
  test(`loadFields with ${label} shows the empty state, no error`, async () => {
    globalThis.fetch = async (url) => {
      calls.push(url);
      return respond(200, body);
    };
    const root = buildCampos();
    await loadFields(root);
    const { list, status, skeletons } = parts(root);
    assert.deepEqual(calls, ["/api/fields"]);
    assert.equal(list.hidden, true);
    assert.equal(list.children.length, 0);
    assert.equal(status.hidden, false);
    assert.match(status.textContent, /Nenhum campo aberto/);
    assert.equal(status.querySelector("[data-retry]"), null);
    assert.ok([...skeletons].every((s) => s.hidden));
    assert.equal(root.hasAttribute("aria-busy"), false);
  });
}

for (const [label, body] of [
  ["plain list", [{ id: 1, name: "Campo 1", description: "Society", price_per_hour: "150.00", photo: "" }, { id: 2, name: "Campo 2", price_per_hour: "120.00", photo: "imgs/c2.jpg" }]],
  ["{fields: [...]}", { fields: [{ id: 1, name: "Campo 1", description: "Society", price_per_hour: "150.00", photo: "" }, { id: 2, name: "Campo 2", price_per_hour: "120.00", photo: "imgs/c2.jpg" }] }],
]) {
  test(`loadFields renders cards from a ${label}`, async () => {
    globalThis.fetch = async () => respond(200, body);
    const root = buildCampos();
    await loadFields(root);
    const { list, status } = parts(root);
    assert.equal(status.hidden, true);
    assert.equal(list.hidden, false);
    assert.equal(list.children.length, 2);
    assert.match(list.textContent, /Campo 1/);
    assert.match(list.textContent, /R\$ 150,00/);
    const links = list.querySelectorAll("a");
    assert.deepEqual([...links].map((a) => a.getAttribute("href")), ["/reservar/?field=1", "/reservar/?field=2"]);
    const imgs = list.querySelectorAll("img");
    assert.deepEqual([...imgs].map((i) => i.getAttribute("src")), ["/static/fb.jpg", "/static/imgs/c2.jpg"]);
  });
}

test("loadFields escapes field text (rendered as text, not HTML)", async () => {
  globalThis.fetch = async () => respond(200, [{ id: 3, name: "<img src=x onerror=alert(1)>", price_per_hour: "1" }]);
  const root = buildCampos();
  await loadFields(root);
  const { list } = parts(root);
  assert.equal(list.querySelectorAll("img").length, 1); // only the card photo
  assert.match(list.textContent, /<img src=x/);
});

test("loadFields shows the error state on failure and retry reloads", async () => {
  let fail = true;
  globalThis.fetch = async (url) => {
    calls.push(url);
    if (fail) throw new TypeError("Failed to fetch");
    return respond(200, [{ id: 7, name: "Campo 7", price_per_hour: "150" }]);
  };
  const root = buildCampos();
  await loadFields(root);
  let { list, status } = parts(root);
  assert.equal(list.hidden, true);
  assert.equal(status.hidden, false);
  assert.match(status.textContent, /Não foi possível carregar os campos/);
  const retry = status.querySelector("[data-retry]");
  assert.ok(retry, "retry button present");
  assert.equal(root.hasAttribute("aria-busy"), false);

  fail = false;
  retry.click();
  await new Promise((r) => setTimeout(r, 0));
  ({ list, status } = parts(root));
  assert.deepEqual(calls, ["/api/fields", "/api/fields"]);
  assert.equal(status.hidden, true);
  assert.equal(list.hidden, false);
  assert.match(list.textContent, /Campo 7/);
});

test("loadFields shows the error state on HTTP 500", async () => {
  globalThis.fetch = async () => ({ ok: false, status: 500, headers: { get: () => "text/html" }, json: async () => ({}) });
  const root = buildCampos();
  await loadFields(root);
  assert.match(parts(root).status.textContent, /Não foi possível carregar/);
});

// ---------- initMenu sets the .js class only when it runs ----------

test("initMenu adds the js class to <html> and toggles the menu", () => {
  const doc = installFakeDom();
  const toggle = h("button", { "data-menu-toggle": true, "aria-controls": "menu-principal", "aria-expanded": "false" });
  const menu = h("nav", { id: "menu-principal" });
  doc.body.append(toggle, menu);
  assert.equal(doc.documentElement.classList.contains("js"), false);
  initMenu();
  assert.equal(doc.documentElement.classList.contains("js"), true);
  toggle.click();
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.equal(doc.body.classList.contains("menu-open"), true);
  toggle.click();
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
});

test("initMenu without menu markup does not add the js class", () => {
  installFakeDom();
  initMenu();
  assert.equal(globalThis.document.documentElement.classList.contains("js"), false);
});

test("nextOpenDate skips the weekend (quick search never suggests a closed day)", () => {
  assert.equal(nextOpenDate("2026-10-18"), "2026-10-19"); // domingo -> segunda
  assert.equal(nextOpenDate("2026-10-17"), "2026-10-19"); // sábado -> segunda
  assert.equal(nextOpenDate("2026-10-21"), "2026-10-21"); // quarta fica
  assert.equal(nextOpenDate("2026-12-31"), "2026-12-31"); // quinta, virada de ano
  assert.equal(nextOpenDate("2027-01-02"), "2027-01-04");
});

function fakeVideo({ networkState = 1, play = () => Promise.resolve() } = {}) {
  const listeners = {};
  const source = { addEventListener: (t, fn) => (listeners[`source:${t}`] = fn) };
  return {
    listeners,
    networkState,
    error: null,
    paused: true,
    play,
    pause() {},
    querySelectorAll: () => [source],
    addEventListener: (t, fn) => (listeners[`video:${t}`] = fn),
  };
}
function fakeToggle() {
  const span = { textContent: "Pausar vídeo" };
  return { hidden: true, dataset: {}, querySelector: () => span, span, addEventListener() {} };
}

test("initHeroVideo hides the toggle when the video has no playable source", () => {
  const toggle = fakeToggle();
  initHeroVideo(fakeVideo({ networkState: 3 }), toggle);
  assert.equal(toggle.hidden, true);
});

test("initHeroVideo hides the toggle when the <source> errors later and keeps it hidden", async () => {
  const toggle = fakeToggle();
  let reject;
  const video = fakeVideo({ play: () => new Promise((_, r) => (reject = r)) });
  initHeroVideo(video, toggle);
  assert.equal(toggle.hidden, false);
  video.listeners["source:error"]();
  reject(new Error("no source"));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(toggle.hidden, true);
});

test("initHeroVideo labels the toggle Pausar once playback starts", async () => {
  const toggle = fakeToggle();
  initHeroVideo(fakeVideo(), toggle);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(toggle.hidden, false);
  assert.equal(toggle.span.textContent, "Pausar vídeo");
  assert.equal(toggle.dataset.state, "playing");
});
