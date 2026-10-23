// Visualização dos dados criptografados: token Fernet truncado (expandir/copiar)
// e a "anatomia" do token (versão | timestamp | IV | texto cifrado | HMAC).
// Só textContent: o token e qualquer texto vindo da API nunca viram HTML.
import { el, toast } from "./ui.js";

export const TOKEN_PREVIEW = 32;

/** Primeiros `n` caracteres + "…" (token curto volta inteiro). */
export function truncateToken(token, n = TOKEN_PREVIEW) {
  const text = typeof token === "string" ? token : "";
  return text.length > n ? `${text.slice(0, n)}…` : text;
}

/**
 * Copia para a área de transferência. Usa navigator.clipboard; sem ele (HTTP
 * sem permissão, navegador antigo) tenta um textarea + execCommand. Devolve true/false.
 */
export async function copyText(text, env = {}) {
  const clipboard = "clipboard" in env ? env.clipboard : globalThis.navigator?.clipboard;
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(String(text));
      return true;
    } catch {
      // cai no plano B
    }
  }
  const doc = env.document || globalThis.document;
  if (!doc?.execCommand || !doc.body) return false;
  const area = el("textarea", { class: "visually-hidden", readonly: true, "aria-hidden": "true" });
  area.value = String(text);
  doc.body.append(area);
  try {
    area.select?.();
    return Boolean(doc.execCommand("copy"));
  } catch {
    return false;
  } finally {
    area.remove();
  }
}

/** Botão "Copiar" com aviso (toast) de sucesso ou falha. */
export function copyButton(getText, { label = "Copiar", env } = {}) {
  const button = el("button", { type: "button", class: "link-button ctoken__btn", "data-action": "copy-token" }, label);
  button.addEventListener("click", async () => {
    const ok = await copyText(getText(), env);
    toast(ok ? "Token copiado." : "Não deu para copiar. Selecione o texto e copie manualmente.", ok ? "success" : "error");
  });
  return button;
}

let viewSeq = 0;

/**
 * Bloco "🔒 Contato (criptografado)": token truncado, "Ver tudo"/"Recolher" e "Copiar".
 * `compact` = uma linha (cards do Kanban).
 */
export function tokenView({ label, token, empty = "Não informado.", compact = false, env } = {}) {
  viewSeq += 1;
  const valueId = `ctoken-${viewSeq}`;
  const box = el("div", { class: `ctoken${compact ? " ctoken--compact" : ""}`, "data-token-view": "", "data-expanded": "false" });
  const head = el("p", { class: "ctoken__label" }, el("span", { "aria-hidden": "true", text: "🔒 " }), label);
  if (!token) {
    box.append(head, el("p", { class: "ctoken__empty muted", text: empty }));
    return box;
  }
  const value = el("code", { class: "ctoken__value", id: valueId, "data-token-value": "", translate: "no", text: truncateToken(token) });
  const toggle = el(
    "button",
    { type: "button", class: "link-button ctoken__btn", "data-action": "expand-token", "aria-expanded": "false", "aria-controls": valueId },
    "Ver tudo",
  );
  toggle.addEventListener("click", () => {
    const open = box.getAttribute("data-expanded") !== "true";
    box.setAttribute("data-expanded", String(open));
    toggle.setAttribute("aria-expanded", String(open));
    toggle.textContent = open ? "Recolher" : "Ver tudo";
    value.textContent = open ? token : truncateToken(token);
  });
  const tools = el("span", { class: "ctoken__tools" }, toggle, copyButton(() => token, { env }));
  box.append(head, value, tools);
  return box;
}

/** Contato + mensagem criptografados de um pedido (dados vindos de booking_to_dict). */
export function bookingTokens(booking, { compact = false, env } = {}) {
  return [
    tokenView({ label: "Contato (criptografado)", token: booking?.contact_token, compact, env }),
    tokenView({ label: "Mensagem (criptografada)", token: booking?.message_token, empty: "Sem mensagem.", compact, env }),
  ];
}

// ---------- anatomia do token ----------

export const SEGMENT_HELP = {
  version: "Sempre 0x80: diz que é um token Fernet versão 1.",
  timestamp: "Quando o token foi criado (segundos desde 1970). Não é segredo.",
  iv: "Vetor de inicialização aleatório: o mesmo texto cifrado duas vezes sai diferente.",
  ciphertext: "O texto cifrado com AES-128 em modo CBC. Sem a chave, não dá para ler.",
  hmac: "Assinatura HMAC-SHA256 de tudo o que vem antes: detecta qualquer alteração.",
};

export function bytesLabel(n) {
  return n === 1 ? "1 byte" : `${n} bytes`;
}

function segmentDetail(seg) {
  if (seg.key === "timestamp") {
    const when = seg.iso ? new Date(seg.iso) : null;
    const text = when && !Number.isNaN(when.getTime())
      ? when.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
      : String(seg.value ?? "");
    return text;
  }
  if (seg.hex) return `0x${seg.hex}`;
  if (seg.hex_prefix) return `0x${seg.hex_prefix}…`;
  return "";
}

/** Normaliza a anatomia vinda da API: só segmentos conhecidos, em ordem. */
export function anatomySegments(anatomy) {
  const list = Array.isArray(anatomy?.segments) ? anatomy.segments : [];
  return list.filter((s) => s && typeof s.key === "string" && s.key in SEGMENT_HELP);
}

/** Token colorido por segmento + barra proporcional + legenda com tamanhos e explicações. */
export function anatomyView(anatomy, token, { title = "Anatomia do token" } = {}) {
  const segments = anatomySegments(anatomy);
  const text = typeof token === "string" ? token : "";
  const colored = el(
    "p",
    { class: "anatomy__token", translate: "no" },
    segments.map((seg) =>
      el("span", { class: `anatomy__part anatomy--${seg.key}`, title: `${seg.label}: ${bytesLabel(seg.bytes)}` }, text.slice(seg.char_start, seg.char_end)),
    ),
    text.endsWith("=") ? el("span", { class: "anatomy__part anatomy--pad", title: "Preenchimento do base64" }, text.slice(text.replace(/=+$/, "").length)) : null,
  );
  const bar = el(
    "div",
    { class: "anatomy__bar", "aria-hidden": "true" },
    segments.map((seg) => el("span", { class: `anatomy__cell anatomy--${seg.key}`, style: `flex-grow:${Math.max(1, Number(seg.bytes) || 1)}` })),
  );
  const legend = el(
    "ol",
    { class: "anatomy__legend" },
    segments.map((seg) =>
      el(
        "li",
        { class: "anatomy__item", "data-segment": seg.key },
        el("span", { class: `anatomy__swatch anatomy--${seg.key}`, "aria-hidden": "true" }),
        el("span", { class: "anatomy__name" }, el("strong", { text: seg.label }), " ", el("span", { class: "anatomy__size", text: bytesLabel(seg.bytes) })),
        el("span", { class: "anatomy__detail", translate: "no", text: segmentDetail(seg) }),
        el("span", { class: "anatomy__help muted", text: SEGMENT_HELP[seg.key] }),
      ),
    ),
  );
  const total = Number(anatomy?.total_bytes) || 0;
  return el(
    "figure",
    { class: "anatomy", "data-anatomy": "" },
    el("figcaption", { class: "anatomy__title" }, title, total ? el("span", { class: "muted", text: ` (${bytesLabel(total)} antes do base64)` }) : null),
    colored,
    bar,
    legend,
  );
}
