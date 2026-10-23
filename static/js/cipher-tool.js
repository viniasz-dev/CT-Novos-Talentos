// Ferramenta didática de criptografia (/criptografia/): César, Substituição, Transposição e Vigenère.
// A cifra roda no servidor (POST /api/crypto/demo); aqui há só interface. Texto da API entra por textContent.
import { api, ApiError } from "./api.js";
import { el, setBusy, toast } from "./ui.js";
import { copyText } from "./cipher-view.js";

const NEEDS_KEY = new Set(["substitution", "transposition", "vigenere"]);
const TEXT_MAX = 500;

export function initCipherTool(root = globalThis.document) {
  const form = root.querySelector("[data-cipher-form]");
  if (!form) return;
  const method = form.querySelector("[data-cipher-method]");
  const shiftField = form.querySelector("[data-field-shift]");
  const keyField = form.querySelector("[data-field-key]");
  const shiftInput = form.querySelector('[name="shift"]');
  const keyInput = form.querySelector('[name="key"]');
  const textInput = form.querySelector('[name="text"]');
  const counter = form.querySelector("[data-cipher-counter]");
  const errorBox = form.querySelector("[data-cipher-error]");
  const out = root.querySelector("[data-cipher-out]");
  const resultBox = root.querySelector("[data-cipher-result]");
  const detail = root.querySelector("[data-cipher-detail]");

  function syncFields() {
    const needsKey = NEEDS_KEY.has(method.value);
    shiftField.hidden = needsKey;
    keyField.hidden = !needsKey;
  }

  function clearErrors() {
    errorBox.hidden = true;
    errorBox.textContent = "";
    for (const p of form.querySelectorAll("[data-error-for]")) {
      p.hidden = true;
      p.textContent = "";
    }
  }

  function showErrors(err) {
    const fields = err instanceof ApiError ? err.fields || {} : {};
    let shown = false;
    for (const [name, message] of Object.entries(fields)) {
      const p = form.querySelector(`[data-error-for="${name}"]`);
      if (p) {
        p.textContent = String(message);
        p.hidden = false;
        shown = true;
      }
    }
    if (!shown) {
      errorBox.textContent = err instanceof ApiError ? err.message : "Não foi possível processar agora. Tente de novo.";
      errorBox.hidden = false;
    }
  }

  function updateCounter() {
    counter.textContent = `${textInput.value.length}/${TEXT_MAX}`;
  }

  // Passo a passo: uma tabela por método (letra, posição, nova posição, resultado).
  function stepsTable(steps) {
    const head = ["Letra", "Posição", "Nova posição", "Resultado"];
    const rows = steps
      .filter((s) => s.is_letter)
      .map((s) => el("tr", {}, el("td", { text: s.char }), el("td", { text: String(s.index + 1) }), el("td", { text: String(s.shifted_index + 1) }), el("td", { text: s.out })));
    if (!rows.length) return null;
    return el(
      "div",
      { class: "prose__table-wrap" },
      el("table", { class: "prose__table" }, el("caption", { class: "visually-hidden", text: "Passo a passo" }), el("thead", {}, el("tr", {}, ...head.map((h) => el("th", { scope: "col", text: h })))), el("tbody", {}, ...rows)),
    );
  }

  function gridTable(grid) {
    const letters = grid.key.split("");
    const header = el("tr", {}, ...letters.map((c, i) => el("th", { scope: "col", text: `${c} (${grid.order[i]})` })));
    const rows = grid.rows.map((r) => el("tr", {}, ...letters.map((_, i) => el("td", { text: r[i] === " " ? "·" : r[i] || "" }))));
    return el(
      "div",
      { class: "prose__table-wrap" },
      el("p", { class: "muted", text: "O texto é escrito em linhas. Os números mostram a ordem em que as colunas são lidas. Espaços aparecem como ponto." }),
      el("table", { class: "prose__table" }, el("caption", { class: "visually-hidden", text: "Tabela da transposição" }), el("thead", {}, header), el("tbody", {}, ...rows)),
    );
  }

  function render(data, cipher) {
    resultBox.textContent = data.result;
    detail.replaceChildren();
    if (cipher === "transposition" && data.grid) detail.append(gridTable(data.grid));
    else {
      if (cipher === "substitution" && data.alphabet) {
        detail.append(
          el("p", { class: "muted", text: "Alfabeto normal:  ABCDEFGHIJKLMNOPQRSTUVWXYZ" }),
          el("p", { class: "muted", text: `Alfabeto cifrado: ${data.alphabet}` }),
        );
      }
      const table = data.steps ? stepsTable(data.steps) : null;
      if (table) detail.append(table);
    }
    out.hidden = false;
  }

  async function run(action, button) {
    clearErrors();
    const cipher = method.value;
    const body = { cipher, action, text: textInput.value };
    if (NEEDS_KEY.has(cipher)) body.key = keyInput.value.trim();
    else body.shift = Number(shiftInput.value);
    setBusy(button, true);
    try {
      render(await api.post("/api/crypto/demo", body), cipher);
    } catch (err) {
      out.hidden = true;
      showErrors(err);
    } finally {
      setBusy(button, false);
    }
  }

  method.addEventListener("change", syncFields);
  textInput.addEventListener("input", updateCounter);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const button = event.submitter || form.querySelector("[data-action]");
    run(button.dataset.action, button);
  });
  form.querySelector("[data-cipher-clear]").addEventListener("click", () => {
    form.reset();
    syncFields();
    updateCounter();
    clearErrors();
    out.hidden = true;
  });
  root.querySelector("[data-cipher-copy]").addEventListener("click", async () => {
    const ok = await copyText(resultBox.textContent);
    toast(ok ? "Resultado copiado." : "Não deu para copiar. Selecione o texto e copie manualmente.", ok ? "success" : "error");
  });
  for (const button of root.querySelectorAll("[data-example]")) {
    button.addEventListener("click", () => {
      method.value = button.dataset.cipher;
      if (button.dataset.shift) shiftInput.value = button.dataset.shift;
      if (button.dataset.key) keyInput.value = button.dataset.key;
      textInput.value = button.dataset.text;
      syncFields();
      updateCounter();
      clearErrors();
      form.scrollIntoView?.({ behavior: "smooth", block: "center" });
    });
  }
  syncFields();
  updateCounter();
}
