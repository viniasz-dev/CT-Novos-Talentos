import { test } from "node:test";
import assert from "node:assert/strict";

import { installFakeDom } from "./fake-dom.mjs";
import { flush } from "./fake-api.mjs";
import { truncateToken, copyText, tokenView, bookingTokens, anatomyView, anatomySegments, bytesLabel } from "../cipher-view.js";

const TOKEN = "gAAAAABpQ7xYz-CONTATO-TOKEN-0123456789abcdefghijklmnopqrstuvwxyz_ABCDEFG==";

test("truncateToken keeps the first 32 chars plus an ellipsis", () => {
  assert.equal(truncateToken(TOKEN), `${TOKEN.slice(0, 32)}…`);
  assert.equal(truncateToken("curto"), "curto");
  assert.equal(truncateToken(null), "");
  assert.equal(truncateToken(TOKEN, 5), "gAAAA…");
});

test("copyText uses navigator.clipboard and falls back to execCommand", async () => {
  const doc = installFakeDom();
  const written = [];
  assert.equal(await copyText("abc", { clipboard: { writeText: async (t) => written.push(t) } }), true);
  assert.deepEqual(written, ["abc"]);
  doc.execCommand = (cmd) => cmd === "copy";
  assert.equal(await copyText("x", { clipboard: { writeText: async () => { throw new Error("denied"); } }, document: doc }), true);
  assert.equal(doc.body.querySelectorAll("textarea").length, 0, "temporary textarea removed");
  delete doc.execCommand;
  assert.equal(await copyText("x", { clipboard: null, document: doc }), false);
});

test("tokenView shows the truncated token as text and expands/collapses", () => {
  installFakeDom();
  const view = tokenView({ label: "Contato (criptografado)", token: TOKEN });
  const value = view.querySelector("[data-token-value]");
  const toggle = view.querySelector('button[data-action="expand-token"]');
  assert.match(view.textContent, /🔒 Contato \(criptografado\)/);
  assert.equal(value.textContent, truncateToken(TOKEN));
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(toggle.getAttribute("aria-controls"), value.getAttribute("id"));
  toggle.click();
  assert.equal(value.textContent, TOKEN);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.equal(toggle.textContent, "Recolher");
  toggle.click();
  assert.equal(value.textContent, truncateToken(TOKEN));
  assert.equal(view.getAttribute("data-expanded"), "false");
});

test("tokenView copy button copies the full token and toasts", async () => {
  installFakeDom();
  const written = [];
  const view = tokenView({ label: "Contato", token: TOKEN, env: { clipboard: { writeText: async (t) => written.push(t) } } });
  view.querySelector('button[data-action="copy-token"]').click();
  await flush();
  assert.deepEqual(written, [TOKEN]);
  assert.match(globalThis.document.getElementById("toasts").textContent, /Token copiado/);
});

test("tokenView without a token shows the empty text and no buttons", () => {
  installFakeDom();
  const view = tokenView({ label: "Mensagem (criptografada)", token: null, empty: "Sem mensagem." });
  assert.match(view.textContent, /Sem mensagem\./);
  assert.equal(view.querySelectorAll("button").length, 0);
});

test("tokenView never interprets markup", () => {
  installFakeDom();
  const view = tokenView({ label: "Contato", token: "<img src=x onerror=alert(1)>" });
  assert.equal(view.querySelectorAll("img").length, 0);
  assert.match(view.textContent, /<img/);
});

test("bookingTokens builds contact and message views; compact flag", () => {
  installFakeDom();
  const [c, m] = bookingTokens({ contact_token: TOKEN, message_token: null }, { compact: true });
  assert.ok(c.classList.contains("ctoken--compact"));
  assert.match(c.textContent, /Contato \(criptografado\)/);
  assert.match(m.textContent, /Mensagem \(criptografada\)Sem mensagem\./);
});

const ANATOMY = {
  total_bytes: 73,
  segments: [
    { key: "version", label: "Versão", bytes: 1, hex: "80", char_start: 0, char_end: 1 },
    { key: "timestamp", label: "Timestamp", bytes: 8, hex: "0000000069000000", value: 1761000000, iso: "2025-10-20T19:40:00-03:00", char_start: 1, char_end: 12 },
    { key: "iv", label: "IV", bytes: 16, hex: "00".repeat(16), char_start: 12, char_end: 33 },
    { key: "ciphertext", label: "Texto cifrado", bytes: 16, hex_prefix: "abcdef0123456789", char_start: 33, char_end: 54 },
    { key: "hmac", label: "HMAC-SHA256", bytes: 32, hex_prefix: "0011223344556677", char_start: 54, char_end: 98 },
    { key: "<script>", label: "x", bytes: 1 },
  ],
};

test("anatomySegments ignores unknown keys", () => {
  assert.deepEqual(anatomySegments(ANATOMY).map((s) => s.key), ["version", "timestamp", "iv", "ciphertext", "hmac"]);
  assert.deepEqual(anatomySegments(null), []);
  assert.equal(bytesLabel(1), "1 byte");
  assert.equal(bytesLabel(32), "32 bytes");
});

test("anatomyView colors each token slice and lists sizes", () => {
  installFakeDom();
  const token = "g".repeat(98) + "==";
  const fig = anatomyView(ANATOMY, token);
  const parts = fig.querySelectorAll(".anatomy__part");
  assert.equal(parts.length, 6, "5 segments + padding");
  assert.equal(parts[0].textContent, "g");
  assert.ok(parts[3].classList.contains("anatomy--ciphertext"));
  assert.equal(parts[5].textContent, "==");
  const legend = fig.querySelectorAll(".anatomy__item");
  assert.equal(legend.length, 5);
  assert.match(fig.textContent, /HMAC-SHA256 32 bytes/);
  assert.match(fig.textContent, /0x80/);
  assert.match(fig.textContent, /73 bytes antes do base64/);
  assert.equal(fig.querySelectorAll(".anatomy__cell").length, 5);
});
