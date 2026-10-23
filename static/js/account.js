// Minhas reservas: lista do cliente, filtro por status e cancelamento com confirmação inline.
import { api, ApiError } from "./api.js";
import {
  el,
  formatDayLong,
  formatTimeRange,
  formatDateTime,
  setBusy,
  toast,
  showTemplateState,
  statusBadge,
  inlineConfirm,
  prefersReducedMotion,
} from "./ui.js";
import { bookingTokens } from "./cipher-view.js";

export const STATUSES = ["pendente", "aprovado", "recusado", "cancelado"];

const STATUS_NOTE = {
  pendente: "Aguardando a confirmação da equipe.",
  aprovado: "Horário confirmado pela equipe.",
  recusado: "A equipe não pôde aceitar este pedido.",
  cancelado: "Pedido cancelado.",
};

const LOGIN_URL = `/entrar/?next=${encodeURIComponent("/minhas-reservas/")}`;

export function filterBookings(list, status) {
  const items = Array.isArray(list) ? list : [];
  return status ? items.filter((b) => b.status === status) : [...items];
}

export function countByStatus(list) {
  const counts = { "": 0 };
  for (const s of STATUSES) counts[s] = 0;
  for (const b of Array.isArray(list) ? list : []) {
    counts[""] += 1;
    if (b.status in counts) counts[b.status] += 1;
  }
  return counts;
}

/** Contato e mensagem como ficam guardados (tokens Fernet) + "Descriptografar" (rota auditada, some em 30 s). */
export function protectedBox(booking) {
  const box = el("div", { class: "booking-card__crypto", "data-protected": "" });
  function showMasked() {
    const reveal = el("button", { type: "button", class: "btn btn--sm btn--ghost", "data-action": "decrypt" }, "Descriptografar");
    reveal.addEventListener("click", () => revealContact(reveal));
    box.replaceChildren(
      ...bookingTokens(booking),
      reveal,
    );
  }
  async function revealContact(reveal) {
    setBusy(reveal, true);
    let data;
    try {
      data = await api.get(`/api/bookings/${encodeURIComponent(booking.id)}/contact`);
    } catch (err) {
      setBusy(reveal, false);
      toast(err instanceof ApiError ? err.message : "Não foi possível descriptografar. Tente de novo.", "error");
      return;
    }
    const hideButton = el("button", { type: "button", class: "link-button", "data-action": "hide-contact" }, "Ocultar");
    const timer = setTimeout(showMasked, 30000);
    hideButton.addEventListener("click", () => {
      clearTimeout(timer);
      showMasked();
    });
    box.replaceChildren(
      el("p", { class: "ctoken__label", text: "🔓 Contato (decifrado)" }),
      el("p", { text: data?.contact || "Não informado." }),
      el("p", { class: "ctoken__label", text: "🔓 Mensagem (decifrada)" }),
      el("p", { text: data?.message || "Sem mensagem." }),
      hideButton,
    );
  }
  showMasked();
  return box;
}

export function canCancelNow(booking, now = new Date()) {
  const start = new Date(booking?.start).getTime();
  return Boolean(booking?.can_cancel) && Number.isFinite(start) && start > now.getTime();
}

