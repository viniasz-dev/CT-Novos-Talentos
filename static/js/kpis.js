// Indicadores do topo do Kanban (GET /api/admin/stats). Formatação pura + render no DOM.
import { el, formatPrice, retryButton } from "./ui.js";

const NUMBER = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

/** 37.5 -> "37,5%"; 0 -> "0%"; valor inválido -> "—". */
export function formatPercent(value) {
  const n = Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(n)) return "—";
  return `${NUMBER.format(Math.min(100, Math.max(0, n)))}%`;
}

/** 12 -> "12 h"; 1.5 -> "1,5 h". */
export function formatHours(value) {
  const n = Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(n)) return "—";
  return `${NUMBER.format(n)} h`;
}

export function formatCount(value) {
  const n = Number(value);
  if (value === null || value === undefined || value === "" || !Number.isInteger(n)) return "—";
  return NUMBER.format(n);
}

export const KPIS = [
  { key: "pending", label: "Pedidos pendentes agora", format: formatCount, tone: "flood" },
  { key: "approved_next7", label: "Aprovadas nos próximos 7 dias", format: formatCount },
  { key: "booked_hours_next7", label: "Horas reservadas (7 dias)", format: formatHours },
  { key: "occupancy_next7", label: "Ocupação do expediente (7 dias)", format: formatPercent, meter: true },
  { key: "lost_last30", label: "Cancelados e recusados (30 dias)", format: formatCount },
  { key: "revenue_next7", label: "Receita estimada (7 dias)", format: (v) => formatPrice(v) || "—" },
];

/** Lista [{key, label, text, value}] pronta para exibir. */
export function kpiItems(stats) {
  return KPIS.map((k) => ({ ...k, value: stats?.[k.key], text: k.format(stats?.[k.key]) }));
}

/** deps: {root, api, ApiError, guard(err)->bool, field()->string} */
export function createKpis({ root, api, ApiError, guard, field = () => "" }) {
  const grid = root.querySelector("[data-kpi-grid]") || root;
  const live = root.querySelector("[data-kpi-live]");
  const s = { req: 0, loaded: false };

  function skeleton() {
    grid.replaceChildren(...KPIS.map((k) => el("li", { class: "kpi kpi--loading", "data-kpi": k.key }, el("span", { class: "kpi__value skeleton", "aria-hidden": "true" }), el("span", { class: "kpi__label", text: k.label }))));
  }

  function render(stats) {
    grid.replaceChildren(
      ...kpiItems(stats).map((k) => {
        const pct = Math.min(100, Math.max(0, Number(k.value) || 0));
        return el(
          "li",
          { class: `kpi${k.tone ? ` kpi--${k.tone}` : ""}`, "data-kpi": k.key },
          el("span", { class: "kpi__value", text: k.text }),
          el("span", { class: "kpi__label", text: k.label }),
          k.meter ? el("span", { class: "kpi__meter", "aria-hidden": "true" }, el("span", { class: "kpi__fill", style: `width:${pct}%` })) : null,
        );
      }),
    );
  }

  async function load() {
    const req = ++s.req;
    if (!s.loaded) skeleton();
    root.setAttribute("aria-busy", "true");
    try {
      const data = await api.get("/api/admin/stats", { field: field() });
      if (req !== s.req) return;
      s.loaded = true;
      render(data);
      if (live) {
        const items = kpiItems(data);
        live.textContent = `Indicadores atualizados: ${items[0].text} pendentes, ocupação ${items[3].text}.`;
      }
    } catch (err) {
      if (req !== s.req || guard?.(err)) return;
      s.loaded = false;
      grid.replaceChildren(
        el(
          "li",
          { class: "kpi kpi--error", role: "alert" },
          el("span", { class: "kpi__label", text: err instanceof ApiError ? err.message : "Não foi possível carregar os indicadores." }),
          retryButton(() => load()),
        ),
      );
    } finally {
      if (req === s.req) root.removeAttribute("aria-busy");
    }
  }

  function clear() {
    s.req += 1;
    grid.replaceChildren();
  }

  return { load, clear, state: s };
}
