import { test } from "node:test";
import assert from "node:assert/strict";

import { installFakeDom, h } from "./fake-dom.mjs";
import { mockFetch, flush } from "./fake-api.mjs";
import { ApiError } from "../api.js";
import {
  clampShift,
  alphabetRow,
  letterOf,
  visibleSteps,
  bestCandidate,
  errorMessage,
  debounce,
  stepsTable,
  initCryptoPage,
} from "../crypto-demo.js";

// ---------- puras ----------

test("clampShift keeps 1..25 and falls back to 3", () => {
  assert.equal(clampShift(3), 3);
  assert.equal(clampShift("7"), 7);
  assert.equal(clampShift(0), 1);
  assert.equal(clampShift(99), 25);
  assert.equal(clampShift("x"), 3);
  assert.equal(clampShift(undefined), 3);
});

test("alphabetRow maps A to D for shift 3 and wraps", () => {
  const row = alphabetRow(3);
  assert.equal(row.length, 26);
  assert.deepEqual(row[0], { plain: "A", cipher: "D" });
  assert.deepEqual(row[25], { plain: "Z", cipher: "C" });
  assert.equal(alphabetRow(13)[7].cipher, "U");
  assert.equal(letterOf(0), "A");
  assert.equal(letterOf(26), "");
  assert.equal(letterOf(null), "");
});

test("visibleSteps limits rows", () => {
  const steps = Array.from({ length: 45 }, (_, i) => ({ i }));
  assert.equal(visibleSteps(steps, 40).rows.length, 40);
  assert.equal(visibleSteps(steps, 40).hidden, 5);
  assert.deepEqual(visibleSteps(null), { rows: [], hidden: 0 });
});

test("bestCandidate picks the highest score", () => {
  assert.equal(bestCandidate([{ shift: 1, score: 2 }, { shift: 3, score: 9 }, { shift: 5, score: 4 }]).shift, 3);
  assert.equal(bestCandidate([]), null);
});

test("errorMessage is kind for throttle, network and csrf", () => {
  assert.match(errorMessage(new ApiError(429, "rate_limited", "x")), /Espere um minuto/);
  assert.match(errorMessage(new ApiError(0, "network", "x")), /Sem conexão/);
  assert.match(errorMessage(new ApiError(403, "csrf_failed", "x")), /Recarregue/);
  assert.equal(errorMessage(new ApiError(400, "invalid_key", "Chave ruim.")), "Chave ruim.");
  assert.match(errorMessage(new Error("boom")), /Tente de novo/);
});

test("debounce runs once after the last call and can be cancelled", () => {
  const timers = new Map();
  let id = 0;
  const sched = { setTimeout: (fn) => (timers.set(++id, fn), id), clearTimeout: (x) => timers.delete(x) };
  let runs = 0;
  const d = debounce(() => runs++, 400, sched);
  d();
  d();
  d();
  assert.equal(timers.size, 1);
  [...timers.values()][0]();
  assert.equal(runs, 1);
  d();
  d.cancel();
  assert.equal(timers.size, 1, "the fired one stays in the map in this fake, cancel removed the new one");
});

test("stepsTable renders text only, with the shift column", () => {
  installFakeDom();
  const [wrap] = stepsTable(
    [
      { char: "A", index: 0, shifted_index: 3, out: "D", is_letter: true },
      { char: "<", index: null, shifted_index: null, out: "<", is_letter: false },
    ],
    { cipher: "caesar", action: "encrypt", shift: 3 },
  );
  assert.equal(stepsTable([], { cipher: "caesar" }).length, 1, "no null placeholder when nothing is hidden");
  const rows = wrap.querySelectorAll("tr");
  assert.equal(rows.length, 3);
  assert.match(rows[1].textContent, /A0 \(A\)\+33 \(D\)D/);
  assert.match(rows[2].textContent, /não é letra/);
});

// ---------- página ----------

