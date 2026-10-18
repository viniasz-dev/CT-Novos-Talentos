// Fetch fake por rota + utilidades assíncronas para os testes de DOM.
import { setToastScheduler } from "../ui.js";

// Toasts guardam o agendamento sem disparar: nenhum timer real segura o processo de teste.
export const toastTimers = [];
setToastScheduler((fn, ms) => toastTimers.push({ fn, ms }));

export function respond(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => (body === undefined ? "text/html" : "application/json") },
    json: async () => body,
  };
}

/**
 * Instala um fetch que consulta `handler({method, url, path, query, body})`.
 * O handler devolve `[status, body]` ou lança (simula rede fora do ar).
 */
export function mockFetch(handler) {
  const calls = [];
  globalThis.document.cookie = "csrftoken=tok";
  globalThis.fetch = async (url, opts = {}) => {
    const parsed = new URL(url, "http://test");
    const call = {
      method: opts.method || "GET",
      url,
      path: parsed.pathname,
      query: Object.fromEntries(parsed.searchParams),
      body: opts.body ? JSON.parse(opts.body) : undefined,
    };
    calls.push(call);
    const [status, body] = await handler(call);
    return respond(status, body);
  };
  return calls;
}

/** Espera as promessas pendentes (várias voltas no loop de eventos). */
export async function flush(times = 6) {
  for (let i = 0; i < times; i += 1) await new Promise((r) => setTimeout(r, 0));
}

export function fakeLocation(search = "", pathname = "/") {
  return {
    search,
    pathname,
    assigned: [],
    assign(url) {
      this.assigned.push(url);
    },
    replace(url) {
      this.assigned.push(url);
    },
  };
}
