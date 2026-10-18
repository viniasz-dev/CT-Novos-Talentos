// Kanban do painel: funções puras (agrupar, transições permitidas, mover, filtrar).
// Sem DOM e sem rede: testadas no Node. A montagem da tela fica em kanban-board.js.

/** Colunas na ordem do quadro (os quatro estados do pedido). */
export const COLUMNS = [
  { status: "pendente", label: "Pendente", empty: "Nenhum pedido esperando resposta." },
  { status: "aprovado", label: "Aprovado", empty: "Nenhuma reserva aprovada neste período." },
  { status: "recusado", label: "Recusado", empty: "Nenhum pedido recusado neste período." },
  { status: "cancelado", label: "Cancelado", empty: "Nenhum pedido cancelado neste período." },
];

/** Período máximo da lista do painel (igual ao servidor). */
export const MAX_RANGE_DAYS = 366;

export const STATUS_LABEL = Object.fromEntries(COLUMNS.map((c) => [c.status, c.label]));

/** Mesma tabela do servidor (bookings/models.py ALLOWED_TRANSITIONS). */
const TRANSITIONS = {
  pendente: ["aprovado", "recusado", "cancelado"],
  aprovado: ["cancelado"],
  recusado: [],
  cancelado: [],
};

/** Mover para recusado/cancelado pede confirmação; aprovar vai direto. */
export const MOVE_COPY = {
  aprovado: { done: "aprovado", confirm: false },
  recusado: { done: "recusado", confirm: true, question: (id) => `Recusar o pedido #${id}?`, yes: "Sim, recusar" },
  cancelado: { done: "cancelado", confirm: true, question: (id) => `Cancelar o pedido #${id}?`, yes: "Sim, cancelar" },
};

export function allowedTargets(status) {
  return [...(TRANSITIONS[status] || [])];
}

export function canDrag(status) {
  return allowedTargets(status).length > 0;
}

export function canMove(from, to) {
  return allowedTargets(from).includes(to);
}

const time = (iso) => {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
};

/** {pendente: [...], aprovado: [...], ...}: cada coluna em ordem de início (o mais próximo primeiro). */
export function groupByStatus(bookings) {
  const groups = Object.fromEntries(COLUMNS.map((c) => [c.status, []]));
  for (const b of Array.isArray(bookings) ? bookings : []) {
    if (groups[b?.status]) groups[b.status].push(b);
  }
  for (const list of Object.values(groups)) {
    list.sort((a, b) => time(a.start) - time(b.start) || a.id - b.id);
  }
  return groups;
}

/** Minúsculas e sem acento: "JOÃO" encontra "joao". */
export function normalizeText(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Filtro local por nome ou e-mail do cliente (campo e datas já vêm filtrados da API). */
export function filterBookings(bookings, { query = "" } = {}) {
  const q = normalizeText(query);
  const list = Array.isArray(bookings) ? bookings : [];
  if (!q) return list;
  return list.filter((b) => normalizeText(`${b.user?.name || ""} ${b.user?.email || ""}`).includes(q));
}

/** "1 hora", "2 horas" a partir do início e fim ISO. */
export function durationLabel(start, end) {
  const hours = Math.round((time(end) - time(start)) / 3600000);
  if (!hours || hours < 1) return "";
  return hours === 1 ? "1 hora" : `${hours} horas`;
}

/** Mensagem de erro do intervalo de datas, ou "" se está ok. */
export function rangeError(from, to) {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (from && !iso.test(from)) return "Informe a data inicial.";
  if (to && !iso.test(to)) return "Informe a data final.";
  if (from && to && to < from) return "A data final deve ser igual ou depois da inicial.";
  // Mesmo teto do servidor (MAX_LIST_RANGE_DAYS em bookings/api_admin.py).
  if (from && to && (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000 > MAX_RANGE_DAYS) {
    return `O período pode ter no máximo ${MAX_RANGE_DAYS} dias.`;
  }
  return "";
}

/** Texto do 409: a mensagem do servidor mais os pedidos que já ocupam o horário. */
export function conflictText(message, fields) {
  const ids = Array.isArray(fields?.conflicts) ? fields.conflicts : [];
  if (!ids.length) return message;
  const list = ids.map((id) => `#${id}`).join(", ");
  return `${message} Já aprovado no mesmo horário: ${ids.length === 1 ? "pedido" : "pedidos"} ${list}.`;
}
