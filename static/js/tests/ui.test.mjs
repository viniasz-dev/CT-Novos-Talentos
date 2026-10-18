import { test } from "node:test";
import assert from "node:assert/strict";

import { formatPrice, formatDateTime, buildWhatsAppUrl, formatTime, formatTimeRange, formatDayLong, charCount } from "../ui.js";

test("formatPrice formats BRL with plain spaces", () => {
  assert.equal(formatPrice(150), "R$ 150,00");
  assert.equal(formatPrice("150.00"), "R$ 150,00");
  assert.equal(formatPrice(1234.5), "R$ 1.234,50");
  assert.equal(formatPrice(0), "R$ 0,00");
  assert.equal(formatPrice(30), "R$ 30,00");
});

test("formatPrice returns empty string for invalid input", () => {
  assert.equal(formatPrice("abc"), "");
  assert.equal(formatPrice(null), "");
});

test("formatDateTime shows Sao Paulo local date and time", () => {
  assert.equal(formatDateTime("2026-10-20T19:00:00-03:00"), "20/10/2026 às 19:00");
  // UTC input is converted to America/Sao_Paulo
  assert.equal(formatDateTime("2026-10-20T22:30:00Z"), "20/10/2026 às 19:30");
  assert.equal(formatDateTime("lixo"), "");
});

test("buildWhatsAppUrl composes an encoded wa.me message", () => {
  const url = buildWhatsAppUrl("5519999117711", {
    nome: "João",
    assunto: "Aluguel de quadra",
    mensagem: "Quero jogar às 20h ⚽",
  });
  assert.ok(url.startsWith("https://wa.me/5519999117711?text="));
  const text = decodeURIComponent(url.split("?text=")[1]);
  assert.ok(text.includes("João"));
  assert.ok(text.includes("Aluguel de quadra"));
  assert.ok(text.includes("Quero jogar às 20h ⚽"));
});

test("buildWhatsAppUrl skips empty parts", () => {
  const url = buildWhatsAppUrl("5519999117711", { nome: "  ", assunto: "", mensagem: "Oi" });
  const text = decodeURIComponent(url.split("?text=")[1]);
  assert.equal(text, "Oi");
});

test("formatTime and formatTimeRange use Sao Paulo hours", () => {
  assert.equal(formatTime("2026-10-20T18:00:00-03:00"), "18:00");
  assert.equal(formatTime("2026-10-20T22:00:00Z"), "19:00");
  assert.equal(formatTime("lixo"), "");
  assert.equal(formatTimeRange("2026-10-20T18:00:00-03:00", "2026-10-20T20:00:00-03:00"), "18:00 às 20:00");
});

test("formatDayLong names weekday, day and month in pt-BR", () => {
  assert.equal(formatDayLong("2026-10-20"), "terça-feira, 20 de outubro");
  assert.equal(formatDayLong("2026-10-20T23:30:00-03:00"), "terça-feira, 20 de outubro");
  assert.equal(formatDayLong("lixo"), "");
});

test("charCount counts code points like the server", () => {
  assert.equal(charCount("abc"), 3);
  assert.equal(charCount("🎉ã"), 2);
  assert.equal(charCount(""), 0);
});

test("toast removal goes through the injectable scheduler", async () => {
  const { installFakeDom } = await import("./fake-dom.mjs");
  const { toast, setToastScheduler } = await import("../ui.js");
  installFakeDom();
  const scheduled = [];
  setToastScheduler((fn, ms) => scheduled.push({ fn, ms }));
  const item = toast("Erro de teste", "error");
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].ms, 8000);
  assert.ok(globalThis.document.getElementById("toasts").querySelector("div"));
  scheduled[0].fn();
  assert.equal(item.parentNode, null);
  toast("Ok", "success");
  assert.equal(scheduled[1].ms, 5000);
  setToastScheduler(() => {});
});