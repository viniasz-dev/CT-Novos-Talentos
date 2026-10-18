// Página /criptografia/: demonstração de César, Vigenère e Fernet.
// Toda cifra roda no servidor (POST /api/crypto/demo): aqui só há interface.
// A única conta local é o desenho do alfabeto deslocado (roda e réguas), que é visual.
import { api, ApiError } from "./api.js";
import { getUser as sessionUser } from "./auth.js";
import { el, charCount, setBusy, formatDayLong, formatTimeRange, statusBadge, prefersReducedMotion } from "./ui.js";
import { anatomyView, bookingTokens, copyButton } from "./cipher-view.js";
import { nextTabIndex } from "./panel.js";

export const MAX_TEXT = 500;
export const DEBOUNCE_MS = 450;
export const STEP_ROWS = 40;
export const MIN_SHIFT = 1;
export const MAX_SHIFT = 25;
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// ---------- funções puras ----------

/** Deslocamento válido (1 a 25); qualquer outra coisa volta ao padrão 3. */
export function clampShift(value, fallback = 3) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_SHIFT, Math.max(MIN_SHIFT, n));
}

/** As duas réguas da César: letra normal -> letra cifrada para o deslocamento. */
export function alphabetRow(shift) {
  const k = clampShift(shift);
  return [...LETTERS].map((plain, i) => ({ plain, cipher: LETTERS[(i + k) % 26] }));
}

export function letterOf(index) {
  return Number.isInteger(index) && index >= 0 && index < 26 ? LETTERS[index] : "";
}

/** Primeiras `limit` linhas do passo a passo e quantas ficaram de fora. */
export function visibleSteps(steps, limit = STEP_ROWS) {
  const list = Array.isArray(steps) ? steps : [];
  return { rows: list.slice(0, limit), hidden: Math.max(0, list.length - limit) };
}

/** Candidato com maior nota de "parece português". */
export function bestCandidate(candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  return list.reduce((best, c) => (best === null || Number(c.score) > Number(best.score) ? c : best), null);
}

export function errorMessage(err) {
  if (err instanceof ApiError) {
    if (err.status === 429) return "Calma! Foram muitas operações em pouco tempo. Espere um minuto e tente de novo.";
    if (err.status === 0) return "Sem conexão com o servidor. Verifique sua internet e tente de novo.";
    if (err.status === 403 && err.code === "csrf_failed") return "Sua sessão expirou. Recarregue a página e tente de novo.";
    return err.message;
  }
  return "Não foi possível concluir. Tente de novo.";
}

/** Debounce com agendador injetável (testes). */
export function debounce(fn, ms, sched = {}) {
  const set = sched.setTimeout || ((f, t) => globalThis.setTimeout(f, t));
  const clear = sched.clearTimeout || ((id) => globalThis.clearTimeout(id));
  let id = null;
  const run = (...args) => {
    if (id !== null) clear(id);
    id = set(() => {
      id = null;
      fn(...args);
    }, ms);
  };
  run.cancel = () => {
    if (id !== null) clear(id);
    id = null;
  };
  return run;
}

// ---------- pedaços de interface ----------

function shiftText(step, { cipher, action, shift }) {
  if (!step.is_letter) return "—";
  if (cipher === "vigenere") return `${action === "decrypt" ? "−" : "+"}${step.key_shift} (${step.key_char})`;
  return `${action === "decrypt" ? "−" : "+"}${shift}`;
}