function buildPage() {
  installFakeDom();
  const tab = (key) => h("button", { type: "button", role: "tab", id: `aba-${key}`, "data-tab": key, "aria-controls": `cripto-${key}` }, key);
  const shift = h("input", { name: "shift", type: "range" });
  shift.value = "3";
  const classic = (id, extra) =>
    h("section", { id, role: "tabpanel" },
      h("form", {},
        (() => { const t = h("textarea", { name: "text" }); t.value = ""; return t; })(),
        h("span", { "data-counter": true }),
        ...extra,
        h("button", { type: "submit", "data-action": "encrypt" }, "Cifrar"),
        h("button", { type: "button", "data-action": "decrypt" }, "Decifrar"),
        h("button", { type: "button", "data-action": "bruteforce" }, "Quebrar"),
        h("p", { "data-status": true })),
      h("div", { "data-wheel": true }),
      h("div", { "data-alphabet-slot": true }),
      h("div", { "data-result-box": true, hidden: true }, h("p", { "data-result-label": true }), h("output", { "data-result": true }), h("span", { "data-copy-slot": true })),
      h("div", { "data-steps": true }),
      h("div", { "data-candidates": true }));
  const key = h("input", { name: "key" });
  key.value = "LEMON";
  const plain = h("textarea", { name: "text" });
  plain.value = "segredo";
  const token = h("textarea", { name: "token" });
  token.value = "";
  const root = h(
    "div",
    { id: "cripto" },
    h("div", { role: "tablist" }, tab("cesar"), tab("vigenere"), tab("fernet")),
    classic("cripto-cesar", [shift, h("button", { type: "button", "data-shift-dec": true }), h("button", { type: "button", "data-shift-inc": true }), h("p", { "data-shift-value": true })]),
    classic("cripto-vigenere", [key, h("p", { "data-key-error": true, hidden: true })]),
    h("section", { id: "cripto-fernet", role: "tabpanel" },
      h("form", {}, plain, h("span", { "data-counter": true }), h("button", { type: "submit", "data-action": "encrypt" }), token,
        h("button", { type: "button", "data-action": "decrypt" }), h("button", { type: "button", "data-action": "tamper" }), h("span", { "data-copy-slot": true }), h("p", { "data-status": true })),
      h("div", { "data-result-box": true, hidden: true }, h("output", { "data-result": true })),
      h("div", { "data-anatomy-slot": true })),
    h("div", { "data-my-data": true }),
  );
  globalThis.document.body.append(root);
  return root;
}

const ANATOMY = { total_bytes: 73, segments: [{ key: "version", label: "Versão", bytes: 1, hex: "80", char_start: 0, char_end: 1 }, { key: "ciphertext", label: "Texto cifrado", bytes: 16, hex_prefix: "aa", char_start: 1, char_end: 20 }] };

function fakeTimers() {
  const timers = new Map();
  let id = 0;
  return { timers, setTimeout: (fn, ms) => (timers.set(++id, { fn, ms }), id), clearTimeout: (x) => timers.delete(x), fire() { for (const [k, t] of [...timers]) { timers.delete(k); t.fn(); } } };
}

