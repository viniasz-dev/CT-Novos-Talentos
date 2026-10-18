// Utilidades de interface: toasts, estados de botão, erros de campo, formatação.
// Nenhuma função acessa o DOM no carregamento do módulo (testável no Node).

export function $(selector, root) {
  return (root || globalThis.document).querySelector(selector);
}

export function $$(selector, root) {
  return Array.from((root || globalThis.document).querySelectorAll(selector));
}

/** Cria um elemento: el("a", {href: "/", class: "btn"}, "Texto", outroNo). Texto vira textContent. */
export function el(tag, attrs = {}, ...children) {
  const node = globalThis.document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === "string" ? globalThis.document.createTextNode(child) : child);
  }
  return node;
}

// ---------- formatação ----------

export function formatPrice(value) {
  if (value === null || value === undefined || value === "") return "";
  const number = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  if (!Number.isFinite(number)) return "";
  const negative = number < 0;
  const [int, cents] = Math.abs(number).toFixed(2).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative ? "-" : ""}R$ ${grouped},${cents}`;
}

const DATE_TIME = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function formatDateTime(iso) {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return "";
  const p = Object.fromEntries(DATE_TIME.formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year} às ${p.hour}:${p.minute}`;
}

const TIME = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "18:00" no horário de São Paulo. */
export function formatTime(iso) {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return "";
  const p = Object.fromEntries(TIME.formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.hour}:${p.minute}`;
}

export function formatTimeRange(start, end) {
  const a = formatTime(start);
  const b = formatTime(end);
  return a && b ? `${a} às ${b}` : a || b;
}

const DAY_LONG = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  weekday: "long",
  day: "numeric",
  month: "long",
});

/** "terça-feira, 20 de outubro" a partir de YYYY-MM-DD (dia civil) ou de um ISO com hora. */
export function formatDayLong(value) {
  if (typeof value !== "string" || !value) return "";
  // Dia civil puro: meio-dia em São Paulo nunca muda de data.
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00-03:00` : value;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return DAY_LONG.format(date);
}

/** Conta caracteres como o servidor (code points), não unidades UTF-16. */
export function charCount(text) {
  return [...String(text ?? "")].length;
}

export function buildWhatsAppUrl(phone, { nome = "", assunto = "", mensagem = "" } = {}) {
  const lines = [];
  if (nome.trim()) lines.push(`Olá! Meu nome é ${nome.trim()}.`);
  if (assunto.trim()) lines.push(`Assunto: ${assunto.trim()}`);
  if (mensagem.trim()) lines.push(mensagem.trim());
  return `https://wa.me/${phone}?text=${encodeURIComponent(lines.join("\n"))}`;
}

// ---------- toasts ----------

function toastRegion() {
  let region = globalThis.document.getElementById("toasts");
  if (!region) {
    region = el("div", { id: "toasts", class: "toasts" });
    globalThis.document.body.append(region);
  }
  return region;
}

export function toast(message, type = "info") {
  const item = el(
    "div",
    { class: `toast toast--${type}`, role: type === "error" ? "alert" : null },
    el("p", { text: message }),
  );
  const close = el("button", { type: "button", class: "toast__close", "aria-label": "Fechar aviso" }, "×");
  const remove = () => item.remove();
  close.addEventListener("click", remove);
  item.append(close);
  toastRegion().append(item);
  scheduleToast(remove, type === "error" ? 8000 : 5000);
  return item;
}

const defaultToastScheduler = (fn, ms) => globalThis.setTimeout(fn, ms);
let scheduleToast = defaultToastScheduler;

/** Troca o agendador que some com os toasts (testes); sem argumento volta ao setTimeout. */
export function setToastScheduler(fn) {
  scheduleToast = typeof fn === "function" ? fn : defaultToastScheduler;
}

// ---------- estados e confirmação inline ----------

/** Mostra o conteúdo de `<template data-state="kind">` (dentro de `root`) em `target`. */
export function showTemplateState(root, target, kind) {
  const tpl = root.querySelector(`template[data-state="${kind}"]`);
  target.replaceChildren(tpl ? tpl.content.cloneNode(true) : "");
  target.hidden = false;
  return target;
}

/** Bloco de estado montado por código (título, texto e ação opcional). */
export function stateBox({ title, text = "", tone = "", action = null }) {
  return el(
    "div",
    { class: tone ? `state state--${tone}` : "state" },
    el("h3", { text: title }),
    text ? el("p", { class: "muted", text }) : null,
    action,
  );
}

export function retryButton(onClick) {
  return el("button", { type: "button", class: "btn btn--sm btn--ghost", "data-retry": "", onclick: onClick }, "Tentar de novo");
}

/** Selo de status do pedido; o texto vem da API (`status_label`). */
export function statusBadge(status, label) {
  return el("span", { class: `status status--${status}`, "data-status": status }, label || status);
}