/** Tabela "letra a letra" (só textContent). */
export function stepsTable(steps, ctx) {
  const { rows, hidden } = visibleSteps(steps);
  const vig = ctx.cipher === "vigenere";
  const head = ["Caractere", "Posição", vig ? "Chave" : "Deslocamento", "Nova posição", "Resultado"];
  const table = el(
    "table",
    { class: "cstep", "data-steps-table": "" },
    el("caption", { class: "visually-hidden", text: "Passo a passo, um caractere por linha" }),
    el("thead", {}, el("tr", {}, head.map((t) => el("th", { scope: "col", text: t })))),
    el(
      "tbody",
      {},
      rows.map((s) =>
        el(
          "tr",
          { class: s.is_letter ? "" : "cstep__skip" },
          el("td", { class: "cstep__char", text: s.char === " " ? "␣" : s.char === "\n" ? "↵" : s.char }),
          el("td", { text: s.is_letter ? `${s.index} (${letterOf(s.index)})` : "não é letra" }),
          el("td", { text: shiftText(s, ctx) }),
          el("td", { text: s.is_letter ? `${s.shifted_index} (${letterOf(s.shifted_index)})` : "—" }),
          el("td", { class: "cstep__out", text: s.out === " " ? "␣" : s.out === "\n" ? "↵" : s.out }),
        ),
      ),
    ),
  );
  // Sem null na lista: replaceChildren(null) do navegador vira o texto "null".
  return [
    el("div", { class: "cstep__scroll", tabindex: "0", role: "region", "aria-label": "Tabela do passo a passo" }, table),
    hidden ? el("p", { class: "muted cstep__more", text: `Mais ${hidden} caracteres seguem a mesma regra.` }) : null,
  ].filter(Boolean);
}

/** Réguas alinhadas (acessível) + roda (decorativa). */
export function alphabetRows(shift) {
  const pairs = alphabetRow(shift);
  return el(
    "table",
    { class: "abc", "data-alphabet": "" },
    el("caption", { class: "visually-hidden", text: `Alfabeto com deslocamento ${clampShift(shift)}` }),
    el("tbody", {},
      el("tr", {}, el("th", { scope: "row", text: "Normal" }), pairs.map((p) => el("td", { text: p.plain }))),
      el("tr", { class: "abc__cipher" }, el("th", { scope: "row", text: "Cifrado" }), pairs.map((p) => el("td", { text: p.cipher })))),
  );
}

export function wheel() {
  const ring = (cls) =>
    el("div", { class: `wheel__ring ${cls}` }, [...LETTERS].map((c, i) => el("span", { class: "wheel__letter", style: `--i:${i}`, text: c })));
  const outer = ring("wheel__ring--plain");
  const inner = ring("wheel__ring--cipher");
  const node = el("div", { class: "wheel", "aria-hidden": "true" }, outer, inner, el("span", { class: "wheel__pointer" }), el("span", { class: "wheel__spot" }));
  return {
    node,
    set(shift) {
      // gira o anel interno: a letra (0 + k) fica embaixo do "A" do anel externo
      inner.setAttribute("style", `--turn:${-clampShift(shift)}`);
      node.setAttribute("data-shift", String(clampShift(shift)));
    },
  };
}

// ---------- página ----------

