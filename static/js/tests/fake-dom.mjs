// Minimal DOM fake for node tests: enough for el(), loadFields() and initMenu().
// Supports selectors: "#id", "tag", ".class", "[attr]", "[attr=\"v\"]", "tag[attr=\"v\"]",
// combinations of those in one compound (no descendant combinator), and comma lists.

function parseSimple(selector) {
  const m = selector
    .trim()
    .match(/^([a-z][a-z0-9-]*)?(?:#([\w-]+))?((?:\.[\w-]+)*)(?:\[([\w-]+)(?:="([^"]*)")?\])?$/i);
  if (!m) throw new Error(`fake-dom: unsupported selector ${selector}`);
  const [, tag, id, classes, attr, value] = m;
  const classNames = (classes || "").split(".").filter(Boolean);
  return (node) =>
    node instanceof FakeElement &&
    (!tag || node.tagName === tag.toUpperCase()) &&
    (!id || node.getAttribute("id") === id) &&
    classNames.every((c) => node.classList.contains(c)) &&
    (!attr || (node.hasAttribute(attr) && (value === undefined || node.getAttribute(attr) === value)));
}

function matcher(selector) {
  const parts = selector.split(",").map(parseSimple);
  return (node) => parts.some((p) => p(node));
}

class FakeText {
  constructor(text) {
    this.textContent = text;
    this.parentNode = null;
  }
  cloneNode() {
    return new FakeText(this.textContent);
  }
}

class FakeFragment {
  constructor() {
    this.childNodes = [];
  }
  append(...nodes) {
    for (const n of nodes) {
      n.parentNode = this;
      this.childNodes.push(n);
    }
  }
  cloneNode() {
    const f = new FakeFragment();
    f.append(...this.childNodes.map((c) => c.cloneNode(true)));
    return f;
  }
}

class FakeClassList {
  constructor(el) {
    this.el = el;
  }
  get _set() {
    return new Set((this.el.getAttribute("class") || "").split(/\s+/).filter(Boolean));
  }
  _write(set) {
    this.el.setAttribute("class", [...set].join(" "));
  }
  add(...names) {
    const s = this._set;
    names.forEach((n) => s.add(n));
    this._write(s);
  }
  remove(...names) {
    const s = this._set;
    names.forEach((n) => s.delete(n));
    this._write(s);
  }
  toggle(name, force) {
    const s = this._set;
    const on = force === undefined ? !s.has(name) : Boolean(force);
    if (on) s.add(name);
    else s.delete(name);
    this._write(s);
    return on;
  }
  contains(name) {
    return this._set.has(name);
  }
}

// Como o NodeList real: tem length, índice, forEach e iteração, mas NÃO tem
// filter/map/some/find. Assim os testes pegam código que esquece Array.from.
export class FakeNodeList {
  constructor(items) {
    items.forEach((item, i) => {
      this[i] = item;
    });
    Object.defineProperty(this, "length", { value: items.length });
  }
  item(i) {
    return this[i] ?? null;
  }
  forEach(fn, thisArg) {
    for (let i = 0; i < this.length; i += 1) fn.call(thisArg, this[i], i, this);
  }
  *[Symbol.iterator]() {
    for (let i = 0; i < this.length; i += 1) yield this[i];
  }
}

export class FakeElement {
  constructor(tag, doc) {
    this.tagName = tag.toUpperCase();
    this.ownerDocument = doc;
    this.attributes = new Map();
    this.childNodes = [];
    this.parentNode = null;
    this.listeners = {};
    this.classList = new FakeClassList(this);
    this.dataset = new Proxy(
      {},
      {
        get: (_, k) => this.getAttribute(`data-${String(k).replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}`) ?? undefined,
        set: (_, k, v) => {
          this.setAttribute(`data-${String(k).replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}`, v);
          return true;
        },
      },
    );
    if (this.tagName === "TEMPLATE") this.content = new FakeFragment();
  }
  get id() {
    return this.getAttribute("id") || "";
  }
  get className() {
    return this.getAttribute("class") || "";
  }
  set className(v) {
    this.setAttribute("class", v);
  }
  get hidden() {
    return this.hasAttribute("hidden");
  }
  set hidden(v) {
    if (v) this.setAttribute("hidden", "");
    else this.removeAttribute("hidden");
  }
  setAttribute(k, v) {
    this.attributes.set(k, String(v));
  }
  getAttribute(k) {
    return this.attributes.has(k) ? this.attributes.get(k) : null;
  }
  hasAttribute(k) {
    return this.attributes.has(k);
  }
  removeAttribute(k) {
    this.attributes.delete(k);
  }
  get children() {
    return this.childNodes.filter((c) => c instanceof FakeElement);
  }
  get textContent() {
    return this.childNodes.map((c) => c.textContent).join("");
  }
  set textContent(v) {
    this.childNodes = [];
    if (v !== "") this.append(new FakeText(String(v)));
  }
  append(...nodes) {
    for (const n of nodes) {
      // Como no navegador: o que não é nó (inclusive null) vira texto ("null").
      const node = n instanceof FakeElement || n instanceof FakeText || n instanceof FakeFragment ? n : new FakeText(String(n));
      if (node instanceof FakeFragment) {
        this.append(...node.childNodes);
        continue;
      }
      if (node.parentNode && node.parentNode !== this && node.parentNode.childNodes) {
        node.parentNode.childNodes = node.parentNode.childNodes.filter((c) => c !== node);
      }
      node.parentNode = this;
      this.childNodes.push(node);
    }
  }
  replaceChildren(...nodes) {
    this.childNodes = [];
    this.append(...nodes);
  }
  remove() {
    if (this.parentNode) this.parentNode.childNodes = this.parentNode.childNodes.filter((c) => c !== this);
    this.parentNode = null;
  }
  cloneNode(deep) {
    const c = new FakeElement(this.tagName, this.ownerDocument);
    for (const [k, v] of this.attributes) c.setAttribute(k, v);
    if (deep) c.append(...this.childNodes.map((n) => n.cloneNode(true)));
    if (this.content) c.content = this.content.cloneNode(true);
    return c;
  }
  *_descendants() {
    for (const c of this.childNodes) {
      if (c instanceof FakeElement) {
        yield c;
        yield* c._descendants();
      }
    }
  }
  querySelectorAll(selector) {
    const m = matcher(selector);
    return new FakeNodeList([...this._descendants()].filter(m));
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
  closest(selector) {
    const m = matcher(selector);
    let n = this;
    while (n instanceof FakeElement) {
      if (m(n)) return n;
      n = n.parentNode;
    }
    return null;
  }
  addEventListener(type, fn, opts) {
    (this.listeners[type] ||= []).push({ fn, once: Boolean(opts && opts.once) });
  }
  dispatch(type, extra = {}) {
    const event = { type, target: this, preventDefault() {}, ...extra };
    const list = this.listeners[type] || [];
    this.listeners[type] = list.filter((l) => !l.once);
    for (const l of list) l.fn(event);
    return event;
  }
  click() {
    return this.dispatch("click");
  }
  focus() {
    this.ownerDocument.activeElement = this;
  }
}

export function installFakeDom() {
  const doc = {
    cookie: "",
    activeElement: null,
    listeners: {},
    createElement: (tag) => new FakeElement(tag, doc),
    createTextNode: (text) => new FakeText(text),
    getElementById: (id) => doc.documentElement.querySelector(`#${id}`),
    querySelector: (s) => doc.documentElement.querySelector(s),
    querySelectorAll: (s) => doc.documentElement.querySelectorAll(s),
    addEventListener(type, fn) {
      (doc.listeners[type] ||= []).push(fn);
    },
  };
  doc.documentElement = new FakeElement("html", doc);
  doc.body = new FakeElement("body", doc);
  doc.documentElement.append(doc.body);
  globalThis.document = doc;
  globalThis.CSS = { escape: (s) => String(s).replace(/["\\]/g, "\\$&") };
  return doc;
}

/** Builds an element tree from a compact spec: h("div", {id: "x"}, h("p")) */
export function h(tag, attrs = {}, ...children) {
  const node = globalThis.document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v === true ? "" : v);
  for (const c of children) node.append(c);
  return node;
}
