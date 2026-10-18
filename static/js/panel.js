// Painel da equipe: Kanban, Pedidos, Bloqueios e Agenda do dia.
// Só staff vê o conteúdo. Qualquer 401/403 da API troca a tela por "acesso negado" e limpa os dados.
import { api, ApiError } from "./api.js";
import { getUser as sessionUser } from "./auth.js";
import {
  el,
  formatDayLong,
  formatTimeRange,
  formatTime,
  formatDateTime,
  charCount,
  setBusy,
  toast,
  showFieldErrors,
  clearFieldErrors,
  stateBox,
  retryButton,
  statusBadge,
  inlineConfirm,
} from "./ui.js";
import { todayISO, normalizeFields } from "./home.js";
import { isoFromParts } from "./calendar.js";
import { createKanban } from "./kanban-board.js";
import { anatomyView, bookingTokens, truncateToken } from "./cipher-view.js";
import { createKpis } from "./kpis.js";

export const REASON_MAX = 200;
/** Tempo que o contato decifrado fica visível antes de voltar a ser mascarado. */
export const REVEAL_SECONDS = 30;
/** Quantos pedidos (mais novos) a aba Criptografia mostra. */
export const CRYPTO_RECENT = 12;

// ---------- funções puras ----------

export function accessState(user) {
  if (!user) return "anon";
  return user.is_staff ? "staff" : "denied";
}

const ACTIONS = {
  aprovado: { status: "aprovado", label: "Aprovar", done: "aprovado", confirm: false },
  recusado: { status: "recusado", label: "Recusar", done: "recusado", confirm: true, question: "Recusar este pedido?", yes: "Sim, recusar" },
  cancelado: { status: "cancelado", label: "Cancelar", done: "cancelado", confirm: true, question: "Cancelar este pedido?", yes: "Sim, cancelar" },
};

/** Ações permitidas: pendente -> aprovado|recusado|cancelado; aprovado -> cancelado. */
export function actionsFor(status) {
  if (status === "pendente") return [ACTIONS.aprovado, ACTIONS.recusado, ACTIONS.cancelado];
  if (status === "aprovado") return [ACTIONS.cancelado];
  return [];
}

