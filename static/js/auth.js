// Navegação por sessão, login e cadastro.
import { api, ApiError } from "./api.js";
import {
  $,
  el,
  setBusy,
  showFieldErrors,
  clearFieldErrors,
  formValues,
  initPasswordToggles,
  toast,
} from "./ui.js";

/** Só aceita caminho interno: começa com "/", não "//" nem "/\", sem espaços/controle. */
export function safeNext(value) {
  if (typeof value !== "string" || value === "") return "/";
  if (!value.startsWith("/")) return "/";
  if (value.startsWith("//") || value.startsWith("/\\")) return "/";
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\s\\]/.test(value)) return "/";
  return value;
}

export function navItems(user) {
  if (!user) {
    return [
      { label: "Entrar", href: "/entrar/" },
      { label: "Criar conta", href: "/cadastro/", primary: true },
    ];
  }
  // A equipe não faz reservas (o servidor responde 403 staff_cannot_book): só o painel.
  const items = user.is_staff
    ? [{ label: "Painel", href: "/painel/" }]
    : [{ label: "Minhas reservas", href: "/minhas-reservas/" }];
  items.push({ label: "Sair", action: "logout" });
  return items;
}

/** Botão de destaque do cabeçalho: cliente reserva, equipe bloqueia horário (mesma página). */
export function headerCta(user) {
  return user?.is_staff ? { label: "Bloquear horário", href: "/reservar/" } : { label: "Reservar", href: "/reservar/" };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateLogin({ email = "", password = "" } = {}) {
  const errors = {};
  if (!email.trim()) errors.email = "Informe seu e-mail.";
  else if (!EMAIL_RE.test(email.trim())) errors.email = "Informe um e-mail válido.";
  if (!password) errors.password = "Informe sua senha.";
  return errors;
}

export function validateRegister({ name = "", email = "", phone = "", password = "" } = {}) {
  const errors = {};
  if (!name.trim()) errors.name = "Informe seu nome.";
  if (!email.trim()) errors.email = "Informe seu e-mail.";
  else if (!EMAIL_RE.test(email.trim())) errors.email = "Informe um e-mail válido.";
  const digits = phone.replace(/\D/g, "");
  if (!digits) errors.phone = "Informe um telefone para contato.";
  else if (digits.length < 10 || digits.length > 13) errors.phone = "Informe o telefone com DDD.";
  if (!password) errors.password = "Crie uma senha.";
  else if (password.length < 8) errors.password = "A senha precisa ter pelo menos 8 caracteres.";
  return errors;
}

// ---------- DOM ----------

let currentUser;

/** Usuário da sessão (cacheado na página). `null` se anônimo ou se a API falhar. */
export async function getUser() {
  if (currentUser !== undefined) return currentUser;
  try {
    const data = await api.get("/api/auth/me");
    currentUser = data?.user || null;
  } catch {
    currentUser = null;
  }
  return currentUser;
}

async function logout(button) {
  setBusy(button, true);
  try {
    await api.post("/api/auth/logout");
    globalThis.location.assign("/");
  } catch (err) {
    setBusy(button, false);
    toast(err instanceof ApiError ? err.message : "Não foi possível sair. Tente de novo.", "error");
  }
}

export async function initAuthNav() {
  const slot = $("[data-auth-nav]");
  if (!slot) return;
  const user = await getUser();
  const here = globalThis.location.pathname;
  const children = navItems(user).map((item) => {
    if (item.action === "logout") {
      const button = el("button", { type: "button", class: "nav__link nav__link--button" }, item.label);
      button.addEventListener("click", () => logout(button));
      return button;
    }
    return el(
      "a",
      {
        href: item.href,
        class: item.primary ? "btn btn--ghost btn--sm" : "nav__link",
        "aria-current": here === item.href ? "page" : null,
      },
      item.label,
    );
  });
  const firstName = user ? String(user.name || "").trim().split(/\s+/)[0] : "";
  if (firstName) {
    children.unshift(el("span", { class: "nav__user", text: `Olá, ${firstName}` }));
  }
  slot.replaceChildren(...children);
  slot.dataset.state = user ? "user" : "anon";
  const cta = $(".header-cta");
  if (cta) {
    const { label, href } = headerCta(user);
    cta.textContent = label;
    cta.setAttribute("href", href);
  }
}

function nextParam() {
  return new URLSearchParams(globalThis.location.search).get("next");
}

/** Mantém o `next` nos links entre entrar e cadastro. */
function carryNext(form) {
  const next = safeNext(nextParam());
  if (next === "/") return;
  for (const link of form.closest("section, main").querySelectorAll("[data-keep-next]")) {
    const url = new URL(link.getAttribute("href"), globalThis.location.origin);
    url.searchParams.set("next", next);
    link.setAttribute("href", url.pathname + url.search);
  }
}

/**
 * Valida ao sair do campo? Não quando o foco vai para o botão de enviar:
 * mostrar/esconder a mensagem de erro nesse momento empurra o botão e o
 * clique cai fora dele (o envio "some"). O submit valida tudo de qualquer jeito.
 */
export function shouldValidateOnBlur(event, form, button) {
  const input = event && event.target;
  if (!input || !input.name || !form.dataset.touched) return false;
  if (button && event.relatedTarget === button) return false;
  return true;
}

function bindForm(form, { validate, endpoint, payload, success }) {
  initPasswordToggles(form);
  carryNext(form);
  const button = form.querySelector('button[type="submit"]');

  // Validação inline ao sair do campo, só depois da primeira tentativa ou se já preenchido.
  form.addEventListener("focusout", (event) => {
    if (!shouldValidateOnBlur(event, form, button)) return;
    const input = event.target;
    const errors = validate(formValues(form));
    const msg = form.querySelector(`#${input.id}-erro`);
    if (!msg) return;
    if (errors[input.name]) {
      input.setAttribute("aria-invalid", "true");
      msg.textContent = errors[input.name];
      msg.hidden = false;
    } else {
      input.removeAttribute("aria-invalid");
      msg.textContent = "";
      msg.hidden = true;
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    form.dataset.touched = "1";
    const values = formValues(form);
    const errors = validate(values);
    if (Object.keys(errors).length) {
      showFieldErrors(form, errors);
      return;
    }
    clearFieldErrors(form);
    setBusy(button, true);
    try {
      await api.post(endpoint, payload(values));
      toast(success, "success");
      globalThis.location.assign(safeNext(nextParam()));
    } catch (err) {
      setBusy(button, false);
      if (err instanceof ApiError) {
        const hasFields = err.fields && Object.keys(err.fields).length;
        showFieldErrors(form, err.fields || {}, hasFields ? "" : err.message);
      } else {
        showFieldErrors(form, {}, "Não foi possível concluir. Tente de novo.");
      }
    }
  });
}

export async function initLoginForm() {
  const form = $("#form-entrar");
  if (!form) return;
  bindForm(form, {
    validate: validateLogin,
    endpoint: "/api/auth/login",
    payload: (v) => ({ email: v.email.trim(), password: v.password }),
    success: "Bem-vindo de volta!",
  });
  const user = await getUser();
  if (user) globalThis.location.replace(safeNext(nextParam()));
}

export async function initRegisterForm() {
  const form = $("#form-cadastro");
  if (!form) return;
  bindForm(form, {
    validate: validateRegister,
    endpoint: "/api/auth/register",
    payload: (v) => ({
      name: v.name.trim(),
      email: v.email.trim(),
      phone: v.phone.trim(),
      password: v.password,
    }),
    success: "Conta criada. Bom jogo!",
  });
  const user = await getUser();
  if (user) globalThis.location.replace(safeNext(nextParam()));
}
