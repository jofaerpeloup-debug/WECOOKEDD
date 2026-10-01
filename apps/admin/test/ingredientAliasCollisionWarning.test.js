import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { createServer } from 'vite';

class TestNode {
  constructor(nodeType, nodeName, ownerDocument, text = '') {
    this.nodeType = nodeType;
    this.nodeName = nodeName;
    this.tagName = nodeType === 1 ? nodeName : undefined;
    this.ownerDocument = ownerDocument;
    this.parentNode = null;
    this.childNodes = [];
    this.nodeValue = text;
    this.attributes = new Map();
    this.style = { setProperty(name, value) { this[name] = value; } };
    this._listeners = new Map();
  }
  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
  get options() { return this.tagName === 'SELECT' ? findAll(this, (node) => node.tagName === 'OPTION') : undefined; }
  get value() {
    if (this.tagName === 'SELECT') return this.options.find((option) => option.selected)?.value ?? '';
    if (this.tagName === 'OPTION') return this._value ?? this.getAttribute('value') ?? this.textContent;
    return this._value ?? '';
  }
  set value(next) { this._value = String(next); }
  get textContent() { return this.nodeType === 3 ? this.nodeValue : this.childNodes.map((child) => child.textContent).join(''); }
  set textContent(value) {
    if (this.nodeType === 3) this.nodeValue = String(value);
    else {
      this.childNodes = [];
      if (value !== '') this.appendChild(this.ownerDocument.createTextNode(String(value)));
    }
  }
  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    this.childNodes.push(child);
    child.parentNode = this;
    return child;
  }
  insertBefore(child, before) {
    if (child.parentNode) child.parentNode.removeChild(child);
    const index = this.childNodes.indexOf(before);
    if (index === -1) throw new Error('insertBefore target is not a child');
    this.childNodes.splice(index, 0, child);
    child.parentNode = this;
    return child;
  }
  removeChild(child) {
    const index = this.childNodes.indexOf(child);
    if (index === -1) throw new Error('removeChild target is not a child');
    this.childNodes.splice(index, 1);
    child.parentNode = null;
    return child;
  }
  addEventListener(type, listener) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) { this._listeners.get(type)?.delete(listener); }
  setAttribute(name, value) {
    const normalized = String(name).toLowerCase();
    this.attributes.set(normalized, String(value));
    if (normalized === 'class') this.className = String(value);
    if (normalized === 'id') this.id = String(value);
    if (normalized === 'value') this._value = String(value);
    if (['disabled', 'required', 'checked', 'selected', 'multiple'].includes(normalized)) this[normalized] = true;
  }
  removeAttribute(name) {
    const normalized = String(name).toLowerCase();
    this.attributes.delete(normalized);
    if (['disabled', 'required', 'checked', 'selected', 'multiple'].includes(normalized)) this[normalized] = false;
  }
  getAttribute(name) { return this.attributes.get(String(name).toLowerCase()) ?? null; }
  hasAttribute(name) { return this.attributes.has(String(name).toLowerCase()); }
  focus() { this.ownerDocument.activeElement = this; }
  querySelectorAll(selector) {
    const tags = [...selector.matchAll(/(?:^|,\s*)(button|input|select)/g)].map((match) => match[1].toUpperCase());
    return findAll(this, (node) => tags.includes(node.tagName) && (!selector.includes(':not([disabled])') || !node.disabled));
  }
}

class TestDocument extends TestNode {
  constructor() {
    super(9, '#document', null);
    this.ownerDocument = this;
    this.activeElement = null;
    this.documentElement = this.createElement('html');
    this.body = this.createElement('body');
    this.documentElement.appendChild(this.body);
    this.appendChild(this.documentElement);
    this.defaultView = null;
  }
  createElement(tagName) { return new TestNode(1, String(tagName).toUpperCase(), this); }
  createElementNS(_namespace, tagName) { return this.createElement(tagName); }
  createTextNode(text) { return new TestNode(3, '#text', this, String(text)); }
  createComment(text) { return new TestNode(8, '#comment', this, String(text)); }
}

function findAll(root, predicate) {
  const found = [];
  for (const child of root.childNodes || []) {
    if (predicate(child)) found.push(child);
    found.push(...findAll(child, predicate));
  }
  return found;
}

function byId(root, id) {
  const node = findAll(root, (candidate) => candidate.id === id)[0];
  assert.ok(node, `Expected #${id}`);
  return node;
}

function reactProps(node) {
  const key = Object.keys(node).find((candidate) => candidate.startsWith('__reactProps$'));
  assert.ok(key, `Expected React props on ${node.nodeName}`);
  return node[key];
}