export function nextTabIndex(current, key, count) {
  if (key === "ArrowRight") return (current + 1) % count;
  if (key === "ArrowLeft") return (current - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

/** Aba inicial: a do hash (#cripto) se existir, senão a primeira. */
export function initialTab(tabs, location) {
  const keys = Array.from(tabs || [], (t) => t.getAttribute("data-tab"));
  const wanted = String(location?.hash || "").replace(/^#/, "");
  return keys.includes(wanted) ? wanted : keys[0] || "pedidos";
}

export function addDays(iso, delta) {
  const [y, m, d] = iso.split("-").map(Number);
  return isoFromParts(y, m - 1, d + delta);
}

const AGENDA_LABEL = { free: "Livre", booked: "Reservado", blocked: "Bloqueado", past: "Encerrado", closed: "Fechado" };

const NO_FIELDS = {
  title: "Nenhum campo ativo",
  text: "Nenhum campo está liberado para reserva. Cadastre um campo ou ative um existente para usar esta aba.",
};

// ---------- página ----------

export async function initPanel(root = globalThis.document.getElementById("painel"), opts = {}) {
  if (!root) return;
  const getUser = opts.getUser || sessionUser;
  const nowFn = () => opts.now || new Date();
  const today = todayISO(nowFn());
  const $ = (sel) => root.querySelector(sel);

  const checking = $("[data-panel-checking]");
  const denied = $("[data-panel-denied]");
  const shell = $("[data-panel-shell]");
  const tabs = $("#painel-abas").querySelectorAll('button[role="tab"]');
  const orders = { form: $("#filtros-pedidos"), list: $("[data-orders-list]"), status: $("[data-orders-status]") };
  const blocks = { form: $("#form-bloqueio"), list: $("[data-blocks-list]"), status: $("[data-blocks-status]") };
  const agenda = { form: $("#filtros-agenda"), list: $("[data-agenda-list]"), status: $("[data-agenda-status]"), title: $("[data-agenda-title]") };
  const cipherTab = { list: $("[data-crypto-list]"), status: $("[data-crypto-status]") };
  const s = { denied: false, fields: [], orders: [], tab: "", orderReq: 0, agendaReq: 0, slotReq: 0, revealGen: 0, cryptoReq: 0, cipherReq: 0 };
  const schedule = opts.setTimeout || ((fn, ms) => globalThis.setTimeout(fn, ms));
  const unschedule = opts.clearTimeout || ((id) => globalThis.clearTimeout(id));
  /** Contatos revelados no momento: cada item sabe se esconder (e cancelar seu timer). */
  const revealed = new Set();

  const control = (form, name) => form.querySelector(`[name="${name}"]`);
  const val = (form, name) => control(form, name)?.value || "";

  function hideAllContacts() {
    s.revealGen += 1; // invalida revelações ainda em andamento
    for (const hide of [...revealed]) hide();
  }

  globalThis.document?.addEventListener?.("visibilitychange", () => {
    if (globalThis.document.visibilityState === "hidden") hideAllContacts();
  });

  // ---------- acesso ----------
  function deny(kind) {
    hideAllContacts();
    s.denied = true;
    for (const node of [orders.list, orders.status, blocks.list, blocks.status, agenda.list, agenda.status]) node?.replaceChildren();
    kanban?.clear();
    kpis?.clear();
    cipherTab.list?.replaceChildren();
    cipherTab.status?.replaceChildren();
    shell.hidden = true;
    if (checking) checking.hidden = true;
    const title = $("[data-denied-title]");
    const text = $("[data-denied-text]");
    const link = $("[data-denied-link]");
    if (title) title.textContent = "Acesso restrito";
    if (kind === "anon") {
      text.textContent = "Entre com uma conta da equipe para ver o painel.";
      link.setAttribute("href", `/entrar/?next=${encodeURIComponent("/painel/")}`);
      link.textContent = "Entrar";
    } else {
      text.textContent = "Esta área é só para a equipe do CT Novos Talentos.";
      link.setAttribute("href", "/");
      link.textContent = "Voltar para a home";
    }
    denied.hidden = false;
  }

  /** Trata 401/403; devolve true quando a tela virou "acesso negado". */
  function guard(err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      deny(err.status === 401 ? "anon" : "denied");
      return true;
    }
    return false;
  }

  const fail = (err, fallback) => {
    if (guard(err)) return;
    toast(err instanceof ApiError ? err.message : fallback, "error");
  };

  // ---------- abas ----------
  function activate(key, { focus = false } = {}) {
    hideAllContacts();
    s.tab = key;
    tabs.forEach((tab) => {
      const on = tab.getAttribute("data-tab") === key;
      tab.setAttribute("aria-selected", on ? "true" : "false");
      tab.setAttribute("tabindex", on ? "0" : "-1");
      const panel = globalThis.document.getElementById(tab.getAttribute("aria-controls")) || $(`#${tab.getAttribute("aria-controls")}`);
      if (panel) panel.hidden = !on;
      if (on && focus) tab.focus();
    });
    if (key === "kanban") return kanban?.load();
    if (key === "pedidos") return loadOrders();
    if (key === "bloqueios") return Promise.all([loadBlockSlots(), loadBlocks()]);
    if (key === "cripto") return loadCrypto();
    return loadAgenda();
  }

  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => activate(tab.getAttribute("data-tab")));
    tab.addEventListener("keydown", (event) => {
      const next = nextTabIndex(i, event.key, tabs.length);
      if (next === null) return;
      event.preventDefault?.();
      activate(tabs[next].getAttribute("data-tab"), { focus: true });
    });
  });

  // ---------- campos nos filtros ----------
  function fillFieldSelect(select, { allowAll }) {
    if (!select) return;
    const options = s.fields.map((f) => el("option", { value: String(f.id) }, f.name || `Campo ${f.id}`));
    if (allowAll) options.unshift(el("option", { value: "" }, "Todos os campos"));
    select.replaceChildren(...options);
    select.value = allowAll ? "" : s.fields[0] ? String(s.fields[0].id) : "";
  }

  // ---------- contato criptografado (Pedidos, Kanban e Criptografia) ----------
  /**
   * Mostra os tokens Fernet guardados (contato e mensagem) + "Descriptografar"
   * (rota auditada). Revelado: "antes → depois", com "Ocultar" e sumiço automático.
   */
  function contactBox(booking, { compact = false } = {}) {
    const id = booking.id;
    const box = el("div", { class: `order__contact${compact ? " order__contact--compact" : ""}` });

    // Estado protegido: só os tokens da API (inúteis sem a chave) e o botão de decifrar.
    function showMasked() {
      const reveal = el(
        "button",
        { type: "button", class: "btn btn--sm btn--ghost order__decrypt", "data-action": "contact" },
        "Descriptografar",
      );
      reveal.addEventListener("click", () => revealContact(reveal));
      box.replaceChildren(...bookingTokens(booking, { compact }), reveal);
      return reveal;
    }

    function pair(label, token, plain, empty) {
      return [
        el("dt", { text: label }),
        el(
          "dd",
          { class: "order__pair" },
          el("code", { class: "order__before", translate: "no", text: token ? truncateToken(token, 20) : "—" }),
          el("span", { class: "order__arrow", "aria-hidden": "true", text: "→" }),
          el("span", { class: "visually-hidden", text: " decifrado: " }),
          el("span", { class: "order__after", text: plain || empty }),
        ),
      ];
    }

    async function revealContact(reveal) {
      setBusy(reveal, true);
      const generation = s.revealGen;
      let data;
      try {
        data = await api.get(`/api/admin/bookings/${encodeURIComponent(id)}/contact`);
      } catch (err) {
        setBusy(reveal, false);
        fail(err, "Não foi possível mostrar o contato.");
        return;
      }
      // Trocou de aba, saiu da página ou perdeu acesso durante a chamada: não mostra.
      if (s.denied || generation !== s.revealGen) {
        setBusy(reveal, false);
        return;
      }
      const hideButton = el("button", { type: "button", class: "link-button", "data-action": "hide-contact" }, "Ocultar");
      let timer = null;
      const hide = () => {
        revealed.delete(hide);
        if (timer !== null) unschedule(timer);
        timer = null;
        // Substitui os nós revelados: o contato decifrado sai do DOM.
        const again = showMasked();
        if (globalThis.document.activeElement === hideButton) again.focus();
      };
      hideButton.addEventListener("click", hide);
      box.replaceChildren(
        el("p", { class: "order__revealed-title", text: "Antes (criptografado) → depois (decifrado)" }),
        el(
          "dl",
          { class: "order__revealed" },
          ...pair("Contato", booking.contact_token, data?.contact, "—"),
          ...pair("Mensagem", booking.message_token, data?.message, "Sem mensagem."),
        ),
        el("p", { class: "order__audit", text: `Este acesso fica registrado na auditoria. O contato some em ${REVEAL_SECONDS} segundos.` }),
        hideButton,
      );
      revealed.add(hide);
      timer = schedule(hide, REVEAL_SECONDS * 1000);
    }

    showMasked();
    return box;
  }

  // ---------- pedidos ----------
  function orderItem(booking) {
    const id = booking.id;
    const actions = el("div", { class: "order__actions" });
    for (const action of actionsFor(booking.status)) {
      const button = el(
        "button",
        {
          type: "button",
          class: action.status === "aprovado" ? "btn btn--sm" : "btn btn--sm btn--ghost",
          "data-status-to": action.status,
        },
        action.label,
      );
      button.addEventListener("click", () => {
        if (!action.confirm) return changeStatus(booking, action, button);
        inlineConfirm(actions, {
          question: action.question,
          confirmLabel: action.yes,
          cancelLabel: "Voltar",
          onConfirm: (yes) => changeStatus(booking, action, yes),
        });
      });
      actions.append(button);
    }

    const who = booking.user ? `${booking.user.name || "Cliente"} (${booking.user.email || "sem e-mail"})` : "";
    return el(
      "li",
      { class: "order", "data-booking-id": String(id), "data-booking-status": booking.status },
      el(
        "div",
        { class: "order__head" },
        el("h3", { class: "order__title" }, el("span", { class: "order__id", text: `#${id}` }), " ", booking.field?.name || "Campo"),
        statusBadge(booking.status, booking.status_label),
      ),
      el("p", { class: "order__when" }, el("strong", { text: formatTimeRange(booking.start, booking.end) }), " ", formatDayLong(booking.start)),
      who ? el("p", { class: "order__who", text: who }) : null,
      contactBox(booking),
      booking.decided_by ? el("p", { class: "order__meta", text: `Decidido por ${booking.decided_by.name || booking.decided_by.email}` }) : null,
      el("p", { class: "order__meta", text: `Pedido em ${formatDateTime(booking.created_at)}` }),
      actions.childNodes.length ? actions : null,
    );
  }

  async function changeStatus(booking, action, button) {
    setBusy(button, true);
    try {
      const data = await api.post(`/api/admin/bookings/${encodeURIComponent(booking.id)}/status`, { status: action.status });
      const updated = data?.booking;
      if (updated) s.orders = s.orders.map((b) => (b.id === updated.id ? updated : b));
      renderOrders();
      toast(`Pedido #${booking.id} ${action.done}.`, "success");
    } catch (err) {
      if (guard(err)) return;
      toast(err instanceof ApiError ? err.message : "Não foi possível mudar o status.", "error");
      await loadOrders();
    }
  }

  function renderOrders() {
    hideAllContacts(); // os cards serão recriados: cancela timers e limpa contatos abertos
    if (s.denied) return;
    if (!s.orders.length) {
      orders.list.replaceChildren();
      const pending = val(orders.form, "status") === "pendente";
      orders.status.replaceChildren(
        stateBox({
          title: pending ? "Nenhum pedido pendente" : "Nenhum pedido encontrado",
          text: pending ? "Quando um cliente pedir um horário, ele aparece aqui." : "Ajuste os filtros para ver outros pedidos.",
        }),
      );
      orders.status.hidden = false;
      return;
    }
    orders.status.hidden = true;
    orders.list.replaceChildren(...s.orders.map(orderItem));
  }

  async function loadOrders() {
    if (s.denied) return;
    const req = ++s.orderReq;
    orders.list.setAttribute("aria-busy", "true");
    try {
      const data = await api.get("/api/admin/bookings", {
        status: val(orders.form, "status"),
        field: val(orders.form, "field"),
        date: val(orders.form, "date"),
      });
      if (req !== s.orderReq) return;
      s.orders = Array.isArray(data?.bookings) ? data.bookings : [];
      renderOrders();
    } catch (err) {
      if (req !== s.orderReq || guard(err)) return;
      orders.list.replaceChildren();
      orders.status.replaceChildren(
        stateBox({ title: "Não foi possível carregar os pedidos", text: err.message, tone: "error", action: retryButton(() => loadOrders()) }),
      );
      orders.status.hidden = false;
    } finally {
      orders.list.removeAttribute("aria-busy");
    }
  }

  orders.form.addEventListener("change", () => loadOrders());
  orders.form.addEventListener("submit", (event) => {
    event.preventDefault();
    loadOrders();
  });

  // ---------- indicadores (acima do Kanban) ----------
  const kpiRoot = $("[data-kpis]");
  const kpis = kpiRoot
    ? createKpis({ root: kpiRoot, api, ApiError, guard, field: () => $("#kanban-campo")?.value || "" })
    : null;

  // ---------- kanban ----------
  const kanbanRoot = $("#painel-kanban");
  const kanban = kanbanRoot
    ? createKanban({
        root: kanbanRoot,
        api,
        ApiError,
        contactBox: (booking) => contactBox(booking, { compact: true }),
        onLoaded: () => kpis?.load(),
        hideAllContacts,
        guard,
        isDenied: () => s.denied,
        fields: () => s.fields,
        fillFieldSelect,
        today,
        addDays,
        toast,
      })
    : null;

  // ---------- bloqueios ----------
  const blockHint = blocks.form.querySelector("[data-block-hint]");
  const reasonCounter = blocks.form.querySelector("[data-reason-counter]");

  function noFields(section) {
    section.form.hidden = true;
    section.list?.replaceChildren();
    section.status.replaceChildren(stateBox(NO_FIELDS));
    section.status.hidden = false;
  }

  async function loadBlockSlots() {
    if (s.denied) return;
    if (!s.fields.length) return noFields(blocks);
    const start = control(blocks.form, "start");
    const end = control(blocks.form, "end");
    const field = val(blocks.form, "field");
    const date = val(blocks.form, "date");
    start.replaceChildren();
    end.replaceChildren();
    if (!field || !date) return;
    const req = ++s.slotReq;
    try {
      const data = await api.get("/api/availability", { field, date });
      if (req !== s.slotReq) return;
      const slots = (Array.isArray(data?.slots) ? data.slots : []).filter((x) => x.state !== "past");
      const note = (x) => (x.state === "booked" ? " (reservado)" : x.state === "blocked" ? " (já bloqueado)" : "");
      start.replaceChildren(...slots.map((x) => el("option", { value: x.start }, `${formatTime(x.start)}${note(x)}`)));
      end.replaceChildren(...slots.map((x) => el("option", { value: x.end }, formatTime(x.end))));
      start.value = slots[0]?.start || "";
      end.value = slots[0]?.end || "";
      if (blockHint) {
        blockHint.textContent = slots.length ? "" : "Sem horários de funcionamento futuros neste dia.";
        blockHint.hidden = Boolean(slots.length);
      }
    } catch (err) {
      if (req === s.slotReq) fail(err, "Não foi possível carregar os horários do dia.");
    }
  }

  function blockItem(block) {
    const actions = el("div", { class: "order__actions" });
    const remove = el("button", { type: "button", class: "btn btn--sm btn--ghost", "data-action": "delete" }, "Remover");
    remove.addEventListener("click", () =>
      inlineConfirm(actions, {
        question: "Remover este bloqueio?",
        confirmLabel: "Sim, remover",
        cancelLabel: "Voltar",
        onConfirm: async (yes) => {
          setBusy(yes, true);
          try {
            await api.del(`/api/admin/blocks/${encodeURIComponent(block.id)}`);
            toast("Bloqueio removido.", "success");
            await Promise.all([loadBlocks(), loadBlockSlots()]);
          } catch (err) {
            fail(err, "Não foi possível remover o bloqueio.");
            await loadBlocks();
          }
        },
      }),
    );
    actions.append(remove);
    return el(
      "li",
      { class: "order order--block", "data-block-id": String(block.id) },
      el("p", { class: "order__when" }, el("strong", { text: formatTimeRange(block.start, block.end) }), " ", formatDayLong(block.start)),
      el("p", { class: "order__who", text: block.reason || "Sem motivo informado" }),
      actions,
    );
  }

  async function loadBlocks() {
    if (s.denied) return;
    if (!s.fields.length) return noFields(blocks);
    blocks.form.hidden = false;
    try {
      const data = await api.get("/api/admin/blocks", { field: val(blocks.form, "field") });
      const now = nowFn().getTime();
      const items = (Array.isArray(data?.blocks) ? data.blocks : [])
        .filter((b) => new Date(b.end).getTime() > now)
        .sort((a, b) => new Date(a.start) - new Date(b.start));
      if (!items.length) {
        blocks.list.replaceChildren();
        blocks.status.replaceChildren(stateBox({ title: "Nenhum bloqueio ativo", text: "Bloqueios atuais e futuros deste campo aparecem aqui." }));
        blocks.status.hidden = false;
        return;
      }
      blocks.status.hidden = true;
      blocks.list.replaceChildren(...items.map(blockItem));
    } catch (err) {
      if (guard(err)) return;
      blocks.list.replaceChildren();
      blocks.status.replaceChildren(
        stateBox({ title: "Não foi possível carregar os bloqueios", text: err.message, tone: "error", action: retryButton(() => loadBlocks()) }),
      );
      blocks.status.hidden = false;
    }
  }

  control(blocks.form, "field")?.addEventListener("change", () => Promise.all([loadBlockSlots(), loadBlocks()]));
  control(blocks.form, "date")?.addEventListener("change", () => loadBlockSlots());
  control(blocks.form, "reason")?.addEventListener("input", () => {
    if (reasonCounter) reasonCounter.textContent = `${charCount(val(blocks.form, "reason"))}/${REASON_MAX}`;
  });

  blocks.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = blocks.form.querySelector('button[type="submit"]');
    if (submit?.disabled) return;
    const start = val(blocks.form, "start");
    const end = val(blocks.form, "end");
    const reason = val(blocks.form, "reason").trim();
    if (!start || !end) {
      showFieldErrors(blocks.form, {}, "Escolha um dia com horários para bloquear.");
      return;
    }
    if (new Date(end).getTime() <= new Date(start).getTime()) {
      showFieldErrors(blocks.form, {}, "O fim do bloqueio deve ser depois do início.");
      return;
    }
    if (charCount(reason) > REASON_MAX) {
      showFieldErrors(blocks.form, { reason: `O motivo deve ter no máximo ${REASON_MAX} caracteres.` });
      return;
    }
    clearFieldErrors(blocks.form);
    setBusy(submit, true);
    try {
      await api.post("/api/admin/blocks", { field: Number(val(blocks.form, "field")), start, end, reason });
      toast("Bloqueio criado.", "success");
      const input = control(blocks.form, "reason");
      if (input) input.value = "";
      if (reasonCounter) reasonCounter.textContent = `0/${REASON_MAX}`;
      await Promise.all([loadBlocks(), loadBlockSlots()]);
    } catch (err) {
      if (guard(err)) return;
      let message = err instanceof ApiError ? err.message : "Não foi possível criar o bloqueio.";
      const ids = err instanceof ApiError && Array.isArray(err.fields?.conflicts) ? err.fields.conflicts : [];
      if (ids.length) message += ` Conflita com pedidos ${ids.map((id) => `#${id}`).join(", ")}.`;
      showFieldErrors(blocks.form, {}, message);
    } finally {
      setBusy(submit, false);
    }
  });

  // ---------- agenda ----------
  function agendaRow(slot) {
    let detail = "";
    if (slot.booking) detail = `Reserva #${slot.booking.id}`;
    else if (slot.block) detail = slot.block.reason ? `Bloqueio: ${slot.block.reason}` : "Bloqueio sem motivo";
    return el(
      "li",
      { class: "agenda__row", "data-state": slot.state },
      el("span", { class: "agenda__time", text: formatTimeRange(slot.start, slot.end) }),
      el("span", { class: "agenda__state", text: AGENDA_LABEL[slot.state] || slot.state }),
      el("span", { class: "agenda__detail", text: detail }),
    );
  }

  async function loadAgenda() {
    if (s.denied) return;
    if (!s.fields.length) return noFields(agenda);
    const field = val(agenda.form, "field");
    const date = val(agenda.form, "date") || today;
    if (agenda.title) agenda.title.textContent = formatDayLong(date);
    const req = ++s.agendaReq;
    agenda.list.setAttribute("aria-busy", "true");
    try {
      const data = await api.get("/api/admin/agenda", { field, date });
      if (req !== s.agendaReq) return;
      const slots = Array.isArray(data?.slots) ? data.slots : [];
      if (!data?.open || !slots.length) {
        agenda.list.replaceChildren();
        agenda.status.replaceChildren(stateBox({ title: "Fechado neste dia", text: "Não há horários de funcionamento nesta data." }));
        agenda.status.hidden = false;
        return;
      }
      agenda.status.hidden = true;
      agenda.list.replaceChildren(...slots.map(agendaRow));
    } catch (err) {
      if (req !== s.agendaReq || guard(err)) return;
      agenda.list.replaceChildren();
      agenda.status.replaceChildren(
        stateBox({ title: "Não foi possível carregar a agenda", text: err.message, tone: "error", action: retryButton(() => loadAgenda()) }),
      );
      agenda.status.hidden = false;
    } finally {
      agenda.list.removeAttribute("aria-busy");
    }
  }

  const shiftAgenda = (delta) => {
    const input = control(agenda.form, "date");
    input.value = addDays(input.value || today, delta);
    loadAgenda();
  };
  agenda.form.addEventListener("change", () => loadAgenda());
  agenda.form.addEventListener("submit", (event) => {
    event.preventDefault();
    loadAgenda();
  });
  $("[data-day-prev]")?.addEventListener("click", () => shiftAgenda(-1));
  $("[data-day-next]")?.addEventListener("click", () => shiftAgenda(1));

  // ---------- criptografia (tokens crus, anatomia e decifrar auditado) ----------
  async function showAnatomy(booking, button, target) {
    const open = button.getAttribute("aria-expanded") === "true";
    if (open) {
      button.setAttribute("aria-expanded", "false");
      button.textContent = "Ver anatomia do token";
      target.replaceChildren();
      target.hidden = true;
      return;
    }
    const req = ++s.cipherReq;
    setBusy(button, true);
    try {
      const data = await api.get(`/api/admin/bookings/${encodeURIComponent(booking.id)}/cipher`);
      if (req !== s.cipherReq || s.denied) return;
      const parts = [];
      if (data?.contact_token && data?.anatomy?.contact) parts.push(anatomyView(data.anatomy.contact, data.contact_token, { title: "Anatomia do contato" }));
      if (data?.message_token && data?.anatomy?.message) parts.push(anatomyView(data.anatomy.message, data.message_token, { title: "Anatomia da mensagem" }));
      target.replaceChildren(
        el("p", { class: "muted", text: `Algoritmo: ${data?.algorithm || "Fernet"}. A anatomia sai do próprio token, sem a chave: nada aqui revela o conteúdo.` }),
        ...(parts.length ? parts : [el("p", { class: "muted", text: "Token ausente ou ilegível neste pedido." })]),
      );
      target.hidden = false;
      button.setAttribute("aria-expanded", "true");
      button.textContent = "Esconder anatomia";
    } catch (err) {
      fail(err, "Não foi possível carregar o token deste pedido.");
    } finally {
      setBusy(button, false);
    }
  }

  function cryptoItem(booking) {
    const detailId = `cripto-anatomia-${booking.id}`;
    const detail = el("div", { class: "cipher-item__anatomy", id: detailId, hidden: true });
    const anatomyButton = el(
      "button",
      { type: "button", class: "link-button", "data-action": "anatomy", "aria-expanded": "false", "aria-controls": detailId },
      "Ver anatomia do token",
    );
    anatomyButton.addEventListener("click", () => showAnatomy(booking, anatomyButton, detail));
    const who = booking.user ? `${booking.user.name || "Cliente"} (${booking.user.email || "sem e-mail"})` : "";
    return el(
      "li",
      { class: "order cipher-item", "data-booking-id": String(booking.id) },
      el(
        "div",
        { class: "order__head" },
        el("h3", { class: "order__title" }, el("span", { class: "order__id", text: `#${booking.id}` }), " ", booking.field?.name || "Campo"),
        statusBadge(booking.status, booking.status_label),
      ),
      el("p", { class: "order__when" }, el("strong", { text: formatTimeRange(booking.start, booking.end) }), " ", formatDayLong(booking.start)),
      who ? el("p", { class: "order__who", text: who }) : null,
      contactBox(booking),
      anatomyButton,
      detail,
    );
  }

  async function loadCrypto() {
    if (s.denied || !cipherTab.list) return;
    const req = ++s.cryptoReq;
    cipherTab.list.setAttribute("aria-busy", "true");
    try {
      const data = await api.get("/api/admin/bookings");
      if (req !== s.cryptoReq || s.denied) return;
      const items = (Array.isArray(data?.bookings) ? data.bookings : [])
        .slice()
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, CRYPTO_RECENT);
      hideAllContacts();
      if (!items.length) {
        cipherTab.list.replaceChildren();
        cipherTab.status.replaceChildren(stateBox({ title: "Nenhum pedido ainda", text: "Quando um cliente pedir um horário, o contato criptografado dele aparece aqui." }));
        cipherTab.status.hidden = false;
        return;
      }
      cipherTab.status.hidden = true;
      cipherTab.list.replaceChildren(...items.map(cryptoItem));
    } catch (err) {
      if (req !== s.cryptoReq || guard(err)) return;
      cipherTab.list.replaceChildren();
      cipherTab.status.replaceChildren(
        stateBox({ title: "Não foi possível carregar os pedidos", text: err.message, tone: "error", action: retryButton(() => loadCrypto()) }),
      );
      cipherTab.status.hidden = false;
    } finally {
      cipherTab.list.removeAttribute("aria-busy");
    }
  }

  // ---------- início ----------
  const user = await getUser();
  const access = accessState(user);
  if (access !== "staff") {
    deny(access);
    return;
  }
  if (checking) checking.hidden = true;
  denied.hidden = true;
  shell.hidden = false;

  try {
    s.fields = normalizeFields(await api.get("/api/fields"));
  } catch (err) {
    if (guard(err)) return;
    s.fields = [];
    toast("Não foi possível carregar a lista de campos.", "error");
  }
  fillFieldSelect(control(orders.form, "field"), { allowAll: true });
  fillFieldSelect(control(blocks.form, "field"), { allowAll: false });
  fillFieldSelect(control(agenda.form, "field"), { allowAll: false });
  for (const input of [control(blocks.form, "date"), control(agenda.form, "date")]) {
    if (!input) continue;
    input.value = today;
  }
  const blockDate = control(blocks.form, "date");
  if (blockDate) blockDate.min = today;
  kanban?.init();
  // A primeira aba do HTML abre por padrão (Kanban no painel real); "#cripto" etc. abre a aba pedida.
  await activate(initialTab(tabs, opts.location || globalThis.location));
}