export async function initAccount(root = globalThis.document.getElementById("minhas-reservas"), opts = {}) {
  if (!root) return;
  const location = opts.location || globalThis.location;
  const nowFn = () => opts.now || new Date();
  const list = root.querySelector("#lista-reservas");
  const status = root.querySelector("[data-list-status]");
  const skeletons = root.querySelectorAll("[data-list-skeleton]");
  const filter = root.querySelector("#filtro-status");
  const highlight = new URLSearchParams(location.search || "").get("novo");
  const s = { bookings: [], scrolled: false };

  for (const option of filter?.querySelectorAll("option") || []) {
    if (!option.getAttribute("data-label")) option.setAttribute("data-label", option.textContent);
  }

  function updateCounts() {
    const counts = countByStatus(s.bookings);
    for (const option of filter?.querySelectorAll("option") || []) {
      const value = option.getAttribute("value") || "";
      option.textContent = `${option.getAttribute("data-label")} (${counts[value] ?? 0})`;
    }
  }

  function item(booking) {
    const actions = el("div", { class: "booking-card__actions", "data-actions": "" });
    if (canCancelNow(booking, nowFn())) {
      const cancel = el("button", { type: "button", class: "btn btn--sm btn--ghost", "data-action": "cancel" }, "Cancelar pedido");
      cancel.addEventListener("click", () => askCancel(booking, actions));
      actions.append(cancel);
    }
    const titleId = `reserva-${booking.id}-titulo`;
    const li = el(
      "li",
      {
        class: `booking-card${String(booking.id) === highlight ? " is-new" : ""}`,
        "data-booking-id": String(booking.id),
        "data-booking-status": booking.status,
        "aria-labelledby": titleId,
      },
      el(
        "div",
        { class: "booking-card__head" },
        el("h3", { id: titleId, class: "booking-card__field", tabindex: "-1", text: booking.field?.name || "Campo" }),
        statusBadge(booking.status, booking.status_label),
        booking.kind && booking.kind !== "avulsa" ? el("span", { class: "badge", text: booking.kind_label }) : null,
      ),
      el(
        "p",
        { class: "booking-card__when" },
        el("strong", { text: formatTimeRange(booking.start, booking.end) }),
        el("span", { text: formatDayLong(booking.start) }),
      ),
      el("p", { class: "booking-card__note muted", text: STATUS_NOTE[booking.status] || "" }),
      protectedBox(booking),
      booking.created_at ? el("p", { class: "booking-card__meta", text: `Pedido feito em ${formatDateTime(booking.created_at)}` }) : null,
      actions.childNodes.length ? actions : null,
    );
    return li;
  }

  function askCancel(booking, actions) {
    inlineConfirm(actions, {
      question: "Cancelar este pedido?",
      confirmLabel: "Sim, cancelar",
      cancelLabel: "Manter pedido",
      confirmAction: "confirm-cancel",
      cancelAction: "keep",
      onConfirm: async (yes) => {
        setBusy(yes, true);
        try {
          const data = await api.post(`/api/bookings/${encodeURIComponent(booking.id)}/cancel`);
          const updated = data?.booking;
          if (updated) s.bookings = s.bookings.map((b) => (b.id === updated.id ? updated : b));
          render();
          toast("Pedido cancelado.", "success");
          list.querySelector(`li[data-booking-id="${booking.id}"]`)?.querySelector("h3")?.focus?.();
        } catch (err) {
          if (err instanceof ApiError && err.status === 401) {
            location.assign(LOGIN_URL);
            return;
          }
          toast(err instanceof ApiError ? err.message : "Não foi possível cancelar. Tente de novo.", "error");
          await load();
        }
      },
    });
  }

  function render() {
    updateCounts();
    const chosen = filter?.value || "";
    const visible = filterBookings(s.bookings, chosen);
    status.hidden = true;
    if (!s.bookings.length || !visible.length) {
      list.replaceChildren();
      list.hidden = true;
      showTemplateState(root, status, s.bookings.length ? "filtered" : "empty");
      return;
    }
    list.replaceChildren(...visible.map(item));
    list.hidden = false;
    if (highlight && !s.scrolled) {
      s.scrolled = true;
      list.querySelector(`li[data-booking-id="${highlight}"]`)?.scrollIntoView?.({
        behavior: prefersReducedMotion() ? "auto" : "smooth",
        block: "center",
      });
    }
  }

  async function load() {
    skeletons.forEach((n) => (n.hidden = false));
    status.hidden = true;
    root.setAttribute("aria-busy", "true");
    try {
      const data = await api.get("/api/bookings");
      s.bookings = Array.isArray(data?.bookings) ? data.bookings : [];
      render();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        location.assign(LOGIN_URL);
        return;
      }
      list.replaceChildren();
      list.hidden = true;
      showTemplateState(root, status, "error");
      status.querySelector("[data-retry]")?.addEventListener("click", () => load(), { once: true });
    } finally {
      skeletons.forEach((n) => (n.hidden = true));
      root.removeAttribute("aria-busy");
    }
  }

  filter?.addEventListener("change", render);
  await load();
}
