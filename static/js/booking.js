// Reservar: campo -> dia (calendário do mês) -> horários (1 a 4 seguidos) -> contato e envio.
// Para a equipe (data-mode="block", vindo do template) o mesmo fluxo vira "Bloquear horário":
// sem preço nem contato, com motivo, e os horários bloqueados abrem o bloqueio para liberar
// (detalhes em block-mode.js). Estado só em memória. Todo texto vindo da API entra como textContent.
import { api, ApiError } from "./api.js";
import { getUser as sessionUser } from "./auth.js";
import {
  el,
  formatPrice,
  formatTimeRange,
  formatTime,
  formatDayLong,
  charCount,
  setBusy,
  showFieldErrors,
  clearFieldErrors,
  showTemplateState,
  stateBox,
  toast,
  retryButton,
  statusBadge,
  prefersReducedMotion,
} from "./ui.js";
import { todayISO, normalizeFields, photoUrl } from "./home.js";
import { bookingTokens, HOW_IT_WORKS_URL } from "./cipher-view.js";
import {
  buildMonthGrid,
  toggleSlot,
  selectionToRange,
  monthRange,
  shiftMonth,
  dayState,
  isISODate,
  isoFromParts,
} from "./calendar.js";
import { createBlockMode, BLOCK_SLOT_LABEL } from "./block-mode.js";

export const MAX_HOURS = 4;
export const CONTACT_MAX = 120;
export const MESSAGE_MAX = 500;

// ---------- funções puras ----------

export function readQuery(search) {
  const params = new URLSearchParams(search || "");
  const rawField = (params.get("field") || "").trim();
  const rawDate = (params.get("date") || "").trim();
  const field = /^\d+$/.test(rawField) && Number(rawField) > 0 ? Number(rawField) : null;
  return { field, date: isISODate(rawDate) ? rawDate : null };
}

export function reservarPath(field, date) {
  const params = new URLSearchParams();
  if (field) params.set("field", String(field));
  if (date) params.set("date", date);
  const qs = params.toString();
  return qs ? `/reservar/?${qs}` : "/reservar/";
}

export function loginUrl(field, date) {
  return `/entrar/?next=${encodeURIComponent(reservarPath(field, date))}`;
}

export function totalPrice(pricePerHour, hours) {
  if (pricePerHour === null || pricePerHour === undefined || pricePerHour === "") return null;
  const price = Number(String(pricePerHour).replace(",", "."));
  if (!Number.isFinite(price) || !hours || hours < 1) return null;
  return Math.round(price * hours * 100) / 100;
}

export function validateBookingForm({ contact = "", message = "" } = {}) {
  const errors = {};
  const c = String(contact).trim();
  if (!c) errors.contact = "Informe um telefone ou WhatsApp para a equipe falar com você.";
  else if (charCount(c) > CONTACT_MAX) errors.contact = `O contato deve ter no máximo ${CONTACT_MAX} caracteres.`;
  if (charCount(String(message).trim()) > MESSAGE_MAX) {
    errors.message = `A mensagem deve ter no máximo ${MESSAGE_MAX} caracteres.`;
  }
  return errors;
}

const hoursLabel = (n) => (n === 1 ? "1 hora" : `${n} horas`);

const SLOT_LABEL = { free: "Livre", booked: "Ocupado", blocked: "Bloqueado", past: "Encerrado", closed: "Fechado" };

const DAY_NOTE = {
  free: (info) => (info.free === 1 ? "1 horário livre" : `${info.free} horários livres`),
  full: () => "lotado",
  closed: () => "fechado",
  past: () => "já passou",
  unknown: () => "",
};

const WEEKDAY_FMT = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" });

// ---------- página ----------

