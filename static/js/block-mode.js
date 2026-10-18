// "Bloquear horário": o /reservar/ da equipe. Mesmo fluxo do cliente (campo, dia, 1 a 4
// horários seguidos), mas o resumo pede um motivo e envia para POST /api/admin/blocks.
// Horários bloqueados abrem o bloqueio (motivo e intervalo) com "Liberar horário"
// (DELETE /api/admin/blocks/<id>, remove o bloqueio inteiro).
import { api, ApiError } from "./api.js";
import {
  el,
  formatDayLong,
  formatTimeRange,
  charCount,
  setBusy,
  showFieldErrors,
  clearFieldErrors,
  inlineConfirm,
  toast,
} from "./ui.js";
import { selectionToRange } from "./calendar.js";

export const REASON_MAX = 200;

/** Sugestões que só preenchem o campo (não são regra de negócio nem ficam guardadas à parte). */
export const REASON_SUGGESTIONS = ["Manutenção", "Evento do CT", "Horário da escolinha"];

/** Rótulos da grade para a equipe: reserva aprovada aparece como "Reservado". */
export const BLOCK_SLOT_LABEL = { free: "Livre", booked: "Reservado", blocked: "Bloqueado", past: "Encerrado", closed: "Fechado" };

export function validateReason(reason) {
  const text = String(reason ?? "").trim();
  if (!text) return "Informe o motivo do bloqueio.";
  if (charCount(text) > REASON_MAX) return `O motivo deve ter no máximo ${REASON_MAX} caracteres.`;
  return "";
}

/** 409 ao bloquear: mensagem do servidor + pedidos aprovados que ocupam o intervalo. */
export function blockConflictText(message, fields) {
  const ids = Array.isArray(fields?.conflicts) ? fields.conflicts : [];
  if (!ids.length) return message;
  const list = ids.map((id) => `#${id}`).join(", ");
  return `${message} ${ids.length === 1 ? "Pedido aprovado" : "Pedidos aprovados"}: ${list}. Cancele no Kanban do painel para liberar o horário.`;
}

/**
 * deps: {root, form, state, location, repaint(), setHint(text), idleHint(), scrollTo(), refresh()}
 * `state` é o estado de booking.js (field, date, slots, selected, viewing, focusSlotStart).
 */
