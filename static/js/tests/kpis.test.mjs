import { test } from "node:test";
import assert from "node:assert/strict";

import { installFakeDom, h } from "./fake-dom.mjs";
import { mockFetch, flush } from "./fake-api.mjs";
import { api, ApiError } from "../api.js";
import { formatPercent, formatHours, formatCount, kpiItems, createKpis } from "../kpis.js";

const STATS = { pending: 3, approved_next7: 4, booked_hours_next7: 9.5, occupancy_next7: 37.5, lost_last30: 2, revenue_next7: "1425.00" };

test("pt-BR formatting helpers", () => {
  assert.equal(formatPercent(37.5), "37,5%");
  assert.equal(formatPercent(0), "0%");
  assert.equal(formatPercent(120), "100%");
  assert.equal(formatPercent(null), "—");
  assert.equal(formatPercent("abc"), "—");
  assert.equal(formatHours(12), "12 h");
  assert.equal(formatHours(1.5), "1,5 h");
  assert.equal(formatHours(undefined), "—");
  assert.equal(formatCount(1234), "1.234");
  assert.equal(formatCount(2.5), "—");
});

test("kpiItems formats all six indicators", () => {
  const items = kpiItems(STATS);
  assert.deepEqual(items.map((i) => i.text), ["3", "4", "9,5 h", "37,5%", "2", "R$ 1.425,00"]);
  assert.match(items[5].label, /estimada/);
  assert.ok(kpiItems(null).every((i) => i.text === "—"));
});

function page() {
  installFakeDom();
  const root = h("section", { "data-kpis": true }, h("ul", { "data-kpi-grid": true }), h("p", { "data-kpi-live": true }));
  globalThis.document.body.append(root);
  return root;
}

test("createKpis renders cards, passes the field filter and announces refresh", async () => {
  const root = page();
  const calls = mockFetch(async () => [200, STATS]);
  const k = createKpis({ root, api, ApiError, guard: () => false, field: () => "2" });
  const pending = k.load();
  assert.equal(root.querySelectorAll(".kpi--loading").length, 6, "skeleton while loading");
  await pending;
  assert.equal(calls[0].path, "/api/admin/stats");
  assert.equal(calls[0].query.field, "2");
  assert.equal(root.querySelectorAll(".kpi").length, 6);
  assert.match(root.textContent, /37,5%/);
  assert.match(root.textContent, /R\$ 1\.425,00/);
  assert.match(root.querySelector("[data-kpi-live]").textContent, /Indicadores atualizados/);
  assert.equal(root.querySelector(".kpi__fill").getAttribute("style"), "width:37.5%");
});

test("createKpis shows an error with retry, and guard handles 403", async () => {
  const root = page();
  let fail = true;
  mockFetch(async () => (fail ? [500, { error: { code: "x", message: "Falhou feio." } }] : [200, STATS]));
  const k = createKpis({ root, api, ApiError, guard: () => false });
  await k.load();
  assert.match(root.textContent, /Falhou feio\./);
  fail = false;
  root.querySelector("[data-retry]").click();
  await flush();
  assert.equal(root.querySelectorAll(".kpi").length, 6);

  const root2 = page();
  mockFetch(async () => [403, { error: { code: "forbidden", message: "no" } }]);
  let guarded = 0;
  const k2 = createKpis({ root: root2, api, ApiError, guard: () => ++guarded > 0 });
  await k2.load();
  assert.equal(guarded, 1);
  assert.equal(root2.querySelectorAll(".kpi--error").length, 0, "denied is handled by the panel, not as an error card");
});