/**
 * Troca `container` por uma pergunta com dois botões (sem confirm()).
 * `onConfirm` é chamado no "sim"; `onCancel` restaura o conteúdo anterior.
 */
export function inlineConfirm(container, { question, confirmLabel, cancelLabel = "Voltar", confirmAction = "confirm", cancelAction = "keep", onConfirm, onCancel }) {
  const previous = [...container.childNodes];
  const keep = el("button", { type: "button", class: "btn btn--sm btn--ghost", "data-action": cancelAction }, cancelLabel);
  const yes = el("button", { type: "button", class: "btn btn--sm btn--danger", "data-action": confirmAction }, confirmLabel);
  const box = el("div", { class: "confirm", role: "group", "aria-label": question }, el("p", { class: "confirm__q", text: question }), el("div", { class: "confirm__actions" }, yes, keep));
  const restore = () => {
    container.replaceChildren(...previous);
    onCancel?.();
  };
  keep.addEventListener("click", restore);
  box.addEventListener("keydown", (event) => {
    if (event.key === "Escape") restore();
  });
  yes.addEventListener("click", () => onConfirm?.(yes));
  container.replaceChildren(box);
  keep.focus();
  return { restore, yes, keep };
}

// ---------- botões e formulários ----------

export function setBusy(button, busy) {
  if (!button) return;
  button.disabled = Boolean(busy);
  button.classList.toggle("is-busy", Boolean(busy));
  if (busy) button.setAttribute("aria-busy", "true");
  else button.removeAttribute("aria-busy");
}

function formErrorBox(form) {
  return form.querySelector("[data-form-error]");
}

export function clearFieldErrors(form) {
  if (!form) return;
  for (const input of form.querySelectorAll("[aria-invalid]")) input.removeAttribute("aria-invalid");
  for (const msg of form.querySelectorAll(".field__error")) {
    msg.textContent = "";
    msg.hidden = true;
  }
  const box = formErrorBox(form);
  if (box) {
    box.textContent = "";
    box.hidden = true;
  }
}

/** Mostra mensagens por campo (`{email: "..."}`); nomes sem campo vão para a caixa geral. */
export function showFieldErrors(form, fields = {}, fallback = "") {
  clearFieldErrors(form);
  const leftovers = [];
  let first = null;
  for (const [name, message] of Object.entries(fields || {})) {
    const input = form.querySelector(`[name="${CSS.escape(name)}"]`);
    if (!input) {
      leftovers.push(message);
      continue;
    }
    input.setAttribute("aria-invalid", "true");
    const msg = form.querySelector(`#${CSS.escape(input.id)}-erro`);
    if (msg) {
      msg.textContent = Array.isArray(message) ? message.join(" ") : String(message);
      msg.hidden = false;
    } else {
      leftovers.push(message);
    }
    first = first || input;
  }
  if (fallback) leftovers.unshift(fallback);
  const box = formErrorBox(form);
  if (box && leftovers.length) {
    box.textContent = leftovers.join(" ");
    box.hidden = false;
  }
  if (first) first.focus();
  else if (box && leftovers.length) box.focus();
}

export function formValues(form) {
  const values = {};
  for (const [key, value] of new FormData(form).entries()) values[key] = typeof value === "string" ? value : "";
  return values;
}

export function initPasswordToggles(root) {
  for (const button of $$("[data-toggle-password]", root)) {
    const input = globalThis.document.getElementById(button.getAttribute("aria-controls"));
    if (!input) continue;
    button.hidden = false;
    const label = button.querySelector("[data-label]") || button;
    button.addEventListener("click", () => {
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      label.textContent = show ? "Ocultar" : "Mostrar";
    });
  }
}

// ---------- navegação ----------

export function initMenu() {
  const toggle = $("[data-menu-toggle]");
  const menu = toggle && globalThis.document.getElementById(toggle.getAttribute("aria-controls"));
  if (!menu) return;
  // Só aqui o menu mobile passa a ser painel escondido (.js .nav). Se o módulo
  // não carregar, a classe nunca entra e o menu fica visível em fluxo normal.
  globalThis.document.documentElement.classList.add("js");
  const set = (open) => {
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Fechar menu" : "Abrir menu");
    globalThis.document.body.classList.toggle("menu-open", open);
  };
  toggle.addEventListener("click", () => set(toggle.getAttribute("aria-expanded") !== "true"));
  globalThis.document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
      set(false);
      toggle.focus();
    }
  });
  menu.addEventListener("click", (event) => {
    if (event.target.closest("a")) set(false);
  });
  globalThis.matchMedia?.("(min-width: 60em)").addEventListener?.("change", (e) => e.matches && set(false));
}

export function prefersReducedMotion() {
  return Boolean(globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}
