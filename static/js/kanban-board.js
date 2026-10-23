// Kanban do painel (DOM): quatro colunas, arrastar e soltar (HTML5) e o menu "Mover para…"
// como alternativa por teclado/toque. Regras e textos vêm de kanban.js (puro).
// Contato e mensagem criptografados (tokens) e "Descriptografar" chegam prontos do painel
// (`contactBox`), com auditoria, sumiço automático e proteção contra resposta atrasada.
import {
  el,
  formatDayLong,
  formatTimeRange,
  formatDateTime,
  setBusy,
  stateBox,
  retryButton,
  statusBadge,
  inlineConfirm,
  showFieldErrors,
  clearFieldErrors,
} from "./ui.js";
import {
  COLUMNS,
  STATUS_LABEL,
  MOVE_COPY,
  allowedTargets,
  canDrag,
  canMove,
  groupByStatus,
  filterBookings,
  durationLabel,
  rangeError,
  conflictText,
} from "./kanban.js";

export const RANGE_DAYS = 30;
export const BUSY_TEXT = "Aguarde o pedido anterior terminar.";

/**
 * deps: {root, api, ApiError, contactBox(booking), hideAllContacts(), guard(err) -> bool,
 *        isDenied() -> bool, fields() -> [], fillFieldSelect(select, opts), today, addDays, toast}
 */