async function start(handler, user = null) {
  const root = buildPage();
  const calls = mockFetch(handler);
  const clock = fakeTimers();
  await initCryptoPage(root, { getUser: async () => user, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
  await flush();
  return { root, calls, clock, q: (s) => root.querySelector(s) };
}

function demoHandler(extra = {}) {
  return async (call) => {
    if (call.path === "/api/crypto/demo") {
      const b = call.body;
      const key = `${b.cipher}:${b.action}`;
      if (extra[key]) return extra[key](b);
      if (key === "caesar:encrypt") return [200, { result: "DWDTXH", steps: [{ char: "A", index: 0, shifted_index: 3, out: "D", is_letter: true }] }];
      if (key === "caesar:decrypt") return [200, { result: "ATAQUE", steps: [] }];
      if (key === "caesar:bruteforce") return [200, { result: "ATAQUE", best_shift: 3, candidates: Array.from({ length: 25 }, (_, i) => ({ shift: i + 1, text: i === 2 ? "ATAQUE" : `x${i}`, score: i === 2 ? 9 : 1 })) }];
      if (key === "vigenere:encrypt") return [200, { result: "LXFOPVEFRNHR", steps: [{ char: "A", index: 0, shifted_index: 11, out: "L", is_letter: true, key_char: "L", key_shift: 11 }] }];
      if (key === "fernet:encrypt") return [200, { result: "gAAAAAtokenoriginal", anatomy: ANATOMY }];
      if (key === "fernet:tamper") return [200, { result: "gAAAAAtokenXriginal", changed_at: 11, decrypt_ok: false, anatomy: ANATOMY }];
      if (key === "fernet:decrypt") {
        if (b.text === "gAAAAAtokenoriginal") return [200, { result: "segredo", anatomy: ANATOMY }];
        return [400, { error: { code: "decrypt_failed", message: "Não deu para decifrar: o HMAC não confere." } }];
      }
    }
    if (call.path === "/api/bookings") return [200, { bookings: [] }];
    throw new Error(`unexpected ${call.method} ${call.path}`);
  };
}

test("Cifra de César: encrypt sends text+shift and shows result, steps and wheel", async () => {
  const { q, calls } = await start(demoHandler());
  const cesar = q("#cripto-cesar");
  cesar.querySelector('[name="text"]').value = "ATAQUE";
  cesar.querySelector("form").dispatch("submit");
  await flush();
  const call = calls.find((c) => c.path === "/api/crypto/demo");
  assert.deepEqual(call.body, { cipher: "caesar", action: "encrypt", text: "ATAQUE", shift: 3 });
  assert.equal(cesar.querySelector("[data-result]").textContent, "DWDTXH");
  assert.equal(cesar.querySelector("[data-result-box]").hidden, false);
  assert.ok(cesar.querySelector("[data-steps-table]"));
  // regressão: a lista de nós não pode ter null (o navegador mostrava "null" na tela)
  assert.doesNotMatch(cesar.querySelector("[data-steps]").textContent, /null/);
  assert.ok(cesar.querySelector(".wheel"));
  assert.equal(cesar.querySelector(".wheel__ring--cipher").getAttribute("style"), "--turn:-3");
  assert.match(cesar.querySelector("[data-alphabet]").textContent, /NormalABCDEFGHIJKLMNOPQRSTUVWXYZCifradoDEFGHIJKLMNOPQRSTUVWXYZABC/);
});

test("César: stepper changes the shift and redraws the mapping", async () => {
  const { q } = await start(demoHandler());
  const cesar = q("#cripto-cesar");
  cesar.querySelector("[data-shift-inc]").click();
  assert.equal(cesar.querySelector('[name="shift"]').value, "4");
  assert.match(cesar.querySelector("[data-shift-value]").textContent, /A → E/);
  cesar.querySelector("[data-shift-dec]").click();
  cesar.querySelector("[data-shift-dec]").click();
  assert.equal(cesar.querySelector('[name="shift"]').value, "2");
});

test("César: typing is debounced into a single request", async () => {
  const { q, calls, clock } = await start(demoHandler());
  const cesar = q("#cripto-cesar");
  const text = cesar.querySelector('[name="text"]');
  for (const v of ["A", "AT", "ATA"]) {
    text.value = v;
    text.dispatch("input");
  }
  assert.equal(calls.filter((c) => c.path === "/api/crypto/demo").length, 0);
  clock.fire();
  await flush();
  const demo = calls.filter((c) => c.path === "/api/crypto/demo");
  assert.equal(demo.length, 1);
  assert.equal(demo[0].body.text, "ATA");
  assert.equal(cesar.querySelector("[data-counter]").textContent, "3/500");
});

test("César: brute force lists 25 candidates and highlights the best", async () => {
  const { q } = await start(demoHandler());
  const cesar = q("#cripto-cesar");
  cesar.querySelector('[name="text"]').value = "DWDTXH";
  cesar.querySelector('[data-action="bruteforce"]').click();
  await flush();
  const items = cesar.querySelectorAll(".brute__item");
  assert.equal(items.length, 25);
  const best = cesar.querySelector(".is-best");
  assert.equal(best.getAttribute("data-shift"), "3");
  assert.match(best.textContent, /ATAQUE/);
});

test("César: throttle error is shown kindly", async () => {
  const { q } = await start(demoHandler({ "caesar:encrypt": () => [429, { error: { code: "rate_limited", message: "x" } }] }));
  const cesar = q("#cripto-cesar");
  cesar.querySelector('[name="text"]').value = "ATAQUE";
  cesar.querySelector("form").dispatch("submit");
  await flush();
  assert.match(cesar.querySelector("[data-status]").textContent, /Espere um minuto/);
  assert.ok(cesar.querySelector("[data-status]").className.includes("demo__status--error"));
});

test("Vigenère sends the key and blocks an invalid key locally", async () => {
  const { q, calls } = await start(demoHandler());
  const vig = q("#cripto-vigenere");
  vig.querySelector('[name="text"]').value = "ATTACKATDAWN";
  vig.querySelector("form").dispatch("submit");
  await flush();
  assert.deepEqual(calls.find((c) => c.body?.cipher === "vigenere").body, { cipher: "vigenere", action: "encrypt", text: "ATTACKATDAWN", key: "LEMON" });
  assert.equal(vig.querySelector("[data-result]").textContent, "LXFOPVEFRNHR");
  assert.match(vig.querySelector("[data-steps]").textContent, /\+11 \(L\)/);
  vig.querySelector('[name="key"]').value = "lem on";
  const before = calls.length;
  vig.querySelector("form").dispatch("submit");
  await flush();
  assert.equal(calls.length, before, "no request with an invalid key");
  assert.equal(vig.querySelector("[data-key-error]").hidden, false);
});

test("Fernet: encrypt shows token + anatomy, decrypt works, tamper fails", async () => {
  const { q } = await start(demoHandler());
  const fer = q("#cripto-fernet");
  fer.querySelector("form").dispatch("submit");
  await flush();
  assert.equal(fer.querySelector('[name="token"]').value, "gAAAAAtokenoriginal");
  assert.ok(fer.querySelector("[data-anatomy]"));
  fer.querySelector('[data-action="decrypt"]').click();
  await flush();
  assert.equal(fer.querySelector("[data-result]").textContent, "segredo");
  fer.querySelector('[data-action="tamper"]').click();
  await flush();
  assert.equal(fer.querySelector('[name="token"]').value, "gAAAAAtokenXriginal");
  assert.match(fer.querySelector("[data-result]").textContent, /HMAC não confere/);
  assert.equal(fer.querySelector("[data-result-box]").getAttribute("data-state"), "fail");
  assert.match(fer.querySelector("[data-status]").textContent, /caractere 12/);
  fer.querySelector('[data-action="decrypt"]').click();
  await flush();
  assert.match(fer.querySelector("[data-status]").textContent, /HMAC não confere/);
  assert.match(fer.querySelector("[data-result]").textContent, /Token rejeitado/);
});

test("tabs switch with arrow keys", async () => {
  const { q } = await start(demoHandler());
  q("#aba-cesar").dispatch("keydown", { key: "ArrowRight" });
  assert.equal(q("#aba-vigenere").getAttribute("aria-selected"), "true");
  assert.equal(q("#cripto-vigenere").hidden, false);
  assert.equal(q("#cripto-cesar").hidden, true);
  q("#aba-vigenere").dispatch("keydown", { key: "End" });
  assert.equal(q("#aba-fernet").getAttribute("tabindex"), "0");
});

test("Seus dados: anon gets a login link, staff a painel link, client the tokens", async () => {
  let ctx = await start(demoHandler(), null);
  assert.match(ctx.q("[data-my-data]").textContent, /Entrar/);
  ctx = await start(demoHandler(), { is_staff: true });
  assert.equal(ctx.q("[data-my-data]").querySelector("a").getAttribute("href"), "/painel/#cripto");
  const booking = { id: 4, field: { name: "Campo 1" }, start: "2026-10-20T18:00:00-03:00", end: "2026-10-20T19:00:00-03:00", status: "pendente", status_label: "Pendente", contact_token: "gAAAAABcontato-token-bem-comprido-0123456789", message_token: null };
  ctx = await start(async (call) => (call.path === "/api/bookings" ? [200, { bookings: [booking] }] : [500, {}]), { is_staff: false });
  const mine = ctx.q("[data-my-data]");
  assert.match(mine.textContent, /Contato \(criptografado\)/);
  assert.match(mine.textContent, /gAAAAABcontato-token-bem-comprid…/);
});