const document = new TestDocument();
const window = {
  document,
  Node: TestNode,
  HTMLElement: TestNode,
  HTMLIFrameElement: class extends TestNode {},
  getComputedStyle: () => ({}),
};
document.defaultView = window;
globalThis.document = document;
globalThis.window = window;
globalThis.Node = TestNode;
globalThis.HTMLElement = TestNode;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.requestAnimationFrame = (callback) => { callback(); return 1; };

const adminRoot = fileURLToPath(new URL('../', import.meta.url));
const vite = await createServer({
  root: adminRoot,
  configFile: false,
  logLevel: 'silent',
  server: { middlewareMode: true },
  appType: 'custom',
  esbuild: { jsx: 'automatic' },
  optimizeDeps: { noDiscovery: true },
  ssr: { external: ['@wecooked/contracts'] },
});
const { IngredientModal } = await vite.ssrLoadModule('/src/IngredientsTab.jsx');
after(() => vite.close());

async function mountModal(props = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(IngredientModal, {
      initialValues: { name: '', aliases: [], category: 'produce', allergenTags: [] },
      onClose() {},
      async onSubmit(payload) { return { id: 'created', ...payload }; },
      ...props,
    }));
  });
  return {
    container,
    async unmount() {
      await act(async () => root.unmount());
      container.parentNode?.removeChild(container);
    },
  };
}

async function change(node, value) {
  await act(async () => reactProps(node).onChange({ target: { value } }));
}

async function waitFor(ms) {
  await act(async () => new Promise((resolve) => setTimeout(resolve, ms)));
}

async function submit(root) {
  const form = findAll(root, (node) => node.tagName === 'FORM')[0];
  await act(async () => reactProps(form).onSubmit({ preventDefault() {} }));
}

function response(warnings) {
  return { ok: true, status: 200, async json() { return { success: true, data: { warnings } }; } };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

const strongWarning = {
  alias: 'scallion', collisionType: 'ALIAS_TO_CANONICAL',
  conflicts: [{ ingredientName: 'Scallion', status: 'archived', matchedOn: 'canonical' }],
  totalConflicts: 1, truncated: false,
};
const selfWarning = {
  alias: 'Green Onion', collisionType: 'SELF_ALIAS_TO_CANONICAL', conflicts: [], totalConflicts: 0, truncated: false,
};

test('debounces relevant changes and renders strong, self, status, source, and accessible advisory evidence', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return response([strongWarning, selfWarning]);
  });
  const mounted = await mountModal();
  try {
    await change(byId(mounted.container, 'ingredient-name'), 'Green');
    await change(byId(mounted.container, 'ingredient-name'), 'Green Onion');
    await change(byId(mounted.container, 'ingredient-aliases'), 'scallion, Green Onion');
    assert.equal(calls.length, 0);
    await waitFor(450);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { name: 'Green Onion', aliases: ['scallion', 'Green Onion'] });
    const region = byId(mounted.container, 'ingredient-alias-collisions');
    assert.equal(region.getAttribute('aria-live'), 'polite');
    assert.match(region.textContent, /Scallion \(Archived, matched by canonical name\)/);
    assert.match(region.textContent, /same as this Ingredient's canonical name and is redundant/);
    assert.match(byId(mounted.container, 'ingredient-aliases').getAttribute('aria-describedby'), /ingredient-alias-collisions/);
  } finally {
    await mounted.unmount();
  }
});

test('ignores an older response after the form signature changes', async (t) => {
  const first = deferred();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls += 1;
    if (calls === 1) return first.promise;
    return response([]);
  });
  const mounted = await mountModal({
    initialValues: { name: 'Green Onion', aliases: ['scallion'], category: 'produce', allergenTags: [] },
  });
  try {
    await waitFor(450);
    await change(byId(mounted.container, 'ingredient-aliases'), 'spring onion');
    await waitFor(450);
    assert.equal(calls, 2);
    await act(async () => first.resolve(response([strongWarning])));
    await act(async () => Promise.resolve());
    assert.doesNotMatch(byId(mounted.container, 'ingredient-alias-collisions').textContent, /Scallion \(Archived/);
  } finally {
    await mounted.unmount();
  }
});

test('ignores an older failure after a newer form signature succeeds', async (t) => {
  const first = deferred();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls += 1;
    if (calls === 1) return first.promise;
    return response([selfWarning]);
  });
  const mounted = await mountModal({
    initialValues: { name: 'Green Onion', aliases: ['scallion'], category: 'produce', allergenTags: [] },
  });
  try {
    await waitFor(450);
    await change(byId(mounted.container, 'ingredient-aliases'), 'Green Onion');
    await waitFor(450);
    assert.equal(calls, 2);
    const region = byId(mounted.container, 'ingredient-alias-collisions');
    assert.match(region.textContent, /same as this Ingredient's canonical name and is redundant/);
    await act(async () => first.reject(new Error('older request failed')));
    await act(async () => Promise.resolve());
    assert.match(region.textContent, /same as this Ingredient's canonical name and is redundant/);
    assert.doesNotMatch(region.textContent, /could not be checked/);
  } finally {
    await mounted.unmount();
  }
});

