import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { api, ApiError } from "../api.js";

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h) => (h.toLowerCase() === "content-type" && body !== undefined ? "application/json" : null) },
    json: async () => body,
    text: async () => (body === undefined ? "" : JSON.stringify(body)),
  };
}

let calls;

beforeEach(() => {
  calls = [];
  globalThis.document = { cookie: "csrftoken=tok123; outro=1" };
});

test("post sends X-CSRFToken from cookie, JSON body and same-origin credentials", async () => {
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return jsonResponse(200, { ok: true });
  };
  const data = await api.post("/api/auth/login", { email: "a@b.com" });
  assert.deepEqual(data, { ok: true });
  assert.equal(calls.length, 1);
  const { url, opts } = calls[0];
  assert.equal(url, "/api/auth/login");
  assert.equal(opts.method, "POST");
  assert.equal(opts.credentials, "same-origin");
  assert.equal(opts.headers["X-CSRFToken"], "tok123");
  assert.equal(opts.headers["Content-Type"], "application/json");
  assert.equal(opts.body, JSON.stringify({ email: "a@b.com" }));
});

test("fetches /api/csrf first when cookie is missing", async () => {
  globalThis.document = { cookie: "" };
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    if (url === "/api/csrf") {
      globalThis.document.cookie = "csrftoken=fresh";
      return jsonResponse(204);
    }
    return jsonResponse(204);
  };
  const data = await api.del("/api/admin/blocks/3");
  assert.equal(data, null);
  assert.deepEqual(calls.map((c) => c.url), ["/api/csrf", "/api/admin/blocks/3"]);
  assert.equal(calls[1].opts.method, "DELETE");
  assert.equal(calls[1].opts.headers["X-CSRFToken"], "fresh");
});

test("get builds query string and skips empty params", async () => {
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return jsonResponse(200, []);
  };
  await api.get("/api/availability", { field: 2, date: "2026-10-20", x: null });
  assert.equal(calls[0].url, "/api/availability?field=2&date=2026-10-20");
  assert.equal(calls[0].opts.method, "GET");
  assert.equal(calls[0].opts.credentials, "same-origin");
});

test("HTTP error becomes ApiError with code, status, fields and message", async () => {
  globalThis.fetch = async () =>
    jsonResponse(409, {
      error: { code: "slot_taken", message: "Horário já reservado.", fields: { start: "Ocupado." } },
    });
  await assert.rejects(api.post("/api/bookings", {}), (err) => {
    assert.ok(err instanceof ApiError);
    assert.ok(err instanceof Error);
    assert.equal(err.status, 409);
    assert.equal(err.code, "slot_taken");
    assert.equal(err.message, "Horário já reservado.");
    assert.deepEqual(err.fields, { start: "Ocupado." });
    return true;
  });
});

test("HTTP error without contract body still becomes ApiError", async () => {
  globalThis.fetch = async () => ({
    ok: false,
    status: 500,
    headers: { get: () => "text/html" },
    json: async () => { throw new Error("not json"); },
    text: async () => "<h1>erro</h1>",
  });
  await assert.rejects(api.get("/api/fields"), (err) => {
    assert.ok(err instanceof ApiError);
    assert.equal(err.status, 500);
    assert.equal(err.code, "server_error");
    assert.deepEqual(err.fields, {});
    assert.ok(err.message.length > 0);
    return true;
  });
});

test("network failure becomes ApiError status 0 code network", async () => {
  globalThis.fetch = async () => {
    throw new TypeError("Failed to fetch");
  };
  await assert.rejects(api.get("/api/fields"), (err) => {
    assert.ok(err instanceof ApiError);
    assert.equal(err.status, 0);
    assert.equal(err.code, "network");
    return true;
  });
});
