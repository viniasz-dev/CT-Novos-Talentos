import { test } from "node:test";
import assert from "node:assert/strict";

import { safeNext, navItems, headerCta, validateLogin, validateRegister, shouldValidateOnBlur } from "../auth.js";

test("safeNext keeps internal paths", () => {
  assert.equal(safeNext("/reservar/?date=2026-10-20"), "/reservar/?date=2026-10-20");
  assert.equal(safeNext("/minhas-reservas/"), "/minhas-reservas/");
});

test("safeNext rejects external, protocol and empty values", () => {
  for (const bad of [
    "//evil.com",
    "https://evil.com",
    "javascript:alert(1)",
    "/\\evil.com",
    "\\\\evil.com",
    " /reservar/",
    "/re\nservar",
    "",
    null,
    undefined,
    "reservar/",
  ]) {
    assert.equal(safeNext(bad), "/", `value: ${JSON.stringify(bad)}`);
  }
});

test("navItems for anonymous user", () => {
  assert.deepEqual(
    navItems(null).map((i) => i.label),
    ["Entrar", "Criar conta"],
  );
  assert.equal(navItems(null)[0].href, "/entrar/");
  assert.equal(navItems(null)[1].href, "/cadastro/");
});

test("navItems for customer and staff", () => {
  assert.deepEqual(
    navItems({ name: "Ana", is_staff: false }).map((i) => i.label),
    ["Minhas reservas", "Sair"],
  );
  const staff = navItems({ name: "Bia", is_staff: true });
  // equipe não reserva: sem "Minhas reservas"
  assert.deepEqual(staff.map((i) => i.label), ["Painel", "Sair"]);
  assert.equal(staff[0].href, "/painel/");
  assert.equal(staff[1].action, "logout");
});

test("headerCta: clients reserve, staff block a slot on the same page", () => {
  assert.deepEqual(headerCta(null), { label: "Reservar", href: "/reservar/" });
  assert.deepEqual(headerCta({ is_staff: false }), { label: "Reservar", href: "/reservar/" });
  assert.deepEqual(headerCta({ is_staff: true }), { label: "Bloquear horário", href: "/reservar/" });
});

test("validateLogin reports missing and invalid fields in pt-BR", () => {
  assert.deepEqual(validateLogin({ email: "", password: "" }), {
    email: "Informe seu e-mail.",
    password: "Informe sua senha.",
  });
  assert.deepEqual(validateLogin({ email: "nao-e-email", password: "x" }), {
    email: "Informe um e-mail válido.",
  });
  assert.deepEqual(validateLogin({ email: "a@b.com", password: "x" }), {});
});

test("validateRegister checks every field", () => {
  const errors = validateRegister({ name: " ", email: "a@b", phone: "", password: "123" });
  assert.deepEqual(Object.keys(errors).sort(), ["email", "name", "password", "phone"]);
  assert.deepEqual(
    validateRegister({ name: "Ana", email: "ana@x.com", phone: "(19) 99999-0000", password: "senhaforte123" }),
    {},
  );
});

test("shouldValidateOnBlur skips when focus moves to the submit button (no layout shift under the click)", () => {
  const button = { tag: "button" };
  const input = { name: "password" };
  const touched = { dataset: { touched: "1" } };
  assert.equal(shouldValidateOnBlur({ target: input, relatedTarget: button }, touched, button), false);
  assert.equal(shouldValidateOnBlur({ target: input, relatedTarget: null }, touched, button), true);
  assert.equal(shouldValidateOnBlur({ target: input, relatedTarget: null }, { dataset: {} }, button), false);
  assert.equal(shouldValidateOnBlur({ target: { name: "" }, relatedTarget: null }, touched, button), false);
});