export function createKanban(deps) {
  const { root, api, ApiError, contactBox, hideAllContacts, guard, isDenied, fields, fillFieldSelect, today, addDays, toast, onLoaded } = deps;
  const $ = (sel) => root.querySelector(sel);
  const form = $("#filtros-kanban");
  const board = $("[data-kanban-board]");
  const status = $("[data-kanban-status]");
  const live = $("[data-kanban-live]");
  const control = (name) => form?.querySelector(`[name="${name}"]`);
  const val = (name) => control(name)?.value || "";
  const s = { bookings: [], req: 0, drag: null, moving: false, focusId: null, loaded: false };

  function announce(text) {
    if (!live) return;
    // Esvazia antes: o leitor de tela repete a mesma frase se ela voltar.
    live.textContent = "";
    live.textContent = text;
  }

  // ---------- cards ----------
  const cardOf = (id) => board.querySelector(`li[data-booking-id="${id}"]`);

  function setCardError(card, text) {
    const box = card?.querySelector("[data-card-error]");
    if (!box) return;
    box.textContent = text || "";
    box.hidden = !text;
  }

  function moveMenu(booking, card) {
    const id = booking.id;
    const menuId = `kanban-mover-${id}`;
    const trigger = el(
      "button",
      { type: "button", class: "btn btn--sm btn--ghost kcard__move", "data-action": "move", "aria-expanded": "false", "aria-controls": menuId },
      "Mover para…",
    );
    const options = allowedTargets(booking.status).map((target) =>
      el(
        "button",
        { type: "button", class: `kcard__option kcard__option--${target}`, "data-move-to": target },
        el("span", { class: "kcard__dot", "aria-hidden": "true" }),
        STATUS_LABEL[target],
      ),
    );
    const menu = el("div", { id: menuId, class: "kcard__menu", role: "group", "aria-label": `Mover o pedido #${id} para`, "data-move-menu": "", hidden: true }, ...options);
    const open = (on) => {
      menu.hidden = !on;
      trigger.setAttribute("aria-expanded", on ? "true" : "false");
      if (on) options[0]?.focus();
    };
    trigger.addEventListener("click", () => open(menu.hidden));
    for (const option of options) {
      option.addEventListener("click", () => {
        open(false);
        requestMove(booking, option.getAttribute("data-move-to"), card);
      });
    }
    menu.addEventListener("keydown", (event) => {
      const i = options.indexOf(globalThis.document.activeElement);
      if (event.key === "Escape") {
        event.preventDefault?.();
        open(false);
        trigger.focus();
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault?.();
        const step = event.key === "ArrowDown" ? 1 : -1;
        options[(i + step + options.length) % options.length]?.focus();
      }
    });
    return [trigger, menu];
  }

  function fillActions(actions, booking, card) {
    actions.replaceChildren(...(canDrag(booking.status) ? moveMenu(booking, card) : []));
  }

  function card(booking) {
    const id = booking.id;
    const draggable = canDrag(booking.status);
    const actions = el("div", { class: "kcard__actions", "data-card-actions": "" });
    const who = booking.user
      ? el("p", { class: "order__who" }, el("strong", { text: booking.user.name || "Cliente" }), el("span", { class: "kcard__email", text: booking.user.email || "sem e-mail" }))
      : null;
    const duration = durationLabel(booking.start, booking.end);
    const item = el(
      "li",
      {
        class: `order kcard${draggable ? " kcard--draggable" : ""}`,
        "data-booking-id": String(id),
        "data-booking-status": booking.status,
        draggable: draggable ? "true" : null,
        tabindex: "-1",
        role: "group",
        "aria-label": `Pedido #${id}, ${booking.field?.name || "Campo"}, ${formatDayLong(booking.start)}, ${formatTimeRange(booking.start, booking.end)}`,
      },
      el(
        "div",
        { class: "order__head" },
        el("h4", { class: "kcard__title" }, el("span", { class: "order__id", text: `#${id}` }), " ", booking.field?.name || "Campo"),
        statusBadge(booking.status, booking.status_label),
        booking.kind && booking.kind !== "avulsa" ? el("span", { class: "badge", text: booking.kind_label }) : null,
      ),
      el(
        "p",
        { class: "kcard__when" },
        el("strong", { text: formatTimeRange(booking.start, booking.end) }),
        duration ? el("span", { class: "kcard__duration", text: duration }) : null,
        el("span", { class: "kcard__day", text: formatDayLong(booking.start) }),
      ),
      who,
      contactBox(booking),
      el("p", { class: "order__meta", text: `Pedido em ${formatDateTime(booking.created_at)}` }),
      el("p", { class: "kcard__error", "data-card-error": "", role: "alert", hidden: true }),
      actions,
    );
    fillActions(actions, booking, item);
    if (draggable) bindDrag(item, booking);
    return item;
  }

  // ---------- mover ----------
  function rejectMove(booking, target, cardNode) {
    const text = `Não dá para mover o pedido #${booking.id} de ${STATUS_LABEL[booking.status] || booking.status} para ${STATUS_LABEL[target] || target}.`;
    setCardError(cardNode, text);
    announce(text);
  }

  /** Um pedido por vez: avisa em vez de ignorar em silêncio. */
  function busyNotice(cardNode) {
    setCardError(cardNode, BUSY_TEXT);
    announce(BUSY_TEXT);
  }

  /** Enquanto um pedido está em andamento, filtros e "Atualizar" ficam travados (quadro estável). */
  function lockFilters(on) {
    if (!form) return;
    form.setAttribute("aria-busy", on ? "true" : "false");
    for (const control of form.querySelectorAll("select, input, button")) {
      control.disabled = on;
      if (on) control.setAttribute("aria-disabled", "true");
      else control.removeAttribute("aria-disabled");
    }
  }

  function requestMove(booking, target, cardNode) {
    if (s.moving) return busyNotice(cardNode);
    if (!canMove(booking.status, target)) return rejectMove(booking, target, cardNode);
    const copy = MOVE_COPY[target];
    setCardError(cardNode, "");
    if (!copy.confirm) return move(booking, target, cardNode, cardNode.querySelector('[data-action="move"]'));
    const actions = cardNode.querySelector("[data-card-actions]");
    inlineConfirm(actions, {
      question: copy.question(booking.id),
      confirmLabel: copy.yes,
      cancelLabel: "Voltar",
      onConfirm: (yes) => move(booking, target, cardNode, yes),
      onCancel: () => {
        fillActions(actions, booking, cardNode);
        actions.querySelector('[data-action="move"]')?.focus();
      },
    });
  }

  async function move(booking, target, cardNode, button) {
    if (s.moving) return busyNotice(cardNode);
    s.moving = true;
    lockFilters(true);
    setBusy(button, true);
    cardNode.setAttribute("aria-busy", "true");
    cardNode.classList.add("is-moving");
    try {
      await api.post(`/api/admin/bookings/${encodeURIComponent(booking.id)}/status`, { status: target });
      const copy = MOVE_COPY[target];
      announce(`Pedido #${booking.id} ${copy.done}: agora em ${STATUS_LABEL[target]}.`);
      toast?.(`Pedido #${booking.id} ${copy.done}.`, "success");
      s.focusId = booking.id;
      s.moving = false;
      lockFilters(false);
      await load();
    } catch (err) {
      s.moving = false;
      lockFilters(false);
      if (guard(err)) return;
      // O card fica onde estava (nada foi movido na tela), com o motivo do servidor.
      // Se o quadro foi recriado durante a chamada, o aviso vai para o card que está na tela.
      const live = cardOf(booking.id);
      const target = live || cardNode;
      cardNode.removeAttribute("aria-busy");
      cardNode.classList.remove("is-moving");
      const actions = target.querySelector("[data-card-actions]");
      if (target === cardNode) fillActions(actions, booking, cardNode);
      const text =
        err instanceof ApiError
          ? err.status === 409
            ? conflictText(err.message, err.fields)
            : err.message
          : "Não foi possível mudar o status. Tente de novo.";
      setCardError(target, text);
      announce(`Pedido #${booking.id} não foi movido. ${text}`);
      actions?.querySelector('[data-action="move"]')?.focus();
    }
  }

  // ---------- arrastar e soltar ----------
  function columns() {
    return [...board.querySelectorAll("[data-column]")];
  }

  function endDrag() {
    s.drag?.card.classList.remove("is-dragged");
    s.drag = null;
    board.classList.remove("is-dragging");
    for (const col of columns()) {
      col.removeAttribute("data-drop");
      col.classList.remove("is-over");
    }
  }

  function bindDrag(item, booking) {
    item.addEventListener("dragstart", (event) => {
      if (s.moving) {
        event.preventDefault?.();
        return;
      }
      s.drag = { booking, card: item };
      try {
        event.dataTransfer?.setData("text/plain", String(booking.id));
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      } catch {
        /* alguns navegadores limitam dataTransfer: o estado em memória basta */
      }
      item.classList.add("is-dragged");
      board.classList.add("is-dragging");
      for (const col of columns()) {
        const to = col.getAttribute("data-column");
        col.setAttribute("data-drop", to === booking.status ? "source" : canMove(booking.status, to) ? "valid" : "invalid");
      }
      announce(`Arrastando o pedido #${booking.id}. Pode soltar em: ${allowedTargets(booking.status).map((t) => STATUS_LABEL[t]).join(", ")}.`);
    });
    // Soltou fora do quadro (ou cancelou com Esc): só limpa, sem aviso.
    item.addEventListener("dragend", () => endDrag());
  }

  function bindColumn(col) {
    const to = col.getAttribute("data-column");
    col.addEventListener("dragover", (event) => {
      if (!s.drag) return;
      // Toda coluna aceita o "drop": a inválida responde com o aviso (a coluna já aparece apagada).
      event.preventDefault?.();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      if (canMove(s.drag.booking.status, to)) col.classList.add("is-over");
    });
    col.addEventListener("dragleave", (event) => {
      if (event.relatedTarget?.closest?.("[data-column]") === col) return;
      col.classList.remove("is-over");
    });
    col.addEventListener("drop", (event) => {
      event.preventDefault?.();
      const drag = s.drag;
      endDrag();
      if (!drag || drag.booking.status === to) return;
      requestMove(drag.booking, to, drag.card); // inválida: requestMove mostra "Não dá para mover…"
    });
  }

  // ---------- quadro ----------
  function render() {
    hideAllContacts(); // os cards serão recriados: contatos abertos somem e os timers param
    if (isDenied()) return;
    const groups = groupByStatus(filterBookings(s.bookings, { query: val("q") }));
    const cols = COLUMNS.map((c) => {
      const list = groups[c.status];
      const titleId = `kanban-col-${c.status}`;
      const col = el(
        "section",
        { class: `kcol kcol--${c.status}`, "data-column": c.status, "aria-labelledby": titleId },
        el(
          "h3",
          { class: "kcol__head", id: titleId },
          el("span", { class: "kcol__label", text: c.label }),
          el("span", { class: "kcol__count", "data-count": "", text: String(list.length) }),
          el("span", { class: "visually-hidden", text: list.length === 1 ? " pedido" : " pedidos" }),
        ),
        el(
          "ul",
          { class: "kcol__list", "aria-labelledby": titleId },
          list.length ? list.map(card) : el("li", { class: "kcol__empty", text: val("q") ? "Nenhum pedido com essa busca." : c.empty }),
        ),
      );
      bindColumn(col);
      return col;
    });
    board.replaceChildren(...cols);
    board.hidden = false;
    if (s.focusId !== null) {
      const target = cardOf(s.focusId);
      s.focusId = null;
      (target?.querySelector('[data-action="move"]') || target)?.focus();
    }
  }

  function showStatus(node) {
    status.replaceChildren(node);
    status.hidden = false;
  }

  async function load() {
    if (isDenied() || !board || s.moving) return;
    if (!fields().length) {
      board.replaceChildren();
      if (form) form.hidden = true;
      showStatus(stateBox({ title: "Nenhum campo ativo", text: "Nenhum campo está liberado para reserva. Cadastre um campo ou ative um existente para usar o Kanban." }));
      return;
    }
    if (form) form.hidden = false;
    const from = val("date_from");
    const to = val("date_to");
    const problem = rangeError(from, to);
    if (problem) {
      showFieldErrors(form, { date_to: problem });
      return;
    }
    clearFieldErrors(form);
    const req = ++s.req;
    board.setAttribute("aria-busy", "true");
    if (!s.loaded) showStatus(el("p", { class: "muted kanban__loading", text: "Carregando pedidos…" }));
    try {
      const data = await api.get("/api/admin/bookings", { field: val("field"), date_from: from, date_to: to });
      if (req !== s.req) return;
      s.bookings = Array.isArray(data?.bookings) ? data.bookings : [];
      s.loaded = true;
      status.hidden = true;
      status.replaceChildren();
      render();
      onLoaded?.(); // indicadores do topo acompanham cada atualização do quadro
    } catch (err) {
      if (req !== s.req || guard(err)) return;
      board.replaceChildren();
      showStatus(
        stateBox({ title: "Não foi possível carregar o Kanban", text: err instanceof ApiError ? err.message : "Tente de novo.", tone: "error", action: retryButton(() => load()) }),
      );
    } finally {
      if (req === s.req) board.removeAttribute("aria-busy");
    }
  }

  function clear() {
    s.bookings = [];
    board?.replaceChildren();
    status?.replaceChildren();
  }

  function init() {
    fillFieldSelect(control("field"), { allowAll: true });
    const from = control("date_from");
    const to = control("date_to");
    if (from) from.value = today;
    if (to) to.value = addDays(today, RANGE_DAYS);
  }

  form?.addEventListener("change", (event) => {
    if (event.target?.getAttribute?.("name") === "q") return; // a busca filtra ao digitar
    load();
  });
  control("q")?.addEventListener("input", () => render());
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    load();
  });

  return { load, clear, init, render, state: s };
}
