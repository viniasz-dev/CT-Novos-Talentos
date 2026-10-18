// Funções puras do calendário e da grade de horários (sem DOM; testadas no Node).

const pad = (n) => String(n).padStart(2, "0");

/** YYYY-MM-DD a partir de ano, mês (0-11) e dia, sem passar por fuso horário. */
export function isoFromParts(year, month, day) {
  const d = new Date(year, month, day, 12);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isISODate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  return isoFromParts(y, m - 1, d) === value;
}

/**
 * Grade do mês em semanas de domingo a sábado.
 * `month` 0-11; `today` é um Date cujas partes locais definem "hoje".
 */
export function buildMonthGrid(year, month, today) {
  const todayISO = isoFromParts(today.getFullYear(), today.getMonth(), today.getDate());
  const first = new Date(year, month, 1, 12);
  const lastDay = new Date(year, month + 1, 0, 12).getDate();
  const lead = first.getDay();
  const cells = Math.ceil((lead + lastDay) / 7) * 7;
  const weeks = [];
  for (let i = 0; i < cells; i += 1) {
    const day = i - lead + 1;
    const date = isoFromParts(year, month, day);
    if (i % 7 === 0) weeks.push([]);
    weeks.at(-1).push({ date, inMonth: day >= 1 && day <= lastDay, isPast: date < todayISO });
  }
  return weeks;
}

export function monthRange(year, month) {
  const lastDay = new Date(year, month + 1, 0, 12).getDate();
  return { from: isoFromParts(year, month, 1), to: isoFromParts(year, month, lastDay) };
}

export function shiftMonth(year, month, delta) {
  const d = new Date(year, month + delta, 1, 12);
  return { year: d.getFullYear(), month: d.getMonth() };
}

/** Estado visual do dia: outside | past | unknown | closed | full | free. */
export function dayState(cell, info) {
  if (!cell.inMonth) return "outside";
  if (cell.isPast) return "past";
  if (!info) return "unknown";
  if (!info.open) return "closed";
  return info.free > 0 ? "free" : "full";
}

/**
 * Alterna um horário na seleção, mantendo-a contígua.
 * - slot não "free" (ou inexistente): seleção inalterada;
 * - seleção vazia: [index];
 * - clique num extremo: remove esse extremo;
 * - clique no vizinho imediato: estende (até `maxSlots`);
 * - qualquer outro clique (dentro ou longe do bloco): reinicia em [index].
 */
export function toggleSlot(selected, index, slots, maxSlots = 4) {
  const current = [...(selected || [])].sort((a, b) => a - b);
  if (!slots || !slots[index] || slots[index].state !== "free") return current;
  if (!current.length) return [index];
  const lo = current[0];
  const hi = current.at(-1);
  if (index === lo) return current.slice(1);
  if (index === hi) return current.slice(0, -1);
  if (index === lo - 1 || index === hi + 1) {
    if (current.length >= maxSlots) return current;
    return [...current, index].sort((a, b) => a - b);
  }
  return [index];
}

export function selectionToRange(selected, slots) {
  if (!selected || !selected.length) return null;
  const sorted = [...selected].sort((a, b) => a - b);
  const first = slots[sorted[0]];
  const last = slots[sorted.at(-1)];
  if (!first || !last) return null;
  return { start: first.start, end: last.end };
}