export function createBlockMode({ root, form, state: s, location, repaint, setHint, idleHint, scrollTo, refresh }) {
  const reason = form.querySelector('[name="reason"]');
  const counter = form.querySelector("[data-reason-counter]");
  const view = root.querySelector("[data-block-view]");
  const done = root.querySelector("[data-block-done]");

  const updateCounter = () => {
    if (counter) counter.textContent = `${charCount(reason?.value || "")}/${REASON_MAX}`;
  };
  reason?.addEventListener("input", updateCounter);
  for (const chip of form.querySelectorAll("[data-reason-suggestion]")) {
    chip.addEventListener("click", () => {
      if (!reason) return;
      reason.value = chip.getAttribute("data-reason-suggestion");
      updateCounter();
      reason.focus();
    });
  }
  updateCounter();

  function setDone(text) {
    if (!done) return;
    done.textContent = text;
    done.hidden = !text;
  }

  // ---------- ver e liberar um bloqueio ----------
  function close() {
    if (s.viewing === null) return;
    s.viewing = null;
    if (view) {
      view.replaceChildren();
      view.hidden = true;
    }
    form.hidden = false;
  }

  function open(block, slotStart) {
    s.selected = [];
    s.viewing = block.id;
    setDone("");
    clearFieldErrors(form);
    const range = formatTimeRange(block.start || slotStart, block.end || "");
    const actions = el("div", { class: "block-view__actions" });
    const release = el("button", { type: "button", class: "btn btn--sm", "data-action": "release" }, "Liberar horário");
    const keep = el("button", { type: "button", class: "btn btn--sm btn--ghost", "data-action": "close-block" }, "Fechar");
    const error = el("p", { class: "form-alert", role: "alert", "data-block-error": "", hidden: true });
    keep.addEventListener("click", () => {
      const back = s.slots.find((x) => x.block?.id === block.id)?.start;
      close();
      repaint();
      setHint(idleHint());
      if (back) root.querySelector(`button[data-block-id="${block.id}"]`)?.focus?.();
    });
    release.addEventListener("click", () =>
      inlineConfirm(actions, {
        question: `Liberar ${range}? O bloqueio inteiro sai da agenda.`,
        confirmLabel: "Sim, liberar",
        cancelLabel: "Voltar",
        confirmAction: "confirm-release",
        onConfirm: (yes) => releaseBlock(block, yes, error, range),
        onCancel: () => release.focus(),
      }),
    );
    actions.append(release, keep);
    view.replaceChildren(
      el("h3", { class: "block-view__title", tabindex: "-1" }, "Horário bloqueado"),
      el("p", { class: "block-view__when" }, el("strong", { text: range }), " ", block.start ? formatDayLong(block.start) : ""),
      el("p", { class: "block-view__reason" }, el("span", { class: "muted", text: "Motivo: " }), block.reason || "Sem motivo informado"),
      el("p", { class: "block-view__note", text: `"Liberar horário" remove o bloqueio inteiro (${range}), não só o horário que você tocou.` }),
      error,
      actions,
    );
    view.hidden = false;
    form.hidden = true;
    repaint();
    setHint(`Bloqueio de ${range} aberto no resumo.`);
    scrollTo();
    view.querySelector(".block-view__title")?.focus?.();
  }

  async function releaseBlock(block, button, error, range) {
    setBusy(button, true);
    try {
      await api.del(`/api/admin/blocks/${encodeURIComponent(block.id)}`);
    } catch (err) {
      setBusy(button, false);
      if (err instanceof ApiError && err.status === 401) {
        location.assign(`/entrar/?next=${encodeURIComponent("/reservar/")}`);
        return;
      }
      if (err instanceof ApiError && err.status === 404) {
        toast("Este bloqueio já tinha sido removido.", "info");
        close();
        await refresh();
        return;
      }
      error.textContent = err instanceof ApiError ? err.message : "Não foi possível liberar o horário. Tente de novo.";
      error.hidden = false;
      return;
    }
    toast("Horário liberado.", "success");
    s.focusSlotStart = s.slots.find((x) => x.block?.id === block.id)?.start || null;
    close();
    setDone(`Liberado: ${range}. O horário volta a aparecer livre para os clientes.`);
    await refresh();
  }

  // ---------- criar bloqueio ----------
  async function submit(button) {
    setDone("");
    const range = selectionToRange(s.selected, s.slots);
    if (!s.field || !s.date || !range) {
      showFieldErrors(form, {}, "Escolha pelo menos um horário livre na grade antes de bloquear.");
      return;
    }
    const problem = validateReason(reason?.value);
    if (problem) {
      showFieldErrors(form, { reason: problem });
      return;
    }
    const sent = { field: s.field, date: s.date, range, reason: reason.value.trim() };
    clearFieldErrors(form);
    setBusy(button, true);
    try {
      await api.post("/api/admin/blocks", { field: sent.field.id, start: range.start, end: range.end, reason: sent.reason });
    } catch (err) {
      setBusy(button, false);
      if (err instanceof ApiError && err.status === 401) {
        location.assign(`/entrar/?next=${encodeURIComponent("/reservar/")}`);
        return;
      }
      if (err instanceof ApiError && err.status === 409) {
        showFieldErrors(form, {}, blockConflictText(err.message, err.fields));
        const box = form.querySelector("[data-form-error]");
        box?.append(" ", el("a", { href: "/painel/", class: "form-alert__link" }, "Abrir o Kanban"));
        s.selected = [];
        await refresh();
        return;
      }
      const known = err instanceof ApiError && err.fields?.reason ? { reason: err.fields.reason } : {};
      showFieldErrors(form, known, Object.keys(known).length ? "" : err instanceof ApiError ? err.message : "Não foi possível bloquear. Tente de novo.");
      return;
    }
    setBusy(button, false);
    toast("Horário bloqueado.", "success");
    s.selected = [];
    reason.value = "";
    updateCounter();
    setDone(`Bloqueado: ${sent.field.name || "Campo"}, ${formatDayLong(sent.date)}, ${formatTimeRange(range.start, range.end)} (${sent.reason}).`);
    await refresh();
  }

  return { open, close, submit };
}