export async function initBooking(root = globalThis.document.getElementById("reserva"), opts = {}) {
  if (!root) return;
  const location = opts.location || globalThis.location;
  const history = "history" in opts ? opts.history : globalThis.history;
  const getUser = opts.getUser || sessionUser;
  const today = todayISO(opts.now || new Date());
  const [ty, tm, td] = today.split("-").map(Number);
  const todayDate = new Date(ty, tm - 1, td);
  const query = readQuery(location.search);

  const $ = (sel) => root.querySelector(sel);
  const sec = { fields: $("#campos-reserva"), cal: $("#calendario"), slots: $("#horarios"), sum: $("#resumo") };
  const ui = {
    fieldsList: $("[data-fields-list]"),
    fieldsStatus: $("[data-fields-status]"),
    fieldsSkeleton: root.querySelectorAll("[data-fields-skeleton]"),
    calTitle: $("[data-cal-title]"),
    calPrev: $("[data-cal-prev]"),
    calNext: $("[data-cal-next]"),
    calBody: $("[data-cal-body]"),
    calHint: $("[data-cal-hint]"),
    slotsHint: $("[data-slots-hint]"),
    slotsSkeleton: $("[data-slots-skeleton]"),
    slotsList: $("[data-slots-list]"),
    slotsStatus: $("[data-slots-status]"),
    sumField: $("[data-sum-field]"),
    sumDate: $("[data-sum-date]"),
    sumTime: $("[data-sum-time]"),
    sumHours: $("[data-sum-hours]"),
    sumTotal: $("[data-sum-total]"),
    form: $("#form-reserva"),
    success: $("[data-success]"),
    counter: $("[data-counter]"),
    bar: $("[data-booking-bar]"),
    barTotal: $("[data-bar-total]"),
    barTime: $("[data-bar-time]"),
    barGo: $("[data-bar-go]"),
    steps: root.querySelectorAll("[data-step]"),
  };
  const contact = ui.form.querySelector('[name="contact"]');
  const message = ui.form.querySelector('[name="message"]');
  const submit = ui.form.querySelector('button[type="submit"]');
  const staticBase = root.dataset.staticBase || "/static/";
  const fallbackPhoto = root.dataset.fallbackPhoto || "";
  const blockMode = root.dataset.mode === "block";
  const slotLabels = blockMode ? BLOCK_SLOT_LABEL : SLOT_LABEL;

  const firstDate = query.date && query.date >= today ? query.date : null;
  const view = firstDate ? firstDate.split("-").map(Number) : [ty, tm];
  const s = {
    fields: [],
    field: null,
    date: firstDate,
    year: view[0],
    month: view[1] - 1,
    overview: null,
    overviewError: false,
    slots: [],
    open: true,
    selected: [],
    dayReq: 0,
    monthReq: 0,
    sent: false,
    viewing: null, // modo bloqueio: id do bloqueio aberto no resumo
    focusSlotStart: null, // horário que recebe o foco quando a grade for recriada
  };

  const setRestVisible = (on) => {
    sec.cal.hidden = !on;
    sec.slots.hidden = !on;
    sec.sum.hidden = !on;
    if (!on && ui.bar) ui.bar.hidden = true;
  };

  const syncUrl = () => {
    try {
      history?.replaceState?.(null, "", reservarPath(s.field?.id, s.date));
    } catch {
      /* sem history: segue sem atualizar a URL */
    }
  };

  const scrollToSection = (node) => {
    node?.scrollIntoView?.({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  };

  // ---------- passos ----------
  function renderSteps() {
    const done = { campo: Boolean(s.field), dia: Boolean(s.date), horario: s.selected.length > 0, confirmar: s.sent };
    const order = ["campo", "dia", "horario", "confirmar"];
    const current = order.find((k) => !done[k]) || "confirmar";
    for (const li of ui.steps) {
      const key = li.getAttribute("data-step");
      li.setAttribute("data-done", String(Boolean(done[key])));
      if (key === current) li.setAttribute("aria-current", "step");
      else li.removeAttribute("aria-current");
    }
  }

  // ---------- campos ----------
  function fieldCard(field) {
    const price = formatPrice(field.price_per_hour);
    const card = el(
      "button",
      {
        type: "button",
        role: "radio",
        class: "pick",
        "data-field-id": String(field.id),
        "aria-checked": "false",
        tabindex: "-1",
      },
      el("img", { class: "pick__photo", src: photoUrl(field.photo, staticBase, fallbackPhoto), alt: "", loading: "lazy", width: "320", height: "200" }),
      el(
        "span",
        { class: "pick__body" },
        el("span", { class: "pick__name", text: field.name || "Campo" }),
        field.description ? el("span", { class: "pick__desc", text: field.description }) : null,
        price ? el("span", { class: "pick__price" }, el("strong", { text: price }), " por hora") : null,
      ),
      el("span", { class: "pick__check", "aria-hidden": "true" }),
    );
    card.addEventListener("click", () => {
      if (s.field?.id !== field.id) selectField(field, { scroll: true });
    });
    card.addEventListener("keydown", (event) => {
      const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
      if (!(event.key in keys)) return;
      event.preventDefault?.();
      const i = s.fields.findIndex((f) => f.id === field.id);
      const next = s.fields[(i + keys[event.key] + s.fields.length) % s.fields.length];
      selectField(next);
      ui.fieldsList.querySelector(`button[data-field-id="${next.id}"]`)?.focus();
    });
    return card;
  }

  function renderFieldChecks() {
    const cards = ui.fieldsList.querySelectorAll("button[data-field-id]");
    cards.forEach((card, i) => {
      const on = s.field && card.getAttribute("data-field-id") === String(s.field.id);
      card.setAttribute("aria-checked", on ? "true" : "false");
      card.setAttribute("tabindex", on || (!s.field && i === 0) ? "0" : "-1");
    });
  }

  async function loadFields() {
    ui.fieldsSkeleton.forEach((n) => (n.hidden = false));
    ui.fieldsStatus.hidden = true;
    ui.fieldsList.hidden = true;
    sec.fields.setAttribute("aria-busy", "true");
    let fields;
    try {
      fields = normalizeFields(await api.get("/api/fields"));
    } catch {
      fields = null;
    }
    ui.fieldsSkeleton.forEach((n) => (n.hidden = true));
    sec.fields.removeAttribute("aria-busy");
    if (fields === null) {
      setRestVisible(false);
      showTemplateState(sec.fields, ui.fieldsStatus, "error");
      ui.fieldsStatus.querySelector("[data-retry]")?.addEventListener("click", () => loadFields(), { once: true });
      return;
    }
    if (!fields.length) {
      setRestVisible(false);
      showTemplateState(sec.fields, ui.fieldsStatus, "empty");
      return;
    }
    s.fields = fields;
    setRestVisible(true);
    ui.fieldsList.replaceChildren(...fields.map(fieldCard));
    ui.fieldsList.hidden = false;
    renderFieldChecks();
    const initial = fields.find((f) => f.id === query.field) || (fields.length === 1 ? fields[0] : null);
    if (initial) {
      await selectField(initial);
    } else {
      renderCalendar();
      renderSlots();
      renderSummary();
    }
  }

  async function selectField(field, { scroll = false } = {}) {
    s.field = field;
    s.selected = [];
    s.slots = [];
    clearFieldErrors(ui.form);
    renderFieldChecks();
    syncUrl();
    renderSummary();
    if (scroll) scrollToSection(sec.cal);
    await Promise.all([loadMonth(), s.date ? loadDay() : renderSlots()]);
  }

  // ---------- calendário ----------
  async function loadMonth() {
    if (!s.field) return renderCalendar();
    const req = ++s.monthReq;
    s.overview = null;
    s.overviewError = false;
    renderCalendar();
    let days = {};
    let failed = false;
    try {
      const data = await api.get("/api/availability", { field: s.field.id, ...monthRange(s.year, s.month) });
      days = (data && data.days) || {};
    } catch {
      failed = true;
    }
    if (req !== s.monthReq) return;
    s.overview = days;
    s.overviewError = failed;
    renderCalendar();
  }

  function dayButtons() {
    return Array.from(ui.calBody.querySelectorAll("button[data-date]"));
  }

  function moveDayFocus(fromDate, step) {
    const enabled = new Map(dayButtons().filter((b) => !b.hasAttribute("disabled")).map((b) => [b.getAttribute("data-date"), b]));
    const [y, m, d] = fromDate.split("-").map(Number);
    for (let i = 1; i <= 42; i += 1) {
      const target = isoFromParts(y, m - 1, d + step * i);
      if (!dayButtons().some((b) => b.getAttribute("data-date") === target)) return;
      const button = enabled.get(target);
      if (button) {
        for (const b of dayButtons()) b.setAttribute("tabindex", b === button ? "0" : "-1");
        button.focus();
        return;
      }
    }
  }

  function dayButton(cell) {
    const info = s.overview ? s.overview[cell.date] : undefined;
    let state = s.field ? dayState(cell, info) : cell.isPast ? "past" : "locked";
    // Sem resumo do mês (falha), deixa tentar o dia: a grade do dia mostra o estado real.
    if (state === "unknown" && !s.overviewError) state = "loading";
    const [, , d] = cell.date.split("-").map(Number);
    // A equipe abre também dias lotados: é lá que estão os bloqueios para liberar.
    const enabled = state === "free" || state === "unknown" || (blockMode && state === "full");
    const note = info && DAY_NOTE[state] ? DAY_NOTE[state](info) : DAY_NOTE[state]?.({}) || "";
    const button = el(
      "button",
      {
        type: "button",
        class: "cal__day",
        "data-date": cell.date,
        "data-state": state,
        "aria-pressed": s.date === cell.date ? "true" : "false",
        "aria-label": [formatDayLong(cell.date), note].filter(Boolean).join(": "),
        "aria-current": cell.date === today ? "date" : null,
        disabled: !enabled,
        tabindex: "-1",
      },
      el("span", { class: "cal__num", text: String(d) }),
      el("span", { class: "cal__dot", "aria-hidden": "true" }),
    );
    button.addEventListener("click", () => selectDate(cell.date));
    button.addEventListener("keydown", (event) => {
      const steps = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 7, ArrowUp: -7 };
      if (!(event.key in steps)) return;
      event.preventDefault?.();
      moveDayFocus(cell.date, steps[event.key]);
    });
    return button;
  }

  function renderCalendar() {
    ui.calTitle.textContent = WEEKDAY_FMT.format(new Date(s.year, s.month, 15));
    const atFirstMonth = s.year < ty || (s.year === ty && s.month <= tm - 1);
    if (ui.calPrev) ui.calPrev.disabled = atFirstMonth || !s.field;
    if (ui.calNext) ui.calNext.disabled = !s.field;
    // Se o foco estava num dia, lembra a data para devolver o foco depois de recriar a grade
    // (inclusive passando pela renderização de "carregando", em que os dias ficam desativados).
    const active = globalThis.document?.activeElement;
    if (active && active.parentNode === ui.calBody && active.getAttribute?.("data-date")) {
      s.focusDate = active.getAttribute("data-date");
    }
    const cells = buildMonthGrid(s.year, s.month, todayDate)
      .flat()
      .map((cell) => (cell.inMonth ? dayButton(cell) : el("span", { class: "cal__pad", "aria-hidden": "true" })));
    ui.calBody.replaceChildren(...cells);
    ui.calBody.setAttribute("aria-busy", s.field && !s.overview ? "true" : "false");
    // Uma única parada de Tab: o dia escolhido, senão hoje, senão o primeiro dia livre.
    const enabled = dayButtons().filter((b) => !b.hasAttribute("disabled"));
    const stop =
      enabled.find((b) => b.getAttribute("data-date") === s.date) ||
      enabled.find((b) => b.getAttribute("data-date") === today) ||
      enabled[0];
    stop?.setAttribute("tabindex", "0");

    if (s.focusDate) {
      const target = enabled.find((b) => b.getAttribute("data-date") === s.focusDate);
      const stillLoading = ui.calBody.getAttribute("aria-busy") === "true";
      const doc = globalThis.document;
      const cur = doc?.activeElement;
      // Só devolve o foco se ninguém o levou para outro lugar enquanto carregava.
      const focusIsFree = !cur || cur === doc.body || cur.isConnected === false || cur.parentNode === ui.calBody;
      if (target && focusIsFree) {
        for (const b of dayButtons()) b.setAttribute("tabindex", b === target ? "0" : "-1");
        target.focus();
        s.focusDate = null;
      } else if (target) {
        s.focusDate = null;
      } else if (!stillLoading) {
        s.focusDate = null; // o dia ficou indisponível: não rouba o foco
      }
    }

    if (ui.calHint) {
      ui.calHint.replaceChildren();
      if (!s.field) ui.calHint.append("Escolha um campo para ver os dias com horário livre.");
      else if (s.overviewError) {
        ui.calHint.append(
          "Não foi possível carregar os dias livres. Você ainda pode escolher um dia. ",
          el("button", { type: "button", class: "link-button", onclick: () => loadMonth() }, "Tentar de novo"),
        );
      } else if (s.overview && !enabled.length) {
        ui.calHint.append("Não há horários livres neste mês. Veja o próximo mês.");
      }
      ui.calHint.hidden = !ui.calHint.childNodes.length;
    }
  }

  function changeMonth(delta) {
    Object.assign(s, shiftMonth(s.year, s.month, delta));
    loadMonth();
  }

  function selectDate(date) {
    if (s.date === date && s.slots.length) return;
    s.date = date;
    s.selected = [];
    blocks?.close();
    clearFieldErrors(ui.form);
    syncUrl();
    for (const b of dayButtons()) {
      const on = b.getAttribute("data-date") === date;
      b.setAttribute("aria-pressed", on ? "true" : "false");
      if (!b.hasAttribute("disabled")) b.setAttribute("tabindex", on ? "0" : "-1");
    }
    renderSummary();
    scrollToSection(sec.slots);
    return loadDay();
  }

  // ---------- horários ----------
  async function loadDay() {
    if (!s.field || !s.date) return renderSlots();
    const req = ++s.dayReq;
    s.slots = [];
    ui.slotsList.hidden = true;
    ui.slotsStatus.hidden = true;
    if (ui.slotsSkeleton) ui.slotsSkeleton.hidden = false;
    sec.slots.setAttribute("aria-busy", "true");
    setHint("");
    let data;
    let error = null;
    try {
      // Equipe: a agenda traz o mesmo formato com id, motivo e intervalo de cada bloqueio.
      data = await api.get(blockMode ? "/api/admin/agenda" : "/api/availability", { field: s.field.id, date: s.date });
    } catch (err) {
      error = err;
    }
    if (req !== s.dayReq) return;
    if (ui.slotsSkeleton) ui.slotsSkeleton.hidden = true;
    sec.slots.removeAttribute("aria-busy");
    if (error) {
      ui.slotsStatus.replaceChildren(
        stateBox({
          title: "Não foi possível carregar os horários",
          text: error instanceof ApiError ? error.message : "Tente de novo em instantes.",
          tone: "error",
          action: retryButton(() => loadDay()),
        }),
      );
      ui.slotsStatus.hidden = false;
      renderSummary();
      return;
    }
    s.open = !data || data.open !== false;
    s.slots = Array.isArray(data?.slots) ? data.slots : [];
    s.selected = s.selected.filter((i) => s.slots[i]?.state === "free");
    if (s.viewing !== null && !s.slots.some((x) => x.block?.id === s.viewing)) blocks?.close();
    renderSlots();
    renderSummary();
  }

  function setHint(text) {
    if (!ui.slotsHint) return;
    ui.slotsHint.textContent = text;
    ui.slotsHint.hidden = !text;
  }

  function renderSlots() {
    ui.slotsStatus.hidden = true;
    if (!s.field || !s.date) {
      ui.slotsList.hidden = true;
      ui.slotsList.replaceChildren();
      setHint(s.field ? "Escolha um dia no calendário para ver os horários." : "Escolha um campo e um dia para ver os horários.");
      return;
    }
    if (!s.open || !s.slots.length) {
      ui.slotsList.hidden = true;
      ui.slotsList.replaceChildren();
      setHint("");
      ui.slotsStatus.replaceChildren(
        stateBox({ title: "O campo fica fechado neste dia", text: "Escolha outro dia no calendário." }),
      );
      ui.slotsStatus.hidden = false;
      return;
    }
    ui.slotsList.replaceChildren(
      ...s.slots.map((slot, i) => {
        const free = slot.state === "free";
        const openable = blockMode && slot.state === "blocked" && slot.block;
        const label = slotLabels[slot.state] || slot.state;
        const ariaLabel = openable
          ? `${formatTimeRange(slot.start, slot.end)}, bloqueado${slot.block.reason ? `: ${slot.block.reason}` : ""}. Ver bloqueio`
          : `${formatTimeRange(slot.start, slot.end)}, ${label.toLowerCase()}`;
        const button = el(
          "button",
          {
            type: "button",
            class: "slot",
            "data-slot": String(i),
            "data-state": slot.state,
            "aria-pressed": "false",
            "aria-label": ariaLabel,
            "data-block-id": openable ? String(slot.block.id) : null,
            disabled: !free && !openable,
          },
          el("span", { class: "slot__time", text: formatTime(slot.start) }),
          el("span", { class: "slot__meta", text: free ? `até ${formatTime(slot.end)}` : label }),
        );
        button.addEventListener("click", () => (openable ? blocks.open(slot.block, slot.start) : pickSlot(i)));
        return el("li", {}, button);
      }),
    );
    ui.slotsList.hidden = false;
    paintSelection();
    if (s.focusSlotStart) {
      const i = s.slots.findIndex((x) => x.start === s.focusSlotStart);
      s.focusSlotStart = null;
      ui.slotsList.querySelector(`button[data-slot="${i}"]`)?.focus?.();
    }
    if (s.viewing === null) setHint(idleHint());
  }

  function idleHint() {
    const anyFree = s.slots.some((x) => x.state === "free");
    const anyBlocked = s.slots.some((x) => x.state === "blocked");
    if (blockMode) {
      if (anyFree) return `Toque em até ${MAX_HOURS} horários livres seguidos para bloquear${anyBlocked ? ", ou num bloqueado para ver e liberar" : ""}.`;
      return anyBlocked ? "Toque num horário bloqueado para ver o motivo ou liberar." : "Não há horários livres neste dia. Escolha outro dia.";
    }
    return anyFree ? `Toque em até ${MAX_HOURS} horários seguidos.` : "Não há horários livres neste dia. Escolha outro dia.";
  }

  function paintSelection() {
    const sorted = [...s.selected].sort((a, b) => a - b);
    for (const button of ui.slotsList.querySelectorAll("button[data-slot]")) {
      const i = Number(button.getAttribute("data-slot"));
      const on = sorted.includes(i);
      button.setAttribute("aria-pressed", on ? "true" : "false");
      button.classList.toggle("is-selected", on);
      button.classList.toggle("is-first", on && i === sorted[0]);
      button.classList.toggle("is-last", on && i === sorted.at(-1));
      if (button.hasAttribute("data-block-id")) {
        const viewing = s.viewing !== null && button.getAttribute("data-block-id") === String(s.viewing);
        button.classList.toggle("is-viewing", viewing);
        button.setAttribute("aria-pressed", viewing ? "true" : "false");
      }
    }
  }

  function pickSlot(i) {
    blocks?.close();
    const before = s.selected;
    const next = toggleSlot(before, i, s.slots, MAX_HOURS);
    const blockedAtMax = next.length === before.length && before.length >= MAX_HOURS && !before.includes(i);
    const adjacent = before.length && (i === Math.min(...before) - 1 || i === Math.max(...before) + 1);
    s.selected = next;
    paintSelection();
    renderSummary();
    if (blockedAtMax && adjacent) setHint(`Cada reserva pode ter no máximo ${MAX_HOURS} horas.`);
    else if (next.length) setHint(`${hoursLabel(next.length)} selecionada${next.length > 1 ? "s" : ""}. Toque no primeiro ou no último para tirar.`);
    else setHint(idleHint());
  }

  // ---------- resumo ----------
  function renderSummary() {
    const range = selectionToRange(s.selected, s.slots);
    const total = totalPrice(s.field?.price_per_hour, s.selected.length);
    ui.sumField.textContent = s.field?.name || "—";
    ui.sumDate.textContent = s.date ? formatDayLong(s.date) : "—";
    ui.sumTime.textContent = range ? formatTimeRange(range.start, range.end) : "—";
    ui.sumHours.textContent = range ? hoursLabel(s.selected.length) : "—";
    const totalText = range && total !== null ? formatPrice(total) : "—";
    if (ui.sumTotal) ui.sumTotal.textContent = totalText;
    if (ui.bar) {
      ui.bar.hidden = !range || s.sent;
      // Bloqueio não tem preço: a barra mostra a duração.
      if (ui.barTotal) ui.barTotal.textContent = blockMode ? (range ? hoursLabel(s.selected.length) : "") : totalText;
      if (ui.barTime) ui.barTime.textContent = range ? `${formatTimeRange(range.start, range.end)}` : "";
    }
    renderSteps();
  }

  function updateCounter() {
    if (ui.counter) ui.counter.textContent = `${charCount(message?.value || "")}/${MESSAGE_MAX}`;
  }

  // ---------- envio ----------
  function showSuccess(booking, sent) {
    s.sent = true;
    ui.form.hidden = true;
    const range = sent.range;
    const id = booking?.id;
    const again = el("button", { type: "button", class: "btn btn--ghost btn--sm" }, "Fazer outro pedido");
    again.addEventListener("click", () => {
      s.sent = false;
      s.selected = [];
      ui.success.hidden = true;
      ui.form.hidden = false;
      if (message) message.value = "";
      updateCounter();
      loadDay();
      loadMonth();
      renderSummary();
      scrollToSection(sec.slots);
    });
    const box = el(
      "div",
      { class: "success", tabindex: "-1" },
      el("h3", { text: "Pedido enviado" }),
      el(
        "p",
        {},
        "Seu pedido está ",
        statusBadge(booking?.status || "pendente", booking?.status_label || "Pendente"),
        ". A equipe vai analisar e você recebe a resposta por e-mail.",
      ),
      el(
        "ul",
        { class: "success__facts" },
        el("li", { text: booking?.field?.name || sent.field.name || "" }),
        el("li", { text: formatDayLong(booking?.start || sent.date) }),
        el("li", { text: booking?.start && booking?.end ? formatTimeRange(booking.start, booking.end) : formatTimeRange(range.start, range.end) }),
      ),
      booking?.contact_token
        ? el(
            "div",
            { class: "success__crypto", "data-protected": "" },
            el("p", { class: "muted", text: "Seu contato e sua mensagem já foram guardados criptografados. É assim que eles ficam no banco:" }),
            ...bookingTokens(booking),
            el("p", { class: "muted" }, el("a", { href: HOW_IT_WORKS_URL }, "Como funciona a criptografia")),
          )
        : null,
      el(
        "div",
        { class: "success__actions" },
        el("a", { class: "btn btn--sm", href: id ? `/minhas-reservas/?novo=${encodeURIComponent(id)}` : "/minhas-reservas/" }, "Ver minhas reservas"),
        again,
      ),
    );
    ui.success.replaceChildren(box);
    ui.success.hidden = false;
    renderSummary();
    box.focus?.();
  }

  // ---------- modo bloqueio (equipe) ----------
  const blocks = blockMode
    ? createBlockMode({
        root,
        form: ui.form,
        state: s,
        location,
        repaint: () => {
          paintSelection();
          renderSummary();
        },
        setHint,
        idleHint,
        scrollTo: () => scrollToSection(sec.sum),
        refresh: async () => {
          await Promise.all([loadDay(), loadMonth()]);
          renderSummary();
        },
      })
    : null;

  ui.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submit?.disabled) return;
    if (blocks) return blocks.submit(submit);
    const values = { contact: contact?.value || "", message: message?.value || "" };
    const range = selectionToRange(s.selected, s.slots);
    if (!s.field || !s.date || !range) {
      showFieldErrors(ui.form, {}, "Escolha pelo menos um horário livre na grade antes de enviar.");
      return;
    }
    const errors = validateBookingForm(values);
    if (Object.keys(errors).length) {
      showFieldErrors(ui.form, errors);
      return;
    }
    // Foto do pedido no momento do envio: a pessoa pode trocar campo/dia enquanto espera.
    const sent = { field: s.field, date: s.date, range };
    clearFieldErrors(ui.form);
    setBusy(submit, true);
    let user;
    try {
      user = await getUser();
    } catch {
      setBusy(submit, false);
      toast("Não foi possível verificar sua sessão. Tente de novo.", "error");
      return;
    }
    if (!user) {
      location.assign(loginUrl(sent.field.id, sent.date));
      return;
    }
    try {
      const data = await api.post("/api/bookings", {
        field: sent.field.id,
        start: sent.range.start,
        end: sent.range.end,
        contact: values.contact.trim(),
        message: values.message.trim(),
      });
      setBusy(submit, false);
      showSuccess(data?.booking, sent);
    } catch (err) {
      setBusy(submit, false);
      if (!(err instanceof ApiError)) {
        showFieldErrors(ui.form, {}, "Não foi possível enviar o pedido. Tente de novo.");
        return;
      }
      if (err.status === 401) {
        location.assign(loginUrl(sent.field.id, sent.date));
        return;
      }
      if (err.status === 409) {
        const sameView = s.field?.id === sent.field.id && s.date === sent.date;
        if (sameView) s.selected = [];
        const what = `${sent.field.name || "Campo"}, ${formatDayLong(sent.date)}, ${formatTimeRange(sent.range.start, sent.range.end)}`;
        showFieldErrors(ui.form, {}, `${err.message} (${what}) A grade foi atualizada: escolha outro horário.`);
        await Promise.all([loadDay(), loadMonth()]);
        renderSummary();
        return;
      }
      const known = Object.fromEntries(Object.entries(err.fields || {}).filter(([k]) => k === "contact" || k === "message"));
      showFieldErrors(ui.form, known, Object.keys(known).length ? "" : err.message);
    }
  });

  message?.addEventListener("input", updateCounter);
  ui.calPrev?.addEventListener("click", () => changeMonth(-1));
  ui.calNext?.addEventListener("click", () => changeMonth(1));
  ui.barGo?.addEventListener("click", () => {
    scrollToSection(sec.sum);
    (contact || ui.form.querySelector('[name="reason"]'))?.focus?.();
  });

  updateCounter();
  renderSummary();
  renderCalendar(); // grade do mês já aparece (travada) enquanto os campos carregam
  renderSlots();
  await loadFields();
}
