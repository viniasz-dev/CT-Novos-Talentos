// Cliente JSON da API do CT Novos Talentos.
// Sessão + CSRF (cookie `csrftoken` -> cabeçalho `X-CSRFToken`). Nada vai para storage.

export class ApiError extends Error {
  constructor(status, code, message, fields = {}) {
    super(message || "Não foi possível concluir a ação. Tente de novo.");
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = fields || {};
  }
}

const SAFE_METHODS = new Set(["GET", "HEAD"]);

const DEFAULT_MESSAGES = {
  0: "Sem conexão com o servidor. Verifique sua internet e tente de novo.",
  401: "Entre na sua conta para continuar.",
  403: "Você não tem permissão para esta ação.",
  404: "Não encontramos o que você procurou.",
  429: "Muitas tentativas. Aguarde alguns minutos e tente de novo.",
};

function readCookie(name) {
  const raw = globalThis.document?.cookie || "";
  for (const part of raw.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

async function csrfToken() {
  let token = readCookie("csrftoken");
  if (token) return token;
  try {
    await globalThis.fetch("/api/csrf", { method: "GET", credentials: "same-origin" });
  } catch {
    throw new ApiError(0, "network", DEFAULT_MESSAGES[0]);
  }
  return readCookie("csrftoken");
}

function withParams(path, params) {
  if (!params) return path;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") continue;
    query.append(key, String(value));
  }
  const qs = query.toString();
  if (!qs) return path;
  return path + (path.includes("?") ? "&" : "?") + qs;
}

async function parseBody(response) {
  if (response.status === 204) return null;
  const type = response.headers?.get?.("content-type") || "";
  if (!type.includes("application/json")) return undefined;
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

async function request(method, path, { params, body } = {}) {
  const headers = { Accept: "application/json" };
  const opts = { method, credentials: "same-origin", headers };
  if (!SAFE_METHODS.has(method)) {
    headers["X-CSRFToken"] = await csrfToken();
  }
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await globalThis.fetch(withParams(path, params), opts);
  } catch {
    throw new ApiError(0, "network", DEFAULT_MESSAGES[0]);
  }

  const data = await parseBody(response);
  if (response.ok) return data === undefined ? null : data;

  const err = data && typeof data === "object" ? data.error : null;
  if (err && typeof err === "object") {
    throw new ApiError(
      response.status,
      err.code || "error",
      err.message || DEFAULT_MESSAGES[response.status],
      err.fields || {},
    );
  }
  throw new ApiError(
    response.status,
    response.status >= 500 ? "server_error" : "http_error",
    DEFAULT_MESSAGES[response.status] ||
      (response.status >= 500
        ? "O servidor teve um problema. Tente de novo em instantes."
        : "Não foi possível concluir a ação. Tente de novo."),
  );
}

export const api = {
  get: (path, params) => request("GET", path, { params }),
  post: (path, body) => request("POST", path, { body: body === undefined ? {} : body }),
  del: (path) => request("DELETE", path),
};