export async function initCryptoPage(root = globalThis.document.getElementById("cripto"), opts = {}) {
  if (!root) return;
  const getUser = opts.getUser || sessionUser;
  const sched = { setTimeout: opts.setTimeout, clearTimeout: opts.clearTimeout };
  const q = (sel, base = root) => base.querySelector(sel);

  // ---------- abas ----------
  const tabs = root.querySelectorAll('[role="tab"]');
  function activate(key, { focus = false } = {}) {
    tabs.forEach((tab) => {
      const on = tab.getAttribute("data-tab") === key;
      tab.setAttribute("aria-selected", on ? "true" : "false");
      tab.setAttribute("tabindex", on ? "0" : "-1");
      const panel = q(`#${tab.getAttribute("aria-controls")}`);
      if (panel) panel.hidden = !on;
      if (on && focus) tab.focus();
    });
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

  // ---------- comum às cifras clássicas ----------
  function classicPanel(panel, cipher, params) {
    const form = q("form", panel);
    const text = q('[name="text"]', form);
    const counter = q("[data-counter]", panel);
    const status = q("[data-status]", panel);
    const result = q("[data-result]", panel);
    const resultBox = q("[data-result-box]", panel);
    const stepsSlot = q("[data-steps]", panel);
    const candSlot = q("[data-candidates]", panel);
    const st = { action: "encrypt", req: 0 };

    const say = (msg, tone = "") => {
      status.textContent = msg;
      status.className = `demo__status${tone ? ` demo__status--${tone}` : ""}`;
    };

    function updateCounter() {
      if (counter) counter.textContent = `${charCount(text.value)}/${MAX_TEXT}`;
    }

    async function run(action, button) {
      const value = text.value;
      if (!value.trim()) {
        say("Digite um texto para começar.");
        return;
      }
      const extra = params();
      if (extra === null) return;
      st.action = action === "bruteforce" ? st.action : action;
      const req = ++st.req;
      setBusy(button, true);
      panel.setAttribute("aria-busy", "true");
      try {
        const data = await api.post("/api/crypto/demo", { cipher, action, text: value, ...extra });
        if (req !== st.req) return;
        if (action === "bruteforce") {
          renderCandidates(data);
          say(`Pronto: ${data?.candidates?.length || 0} tentativas, uma para cada deslocamento.`, "ok");
          return;
        }
        result.textContent = data?.result ?? "";
        resultBox.hidden = false;
        resultBox.setAttribute("data-action", action);
        q("[data-result-label]", panel).textContent = action === "decrypt" ? "Texto decifrado" : "Texto cifrado";
        stepsSlot.replaceChildren(...stepsTable(data?.steps, { cipher, action, shift: extra.shift }));
        candSlot?.replaceChildren();
        say(action === "decrypt" ? "Texto decifrado." : "Texto cifrado.", "ok");
      } catch (err) {
        if (req !== st.req) return;
        say(errorMessage(err), "error");
      } finally {
        setBusy(button, false);
        panel.removeAttribute("aria-busy");
      }
    }

    function renderCandidates(data) {
      const list = Array.isArray(data?.candidates) ? data.candidates : [];
      const best = bestCandidate(list);
      candSlot.replaceChildren(
        el("h3", { class: "demo__subtitle", text: "Força bruta: as 25 chaves possíveis" }),
        el("p", { class: "muted", text: `Com só 25 chaves, basta testar todas. A mais parecida com português (pela frequência das letras) vem destacada${best ? `: deslocamento ${best.shift}` : ""}.` }),
        el(
          "ol",
          { class: "brute", "data-brute": "" },
          list.map((c) =>
            el(
              "li",
              { class: `brute__item${best && c.shift === best.shift ? " is-best" : ""}`, "data-shift": String(c.shift) },
              el("span", { class: "brute__k", text: `k = ${c.shift}` }),
              el("span", { class: "brute__text", text: c.text }),
              best && c.shift === best.shift ? el("span", { class: "badge", text: "mais provável" }) : null,
            ),
          ),
        ),
      );
    }

    const auto = debounce(() => {
      if (text.value.trim() && params() !== null) run(st.action, null);
    }, DEBOUNCE_MS, sched);

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      auto.cancel();
      run("encrypt", q('[data-action="encrypt"]', form));
    });
    for (const action of ["decrypt", "bruteforce"]) {
      q(`[data-action="${action}"]`, form)?.addEventListener("click", (event) => {
        auto.cancel();
        run(action, event.target?.closest ? event.target.closest("button") : event.target);
      });
    }
    text.addEventListener("input", () => {
      updateCounter();
      auto();
    });
    const copySlot = q("[data-copy-slot]", panel);
    copySlot?.replaceChildren(copyButton(() => result.textContent, { label: "Copiar resultado" }));
    updateCounter();
    return { run, auto, state: st, say };
  }

  // ---------- César ----------
  const cesar = q("#cripto-cesar");
  if (cesar) {
    const range = q('[name="shift"]', cesar);
    const shownValue = q("[data-shift-value]", cesar);
    const wheelSlot = q("[data-wheel]", cesar);
    const abcSlot = q("[data-alphabet-slot]", cesar);
    const w = wheel();
    wheelSlot?.replaceChildren(w.node);
    if (prefersReducedMotion()) w.node.classList.add("wheel--still");
    const shift = () => clampShift(range.value);
    const panel = classicPanel(cesar, "caesar", () => ({ shift: shift() }));
    function drawShift() {
      const k = shift();
      range.value = String(k);
      range.setAttribute("aria-valuetext", `${k}: A vira ${LETTERS[k]}`);
      if (shownValue) shownValue.textContent = `${k}  (A → ${LETTERS[k]})`;
      w.set(k);
      abcSlot?.replaceChildren(alphabetRows(k));
    }
    range.addEventListener("input", () => {
      drawShift();
      panel.auto();
    });
    q("[data-shift-dec]", cesar)?.addEventListener("click", () => {
      range.value = String(clampShift(shift() - 1));
      drawShift();
      panel.auto();
    });
    q("[data-shift-inc]", cesar)?.addEventListener("click", () => {
      range.value = String(clampShift(shift() + 1));
      drawShift();
      panel.auto();
    });
    drawShift();
  }

  // ---------- Vigenère ----------
  const vig = q("#cripto-vigenere");
  if (vig) {
    const keyInput = q('[name="key"]', vig);
    const keyError = q("[data-key-error]", vig);
    const panel = classicPanel(vig, "vigenere", () => {
      const key = keyInput.value.trim();
      const ok = /^[A-Za-z]{1,32}$/.test(key);
      if (!ok) keyInput.setAttribute("aria-invalid", "true");
      else keyInput.removeAttribute("aria-invalid");
      if (keyError) {
        keyError.textContent = ok ? "" : "Use de 1 a 32 letras de A a Z, sem acento nem espaço.";
        keyError.hidden = ok;
      }
      return ok ? { key } : null;
    });
    keyInput.addEventListener("input", () => panel.auto());
  }

  // ---------- Fernet ----------
  const fer = q("#cripto-fernet");
  if (fer) {
    const form = q("form", fer);
    const plain = q('[name="text"]', fer);
    const token = q('[name="token"]', fer);
    const counter = q("[data-counter]", fer);
    const status = q("[data-status]", fer);
    const anatomySlot = q("[data-anatomy-slot]", fer);
    const result = q("[data-result]", fer);
    const resultBox = q("[data-result-box]", fer);
    const st = { req: 0 };
    const say = (msg, tone = "") => {
      status.textContent = msg;
      status.className = `demo__status${tone ? ` demo__status--${tone}` : ""}`;
    };
    q("[data-copy-slot]", fer)?.replaceChildren(copyButton(() => token.value, { label: "Copiar token" }));

    function showAnatomy(data, value, title) {
      anatomySlot.replaceChildren(anatomyView(data?.anatomy, value, { title }));
    }

    async function call(action, body, button) {
      const req = ++st.req;
      setBusy(button, true);
      fer.setAttribute("aria-busy", "true");
      try {
        const data = await api.post("/api/crypto/demo", { cipher: "fernet", action, ...body });
        if (req !== st.req) return null;
        return data;
      } catch (err) {
        if (req !== st.req) return null;
        say(errorMessage(err), "error");
        if (action === "decrypt") {
          resultBox.hidden = false;
          resultBox.setAttribute("data-state", "fail");
          result.textContent = "Token rejeitado. Nada foi decifrado.";
        }
        return null;
      } finally {
        setBusy(button, false);
        fer.removeAttribute("aria-busy");
      }
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!plain.value.trim()) return say("Digite um texto para cifrar.");
      const data = await call("encrypt", { text: plain.value }, q('[data-action="encrypt"]', fer));
      if (!data) return;
      token.value = data.result || "";
      showAnatomy(data, token.value, "Anatomia do token");
      resultBox.hidden = true;
      say("Token gerado. Cifre de novo e veja: o IV e o timestamp mudam, então o token sai outro.", "ok");
    });

    q('[data-action="decrypt"]', fer)?.addEventListener("click", async (event) => {
      if (!token.value.trim()) return say("Gere ou cole um token primeiro.");
      const data = await call("decrypt", { text: token.value }, event.target?.closest?.("button") || event.target);
      if (!data) return;
      result.textContent = data.result ?? "";
      resultBox.hidden = false;
      resultBox.setAttribute("data-state", "ok");
      showAnatomy(data, token.value.trim(), "Anatomia do token");
      say("HMAC conferido e texto decifrado com a chave da demonstração.", "ok");
    });

    q('[data-action="tamper"]', fer)?.addEventListener("click", async (event) => {
      if (!token.value.trim()) return say("Gere um token primeiro.");
      const data = await call("tamper", { text: token.value }, event.target?.closest?.("button") || event.target);
      if (!data) return;
      token.value = data.result || "";
      showAnatomy(data, token.value, "Anatomia do token adulterado");
      const mark = anatomySlot.querySelector(".anatomy--ciphertext");
      mark?.classList.add("is-tampered");
      resultBox.hidden = false;
      resultBox.setAttribute("data-state", "fail");
      result.textContent = data.decrypt_ok ? "Inesperado: o token adulterado foi aceito." : "Decifrar falhou: o HMAC não confere.";
      say(`Trocamos 1 bit do texto cifrado (caractere ${Number(data.changed_at) + 1} do token). O Fernet recusa o token inteiro: a adulteração é detectada.`, "warn");
    });

    plain.addEventListener("input", () => {
      if (counter) counter.textContent = `${charCount(plain.value)}/${MAX_TEXT}`;
    });
  }

  // ---------- seus dados ----------
  const mine = q("[data-my-data]");
  if (!mine) return;
  let user = null;
  try {
    user = await getUser();
  } catch {
    user = null;
  }
  if (!user) {
    mine.replaceChildren(
      el("p", { class: "muted" }, "Entre na sua conta para ver como seus pedidos ficam guardados. ", el("a", { href: `/entrar/?next=${encodeURIComponent("/criptografia/")}` }, "Entrar")),
    );
    return;
  }
  if (user.is_staff) {
    mine.replaceChildren(
      el("p", { class: "muted" }, "Na aba Criptografia do painel você vê o token cru de cada pedido, a anatomia e o botão Descriptografar (auditado). ", el("a", { href: "/painel/#cripto" }, "Abrir a aba Criptografia")),
    );
    return;
  }
  mine.setAttribute("aria-busy", "true");
  try {
    const data = await api.get("/api/bookings");
    const list = (Array.isArray(data?.bookings) ? data.bookings : []).slice(0, 5);
    if (!list.length) {
      mine.replaceChildren(el("p", { class: "muted" }, "Você ainda não tem pedidos. Quando fizer um, o contato aparece aqui do jeito que fica no banco. ", el("a", { href: "/reservar/" }, "Reservar horário")));
      return;
    }
    mine.replaceChildren(
      el(
        "ul",
        { class: "mine", "aria-label": "Seus pedidos e como ficam guardados" },
        list.map((b) =>
          el(
            "li",
            { class: "mine__item", "data-booking-id": String(b.id) },
            el("p", { class: "mine__head" }, el("strong", { text: b.field?.name || "Campo" }), " ", el("span", { class: "muted", text: `${formatDayLong(b.start)}, ${formatTimeRange(b.start, b.end)}` }), " ", statusBadge(b.status, b.status_label)),
            ...bookingTokens(b, { compact: true }),
          ),
        ),
      ),
    );
  } catch (err) {
    mine.replaceChildren(el("p", { class: "muted", role: "alert", text: errorMessage(err) }));
  } finally {
    mine.removeAttribute("aria-busy");
  }
}
