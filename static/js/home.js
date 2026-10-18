// Home: vídeo do hero, busca rápida por data e cards de campos vindos de /api/fields.
import { api } from "./api.js";
import { $, el, formatPrice, prefersReducedMotion } from "./ui.js";

/** Data local de São Paulo no formato YYYY-MM-DD. */
export function todayISO(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Aceita lista pura ou `{fields: [...]}` (contrato §5: "200 lista"). */
export function normalizeFields(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.fields)) return data.fields;
  return [];
}

export function photoUrl(photo, staticBase, fallback) {
  if (typeof photo !== "string" || !photo.trim()) return fallback;
  const p = photo.trim();
  // Mesmo critério de safeNext: nada de "//host", "/\host" ou barras invertidas.
  if (p.startsWith("//") || p.includes("\\")) return fallback;
  if (/^https?:\/\//i.test(p) || p.startsWith("/")) return p;
  return staticBase + p;
}

/**
 * Vídeo do hero. Se o arquivo falhar (ex.: ausente), fica só o pôster e o botão
 * some: nada de "Pausar vídeo" para um vídeo que não toca.
 */
export function initHeroVideo(video = $("#hero-video"), toggle = $("[data-video-toggle]")) {
  if (!video) return;
  let broken = false;
  const label = (playing) => {
    if (!toggle) return;
    toggle.querySelector("span").textContent = playing ? "Pausar vídeo" : "Tocar vídeo";
    toggle.dataset.state = playing ? "playing" : "paused";
  };
  const fail = () => {
    broken = true;
    if (toggle) toggle.hidden = true;
  };
  const play = () =>
    video
      .play()
      .then(() => !broken && label(true))
      .catch(() => !broken && label(false));
  const pause = () => {
    video.pause();
    label(false);
  };
  // O erro de <source> não borbulha até o <video>; o NO_SOURCE (3) cobre falha antes do script.
  const sources = video.querySelectorAll?.("source") || [];
  const last = sources[sources.length - 1];
  last?.addEventListener?.("error", fail);
  video.addEventListener?.("error", fail);
  if (video.error || video.networkState === 3) {
    fail();
    return;
  }
  if (toggle) {
    label(false);
    toggle.hidden = false;
    toggle.addEventListener("click", () => (video.paused ? play() : pause()));
  }
  if (!prefersReducedMotion()) play();
  globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").addEventListener?.("change", (e) => {
    if (e.matches) pause();
  });
}

function initQuickSearch() {
  const input = $("#busca-data");
  if (!input) return;
  const today = todayISO();
  input.min = today;
  if (!input.value) input.value = nextOpenDate(today);
}

/**
 * Primeiro dia de expediente a partir de `iso` (segunda a sexta, como
 * BUSINESS_HOURS e o texto "Segunda a sexta" do formulário). Num domingo a
 * busca já sugere segunda, em vez de levar a um dia fechado.
 */
export function nextOpenDate(iso, openWeekdays = [1, 2, 3, 4, 5]) {
  const [y, m, d] = iso.split("-").map(Number);
  for (let i = 0; i < 7; i += 1) {
    const day = new Date(Date.UTC(y, m - 1, d + i));
    if (openWeekdays.includes(day.getUTCDay())) return day.toISOString().slice(0, 10);
  }
  return iso;
}

function fieldCard(field, staticBase, fallback) {
  const href = `/reservar/?field=${encodeURIComponent(field.id)}`;
  const price = formatPrice(field.price_per_hour);
  const titleId = `campo-${field.id}-titulo`;
  return el(
    "li",
    { class: "field-card" },
    el(
      "article",
      { "aria-labelledby": titleId },
      el("img", {
        class: "field-card__photo",
        src: photoUrl(field.photo, staticBase, fallback),
        alt: "",
        loading: "lazy",
        width: "640",
        height: "400",
      }),
      el(
        "div",
        { class: "field-card__body" },
        el("h3", { id: titleId, class: "field-card__name", text: field.name || "Campo" }),
        field.description ? el("p", { class: "field-card__desc", text: field.description }) : null,
        el(
          "div",
          { class: "field-card__foot" },
          price
            ? el("p", { class: "field-card__price" }, el("strong", { text: price }), el("span", { text: " por hora" }))
            : null,
          el("a", { class: "btn btn--sm field-card__cta", href }, "Ver horários"),
        ),
      ),
    ),
  );
}

function renderState(root, kind) {
  const tpl = root.querySelector(`template[data-state="${kind}"]`);
  const list = root.querySelector("[data-campos-list]");
  const status = root.querySelector("[data-campos-status]");
  list.replaceChildren();
  list.hidden = true;
  status.replaceChildren(tpl ? tpl.content.cloneNode(true) : "");
  status.hidden = false;
}

export async function loadFields(root = $("#campos")) {
  if (!root) return;
  const list = root.querySelector("[data-campos-list]");
  const status = root.querySelector("[data-campos-status]");
  const skeletons = root.querySelectorAll("[data-campos-skeleton]");
  const staticBase = root.dataset.staticBase || "/static/";
  const fallback = root.dataset.fallbackPhoto || "";
  const showSkeleton = (on) => skeletons.forEach((node) => (node.hidden = !on));

  root.setAttribute("aria-busy", "true");
  showSkeleton(true);
  status.hidden = true;
  list.hidden = true;
  try {
    const fields = normalizeFields(await api.get("/api/fields"));
    if (!fields.length) {
      renderState(root, "empty");
    } else {
      list.replaceChildren(...fields.map((f) => fieldCard(f, staticBase, fallback)));
      list.hidden = false;
    }
  } catch {
    renderState(root, "error");
    status.querySelector("[data-retry]")?.addEventListener("click", () => loadFields(root), { once: true });
  } finally {
    showSkeleton(false);
    root.removeAttribute("aria-busy");
  }
}

export function initHome() {
  initHeroVideo();
  initQuickSearch();
  loadFields();
}