test('five-second advisory deadline renders unavailable and clears its timer without claiming no collisions', async (t) => {
  const timers = [];
  const cleared = [];
  t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) => {
    const timer = { callback, delay, args, cleared: false };
    timers.push(timer);
    return timer;
  });
  t.mock.method(globalThis, 'clearTimeout', (timer) => {
    timer.cleared = true;
    cleared.push(timer);
  });
  t.mock.method(globalThis, 'fetch', async () => new Promise(() => {}));

  const mounted = await mountModal({
    initialValues: { name: 'Ginger', aliases: ['root'], category: 'produce', allergenTags: [] },
  });
  try {
    const debounceTimer = timers.find((timer) => timer.delay === 400);
    assert.ok(debounceTimer, 'the advisory lookup must retain its 400 ms debounce');
    await act(async () => {
      debounceTimer.callback(...debounceTimer.args);
      await Promise.resolve();
    });

    const deadlineTimer = timers.find((timer) => timer.delay === 5000);
    assert.ok(deadlineTimer, 'the lookup must schedule the fixed five-second deadline');
    await act(async () => {
      deadlineTimer.callback(...deadlineTimer.args);
      await Promise.resolve();
      await Promise.resolve();
    });

    const region = byId(mounted.container, 'ingredient-alias-collisions');
    assert.match(region.textContent, /could not be checked/);
    assert.doesNotMatch(region.textContent, /No collisions/i);
    assert.equal(deadlineTimer.cleared, true);
    assert.ok(cleared.includes(deadlineTimer), 'the settled deadline timer must be cleared');
  } finally {
    await mounted.unmount();
  }
});

test('pre-save new warnings stop once, unchanged acknowledgement saves, and form changes invalidate it', async (t) => {
  const replies = [response([]), response([strongWarning]), response([strongWarning]), response([strongWarning])];
  t.mock.method(globalThis, 'fetch', async () => replies.shift() || response([strongWarning]));
  const saves = [];
  const mounted = await mountModal({
    initialValues: { name: 'Green Onion', aliases: ['scallion'], category: 'produce', allergenTags: [] },
    async onSubmit(payload) { saves.push(payload); return { id: 'created', ...payload }; },
  });
  try {
    await waitFor(450);
    await submit(mounted.container);
    assert.equal(saves.length, 0);
    assert.match(byId(mounted.container, 'ingredient-alias-collisions').textContent, /Scallion \(Archived/);
    await change(byId(mounted.container, 'ingredient-aliases'), 'scallion, spring onion');
    await submit(mounted.container);
    assert.equal(saves.length, 0, 'changed signature must recheck and stop on warnings');
    await submit(mounted.container);
    assert.equal(saves.length, 1, 'unchanged explicit continuation must preserve the existing save path');
  } finally {
    await mounted.unmount();
  }
});

test('a warning already displayed for the unchanged signature does not block the save recheck', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => response([strongWarning]));
  const saves = [];
  const mounted = await mountModal({
    initialValues: { name: 'Green Onion', aliases: ['scallion'], category: 'produce', allergenTags: [] },
    async onSubmit(payload) { saves.push(payload); return { id: 'created', ...payload }; },
  });
  try {
    await waitFor(450);
    assert.match(byId(mounted.container, 'ingredient-alias-collisions').textContent, /Scallion \(Archived/);
    await submit(mounted.container);
    assert.equal(saves.length, 1);
  } finally {
    await mounted.unmount();
  }
});

test('failed lookup is visibly unavailable and requires one unchanged-form continuation', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('offline'); });
  const saves = [];
  const mounted = await mountModal({
    initialValues: { name: 'Ginger', aliases: ['root'], category: 'produce', allergenTags: [] },
    async onSubmit(payload) { saves.push(payload); return { id: 'created', ...payload }; },
  });
  try {
    await waitFor(450);
    const region = byId(mounted.container, 'ingredient-alias-collisions');
    assert.match(region.textContent, /could not be checked/);
    assert.doesNotMatch(region.textContent, /No collisions/i);
    await submit(mounted.container);
    assert.equal(saves.length, 0);
    await submit(mounted.container);
    assert.equal(saves.length, 1);
  } finally {
    await mounted.unmount();
  }
});
