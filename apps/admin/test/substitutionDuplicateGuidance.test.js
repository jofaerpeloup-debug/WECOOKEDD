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

function byAriaLabel(root, label) {
  const node = findAll(root, (candidate) => candidate.getAttribute?.('aria-label') === label)[0];
  assert.ok(node, `Expected aria-label ${label}`);
  return node;
}

function buttonByText(root, text) {
  const node = findAll(root, (candidate) => candidate.tagName === 'BUTTON' && candidate.textContent.includes(text))[0];
  assert.ok(node, `Expected button containing ${text}`);
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
const {
  default: SubstitutionsTab,
  SubstitutionModal,
  ApiError,
} = await vite.ssrLoadModule('/src/SubstitutionsTab.jsx');
const { listExactSubstitutionPair } = await vite.ssrLoadModule('/src/substitutionApi.js');
after(() => vite.close());

const A = { id: 'ingredient-a', name: 'Butter' };
const B = { id: 'ingredient-b', name: 'Margarine' };
const C = { id: 'ingredient-c', name: 'Olive oil' };
const D = { id: 'ingredient-d', name: 'Avocado oil' };

function substitution(overrides = {}) {
  return {
    id: 'current-id',
    sourceIngredient: A,
    substituteIngredient: B,
    ratio: { sourceAmount: 1, substituteAmount: 1 },
    contexts: [],
    notes: '',
    isActive: true,
    ...overrides,
  };
}

function response(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return { success: true, data }; } };
}

function listResponse(substitutions = []) {
  return response({ substitutions, pagination: { page: 1, limit: 1, total: substitutions.length, totalPages: 1 } });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

async function mountModal(props = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(SubstitutionModal, {
      substitution: substitution(),
      onClose() {},
      async onSubmit() {},
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

async function mountTab(props = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(SubstitutionsTab, { canWrite: true, ...props }));
  });
  return {
    container,
    async unmount() {
      await act(async () => root.unmount());
      container.parentNode?.removeChild(container);
    },
  };
}

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

async function submit(root) {
  const form = findAll(root, (node) => node.tagName === 'FORM')[0];
  await act(async () => reactProps(form).onSubmit({ preventDefault() {} }));
  await flush();
}

async function startSubmit(root) {
  const form = findAll(root, (node) => node.tagName === 'FORM')[0];
  let pending;
  await act(async () => {
    pending = reactProps(form).onSubmit({ preventDefault() {} });
    await Promise.resolve();
    await Promise.resolve();
  });
  return { pending };
}

async function selectIngredient(root, label, ingredient) {
  const input = byAriaLabel(root, label);
  await act(async () => reactProps(input).onFocus());
  await act(async () => new Promise((resolve) => setTimeout(resolve, 300)));
  await act(async () => reactProps(buttonByText(root, ingredient.name)).onClick());
}


async function changeInput(root, label, value) {
  const input = byAriaLabel(root, label);
  await act(async () => reactProps(input).onChange({ target: { value } }));
}

test('active exact duplicate shows the directed pair, is accessible, blocks mutation, and exposes navigation', async (t) => {
  const calls = [];
  const existing = substitution({ id: 'existing-id' });
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls.push(String(url));
    return listResponse([existing]);
  });
  const saves = [];
  const shown = [];
  const mounted = await mountModal({ onSubmit: async (payload) => saves.push(payload), onShowExisting: (pair) => shown.push(pair) });
  try {
    await flush();
    const region = byId(mounted.container, 'substitution-duplicate-guidance');
    assert.equal(region.getAttribute('aria-live'), 'polite');
    assert.match(region.textContent, /Butter -> Margarine/);
    assert.match(region.textContent, /Status: Active/);
    const selectedControls = [
      byAriaLabel(mounted.container, 'Clear Source ingredient'),
      byAriaLabel(mounted.container, 'Clear Substitute ingredient'),
    ];
    assert.ok(selectedControls.every((control) => (
      control.tagName === 'BUTTON'
      && (control.getAttribute('aria-describedby') || '').split(/\s+/)
        .includes('substitution-duplicate-guidance')
    )), 'both focusable selected-Ingredient controls must reference the guidance');
    const notes = findAll(mounted.container, (node) => node.tagName === 'TEXTAREA')[0];
    await act(async () => reactProps(notes).onChange({ target: { value: 'Mutation-capable edit' } }));
    await submit(mounted.container);
    assert.equal(saves.length, 0);
    await act(async () => reactProps(buttonByText(mounted.container, 'Show existing substitution')).onClick());
    assert.deepEqual(shown, [{ source: A, substitute: B }]);
    const lookup = new URL(calls[0]);
    assert.equal(lookup.searchParams.get('sourceIngredientId'), A.id);
    assert.equal(lookup.searchParams.get('substituteIngredientId'), B.id);
    assert.equal(lookup.searchParams.get('status'), 'all');
    assert.equal(lookup.searchParams.get('page'), '1');
    assert.equal(lookup.searchParams.get('limit'), '1');
  } finally { await mounted.unmount(); }
});

test('archived duplicate is labelled and blocks creation while preserving explicit restore/edit guidance', async (t) => {
  let substitutionLookups = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url).includes('/ingredients')) {
      return response({ ingredients: [A, B], pagination: null });
    }
    substitutionLookups += 1;
    return listResponse([substitution({ id: 'archived-id', isActive: false })]);
  });
  const saves = [];
  const mounted = await mountModal({ substitution: null, onSubmit: async (payload) => saves.push(payload) });
  try {
    assert.equal(findAll(mounted.container, (node) => node.textContent?.includes('Checking for an existing')).length, 0);
    await selectIngredient(mounted.container, 'Source ingredient', A);
    assert.equal(substitutionLookups, 0, 'one selection must not start a duplicate lookup');
    await selectIngredient(mounted.container, 'Substitute ingredient', A);
    await flush();
    assert.equal(substitutionLookups, 0, 'the same Ingredient on both sides must not start a lookup');
    await act(async () => reactProps(byAriaLabel(mounted.container, 'Clear Substitute ingredient')).onClick());
    await selectIngredient(mounted.container, 'Substitute ingredient', B);
    await changeInput(mounted.container, 'Source amount', '1');
    await changeInput(mounted.container, 'Substitute amount', '1');
    await flush();
    assert.equal(substitutionLookups, 1);
    const text = byId(mounted.container, 'substitution-duplicate-guidance').textContent;
    assert.match(text, /Status: Archived/);
    assert.match(text, /restore or edit it explicitly/);
    await submit(mounted.container);
    assert.equal(saves.length, 0);
  } finally { await mounted.unmount(); }
});

test('edit excludes its public id, allows unchanged non-pair edits, and reverse direction remains allowed', async (t) => {
  const urls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    urls.push(String(url));
    return listResponse([substitution()]);
  });
  const saves = [];
  const mounted = await mountModal({ onSubmit: async (payload) => saves.push(payload) });
  try {
    await flush();
    assert.equal(byId(mounted.container, 'substitution-duplicate-guidance').textContent, '');
    const notes = findAll(mounted.container, (node) => node.tagName === 'TEXTAREA')[0];
    await act(async () => reactProps(notes).onChange({ target: { value: 'Updated' } }));
    await submit(mounted.container);
    assert.deepEqual(saves, [{ notes: 'Updated' }]);
    assert.ok(urls.every((url) => new URL(url).searchParams.get('sourceIngredientId') === A.id));
  } finally { await mounted.unmount(); }

  const reverseUrls = [];
  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async (url) => {
    reverseUrls.push(String(url));
    return listResponse([]);
  });
  const reverseSaves = [];
  const reverse = await mountModal({
    substitution: substitution({ sourceIngredient: B, substituteIngredient: A }),
    onSubmit: async (payload) => reverseSaves.push(payload),
  });
  try {
    await flush();
    assert.equal(new URL(reverseUrls[0]).searchParams.get('sourceIngredientId'), B.id);
    assert.equal(new URL(reverseUrls[0]).searchParams.get('substituteIngredientId'), A.id);
    assert.equal(byId(reverse.container, 'substitution-duplicate-guidance').textContent, '');
    const notes = findAll(reverse.container, (node) => node.tagName === 'TEXTAREA')[0];
    await act(async () => reactProps(notes).onChange({ target: { value: 'Reverse remains distinct' } }));
    await submit(reverse.container);
    assert.deepEqual(reverseSaves, [{ notes: 'Reverse remains distinct' }]);
  } finally { await reverse.unmount(); }
});

test('stale success and stale failure cannot overwrite a newer exact-pair result', async (t) => {
  const first = deferred();
  let substitutionCalls = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    const value = String(url);
    if (value.includes('/ingredients')) return response({ ingredients: [A, B, C], pagination: null });
    substitutionCalls += 1;
    if (substitutionCalls === 1) return first.promise;
    return listResponse([]);
  });
  const mounted = await mountModal();
  try {
    await act(async () => reactProps(byAriaLabel(mounted.container, 'Clear Source ingredient')).onClick());
    await selectIngredient(mounted.container, 'Source ingredient', C);
    await flush();
    await act(async () => first.resolve(listResponse([substitution({ id: 'old-id' })])));
    await flush();
    assert.doesNotMatch(byId(mounted.container, 'substitution-duplicate-guidance').textContent, /already exists/);
  } finally { await mounted.unmount(); }

  const olderFailure = deferred();
  substitutionCalls = 0;
  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async (url) => {
    const value = String(url);
    if (value.includes('/ingredients')) return response({ ingredients: [A, B, C], pagination: null });
    substitutionCalls += 1;
    if (substitutionCalls === 1) return olderFailure.promise;
    return listResponse([substitution({ id: 'new-id', sourceIngredient: C })]);
  });
  const second = await mountModal();
  try {
    await act(async () => reactProps(byAriaLabel(second.container, 'Clear Source ingredient')).onClick());
    await selectIngredient(second.container, 'Source ingredient', C);
    await flush();
    await act(async () => olderFailure.reject(new Error('old failure')));
    await flush();
    assert.match(byId(second.container, 'substitution-duplicate-guidance').textContent, /Status: Active/);
    assert.doesNotMatch(byId(second.container, 'substitution-duplicate-guidance').textContent, /could not be checked/);
  } finally { await second.unmount(); }
});

test('stale timeout and close/reopen session isolation preserve the newer pair and clean timers', async (t) => {
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const deadlines = [];
  const clearedDeadlines = [];
  t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) => {
    if (delay !== 5000) return realSetTimeout(callback, delay, ...args);
    const timer = { callback, delay, args };
    deadlines.push(timer);
    return timer;
  });
  t.mock.method(globalThis, 'clearTimeout', (timer) => {
    if (timer?.delay === 5000) clearedDeadlines.push(timer);
    else realClearTimeout(timer);
  });

  const oldLookup = deferred();
  let substitutionCalls = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    const value = String(url);
    if (value.includes('/ingredients')) return response({ ingredients: [A, B, C], pagination: null });
    substitutionCalls += 1;
    if (substitutionCalls === 1) return oldLookup.promise;
    return listResponse([substitution({
      id: 'new-owner',
      sourceIngredient: C,
      substituteIngredient: B,
    })]);
  });

  const firstSession = await mountModal();
  try {
    await act(async () => reactProps(byAriaLabel(firstSession.container, 'Clear Source ingredient')).onClick());
    await selectIngredient(firstSession.container, 'Source ingredient', C);
    await flush();
    const beforeTimeout = byId(firstSession.container, 'substitution-duplicate-guidance').textContent;
    assert.match(beforeTimeout, /Olive oil -> Margarine/);
    assert.match(beforeTimeout, /Status: Active/);

    await act(async () => {
      deadlines[0].callback(...deadlines[0].args);
      await Promise.resolve();
      await Promise.resolve();
    });
    const afterTimeout = byId(firstSession.container, 'substitution-duplicate-guidance').textContent;
    assert.match(afterTimeout, /Olive oil -> Margarine/);
    assert.match(afterTimeout, /Status: Active/);
    assert.doesNotMatch(afterTimeout, /could not be checked/);
    assert.ok(clearedDeadlines.includes(deadlines[0]));
  } finally { await firstSession.unmount(); }

  await act(async () => oldLookup.resolve(listResponse([substitution({ id: 'old-owner' })])));
  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async () => listResponse([]));
  const reopened = await mountModal();
  try {
    await flush();
    assert.doesNotMatch(
      byId(reopened.container, 'substitution-duplicate-guidance').textContent,
      /already exists|could not be checked/,
    );
  } finally { await reopened.unmount(); }
});

test('five-second deadline becomes unavailable without claiming clean and failed preflight may still save', async (t) => {
  const timers = [];
  const cleared = [];
  t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) => {
    const timer = { callback, delay, args };
    timers.push(timer);
    return timer;
  });
  t.mock.method(globalThis, 'clearTimeout', (timer) => { cleared.push(timer); });
  t.mock.method(globalThis, 'fetch', async () => new Promise(() => {}));
  const mounted = await mountModal();
  try {
    const deadline = timers.find((timer) => timer.delay === 5000);
    assert.ok(deadline);
    await act(async () => { deadline.callback(...deadline.args); await Promise.resolve(); await Promise.resolve(); });
    const text = byId(mounted.container, 'substitution-duplicate-guidance').textContent;
    assert.match(text, /could not be checked/);
    assert.doesNotMatch(text, /no duplicate|clean/i);
    assert.ok(cleared.includes(deadline), 'the five-second deadline timer must be cleaned up');
  } finally { await mounted.unmount(); }

  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('offline'); });
  const saves = [];
  const failed = await mountModal({ onSubmit: async (payload) => saves.push(payload) });
  try {
    await flush();
    const notes = findAll(failed.container, (node) => node.tagName === 'TEXTAREA')[0];
    await act(async () => reactProps(notes).onChange({ target: { value: 'Allowed under server protection' } }));
    await submit(failed.container);
    assert.deepEqual(saves, [{ notes: 'Allowed under server protection' }]);
  } finally { await failed.unmount(); }
});

test('malformed successful lookup is unavailable and never interpreted as no duplicate', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => response({
    substitutions: { unexpected: 'object' },
    pagination: { page: 1, limit: 1, total: 0, totalPages: 0 },
  }));
  const mounted = await mountModal();
  try {
    await flush();
    const text = byId(mounted.container, 'substitution-duplicate-guidance').textContent;
    assert.match(text, /could not be checked/);
    assert.doesNotMatch(text, /no duplicate|clean/i);
  } finally { await mounted.unmount(); }
});

test('successful lookup with a missing substitutions collection is unavailable', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => response({
    pagination: { page: 1, limit: 1, total: 0, totalPages: 0 },
  }));
  const mounted = await mountModal();
  try {
    await flush();
    const text = byId(mounted.container, 'substitution-duplicate-guidance').textContent;
    assert.match(text, /could not be checked/);
    assert.doesNotMatch(text, /no duplicate|clean/i);
  } finally { await mounted.unmount(); }
});

test('strict exact-pair service accepts valid empty and rejects non-array collections', async (t) => {
  const urls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    urls.push(String(url));
    return listResponse([]);
  });
  assert.deepEqual(await listExactSubstitutionPair(A.id, B.id), []);
  const request = new URL(urls[0]);
  assert.equal(request.searchParams.get('sourceIngredientId'), A.id);
  assert.equal(request.searchParams.get('substituteIngredientId'), B.id);
  assert.equal(request.searchParams.get('status'), 'all');
  assert.equal(request.searchParams.get('limit'), '1');

  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async () => response(undefined));
  await assert.rejects(
    listExactSubstitutionPair(A.id, B.id),
    /MALFORMED_SUBSTITUTION_LOOKUP_RESPONSE/,
  );

  for (const substitutions of [null, {}, 'unexpected']) {
    t.mock.restoreAll();
    t.mock.method(globalThis, 'fetch', async () => response({ substitutions }));
    await assert.rejects(
      listExactSubstitutionPair(A.id, B.id),
      /MALFORMED_SUBSTITUTION_LOOKUP_RESPONSE/,
    );
  }
});

test('valid empty collection is clean and permits the authoritative save', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => listResponse([]));
  const saves = [];
  const mounted = await mountModal({ onSubmit: async (payload) => saves.push(payload) });
  try {
    await flush();
    assert.equal(byId(mounted.container, 'substitution-duplicate-guidance').textContent, '');
    const notes = findAll(mounted.container, (node) => node.tagName === 'TEXTAREA')[0];
    await act(async () => reactProps(notes).onChange({ target: { value: 'Valid empty lookup' } }));
    await submit(mounted.container);
    assert.deepEqual(saves, [{ notes: 'Valid empty lookup' }]);
  } finally { await mounted.unmount(); }
});

test('fresh pre-save lookup can discover a duplicate and guarantees zero update mutations', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls += 1;
    return calls === 1 ? listResponse([]) : listResponse([substitution({ id: 'raced-owner' })]);
  });
  const saves = [];
  const mounted = await mountModal({ onSubmit: async (payload) => saves.push(payload) });
  try {
    await flush();
    const notes = findAll(mounted.container, (node) => node.tagName === 'TEXTAREA')[0];
    await act(async () => reactProps(notes).onChange({ target: { value: 'Changed' } }));
    await submit(mounted.container);
    assert.equal(saves.length, 0);
    assert.match(byId(mounted.container, 'substitution-duplicate-guidance').textContent, /already exists/);
  } finally { await mounted.unmount(); }
});

test('stale save-time duplicate conflict cannot corrupt a newer pair or start old-pair recovery', async (t) => {
  const mutation = deferred();
  const lookupPairs = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    const value = String(url);
    if (value.includes('/ingredients')) {
      return response({ ingredients: [A, B, C, D], pagination: null });
    }
    const request = new URL(value);
    const pair = `${request.searchParams.get('sourceIngredientId')}->${request.searchParams.get('substituteIngredientId')}`;
    lookupPairs.push(pair);
    if (pair === `${C.id}->${D.id}`) {
      return listResponse([substitution({
        id: 'new-pair-owner',
        sourceIngredient: C,
        substituteIngredient: D,
      })]);
    }
    return listResponse([]);
  });
  const mounted = await mountModal({ onSubmit: async () => mutation.promise });
  try {
    await flush();
    const notes = findAll(mounted.container, (node) => node.tagName === 'TEXTAREA')[0];
    await act(async () => reactProps(notes).onChange({ target: { value: 'Pending A to B edit' } }));
    const { pending: pendingSubmit } = await startSubmit(mounted.container);
    assert.deepEqual(lookupPairs, [`${A.id}->${B.id}`, `${A.id}->${B.id}`]);

    await act(async () => reactProps(byAriaLabel(mounted.container, 'Clear Source ingredient')).onClick());
    await selectIngredient(mounted.container, 'Source ingredient', C);
    await act(async () => reactProps(byAriaLabel(mounted.container, 'Clear Substitute ingredient')).onClick());
    await selectIngredient(mounted.container, 'Substitute ingredient', D);
    await flush();
    assert.match(byId(mounted.container, 'substitution-duplicate-guidance').textContent, /Olive oil -> Avocado oil/);
    assert.match(byId(mounted.container, 'substitution-duplicate-guidance').textContent, /Status: Active/);

    await act(async () => mutation.reject(new ApiError('exists', {
      status: 409,
      code: 'SUBSTITUTION_ALREADY_EXISTS',
    })));
    await pendingSubmit;
    await flush();

    assert.deepEqual(lookupPairs, [
      `${A.id}->${B.id}`,
      `${A.id}->${B.id}`,
      `${C.id}->${B.id}`,
      `${C.id}->${D.id}`,
    ], 'a stale 409 must not start an additional A to B recovery lookup');
    const text = byId(mounted.container, 'substitution-duplicate-guidance').textContent;
    assert.match(text, /Olive oil -> Avocado oil/);
    assert.match(text, /Status: Active/);
    assert.doesNotMatch(text, /Butter -> Margarine|Status: Unknown/);
  } finally { await mounted.unmount(); }
});

test('a closed submit session cannot launch 409 recovery or affect a reopened modal', async (t) => {
  const mutation = deferred();
  let lookups = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    lookups += 1;
    return listResponse([]);
  });
  const first = await mountModal({ onSubmit: async () => mutation.promise });
  const notes = findAll(first.container, (node) => node.tagName === 'TEXTAREA')[0];
  await act(async () => reactProps(notes).onChange({ target: { value: 'Pending submit' } }));
  const { pending } = await startSubmit(first.container);
  assert.equal(lookups, 2);
  await first.unmount();

  mutation.reject(new ApiError('exists', { status: 409, code: 'SUBSTITUTION_ALREADY_EXISTS' }));
  await pending;
  assert.equal(lookups, 2, 'an unmounted stale submit must not start duplicate recovery');

  const reopened = await mountModal();
  try {
    await flush();
    assert.equal(lookups, 3);
    assert.equal(byId(reopened.container, 'substitution-duplicate-guidance').textContent, '');
  } finally { await reopened.unmount(); }
});

test('save-time duplicate conflict recovers status or retains authoritative Unknown guidance', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls += 1;
    return calls < 3 ? listResponse([]) : listResponse([substitution({ id: 'race-owner', isActive: false })]);
  });
  const mounted = await mountModal({
    onSubmit: async () => { throw new ApiError('exists', { status: 409, code: 'SUBSTITUTION_ALREADY_EXISTS' }); },
  });
  try {
    await flush();
    const notes = findAll(mounted.container, (node) => node.tagName === 'TEXTAREA')[0];
    await act(async () => reactProps(notes).onChange({ target: { value: 'Changed' } }));
    await submit(mounted.container);
    assert.match(byId(mounted.container, 'substitution-duplicate-guidance').textContent, /Status: Archived/);
    assert.equal(calls, 3, 'advisory, pre-save, and exactly one 409 recovery lookup');
  } finally { await mounted.unmount(); }

  calls = 0;
  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async () => {
    calls += 1;
    if (calls < 3) return listResponse([]);
    throw new Error('recovery offline');
  });
  const unknown = await mountModal({
    onSubmit: async () => { throw new ApiError('exists', { status: 409, code: 'SUBSTITUTION_ALREADY_EXISTS' }); },
  });
  try {
    await flush();
    const notes = findAll(unknown.container, (node) => node.tagName === 'TEXTAREA')[0];
    await act(async () => reactProps(notes).onChange({ target: { value: 'Changed' } }));
    await submit(unknown.container);
    const text = byId(unknown.container, 'substitution-duplicate-guidance').textContent;
    assert.match(text, /Status: Unknown/);
    assert.match(text, /server confirmed the duplicate/);
    assert.equal(calls, 3, 'failed recovery must still run exactly once');
  } finally { await unknown.unmount(); }
});

test('Show existing substitution applies the exact parent filters and closes the modal', async (t) => {
  const substitutionUrls = [];
  const existing = substitution({ id: 'existing-id' });
  t.mock.method(globalThis, 'fetch', async (url) => {
    const value = String(url);
    if (value.includes('/ingredients')) {
      return response({ ingredients: [A, B], pagination: null });
    }
    const request = new URL(value);
    substitutionUrls.push(value);
    const exactPair = request.searchParams.get('sourceIngredientId') === A.id
      && request.searchParams.get('substituteIngredientId') === B.id;
    if (exactPair) {
      return response({
        substitutions: [existing],
        pagination: { page: 1, limit: Number(request.searchParams.get('limit')), total: 1, totalPages: 1 },
      });
    }
    const page = Number(request.searchParams.get('page') || 1);
    return response({
      substitutions: [],
      pagination: { page, limit: 20, total: 40, totalPages: 2 },
    });
  });
  const mounted = await mountTab();
  try {
    await act(async () => new Promise((resolve) => setTimeout(resolve, 300)));
    await changeInput(mounted.container, 'Filter by context', 'baking');
    await act(async () => new Promise((resolve) => setTimeout(resolve, 300)));
    await act(async () => reactProps(buttonByText(mounted.container, 'Next')).onClick());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 300)));

    await act(async () => reactProps(buttonByText(mounted.container, 'Add substitution')).onClick());
    await selectIngredient(mounted.container, 'Source ingredient', A);
    await selectIngredient(mounted.container, 'Substitute ingredient', B);
    await flush();
    assert.match(byId(mounted.container, 'substitution-duplicate-guidance').textContent, /Status: Active/);

    await act(async () => reactProps(buttonByText(mounted.container, 'Show existing substitution')).onClick());
    assert.equal(findAll(mounted.container, (node) => node.tagName === 'FORM').length, 0, 'modal must close');
    assert.equal(byAriaLabel(mounted.container, 'Clear Filter by source ingredient').parentNode.textContent, A.name);
    assert.equal(byAriaLabel(mounted.container, 'Clear Filter by substitute ingredient').parentNode.textContent, B.name);
    assert.equal(reactProps(byAriaLabel(mounted.container, 'Filter by status')).value, 'all');
    assert.equal(byAriaLabel(mounted.container, 'Filter by context').value, '');

    await act(async () => new Promise((resolve) => setTimeout(resolve, 300)));
    const applied = [...substitutionUrls].reverse().map((url) => new URL(url)).find((url) => (
      url.searchParams.get('limit') === '20'
      && url.searchParams.get('sourceIngredientId') === A.id
      && url.searchParams.get('substituteIngredientId') === B.id
    ));
    assert.ok(applied, 'parent must reload the list with the exact pair filters');
    assert.equal(applied.searchParams.get('status'), 'all');
    assert.equal(applied.searchParams.get('page'), '1');
    assert.equal(applied.searchParams.get('context'), null);
  } finally { await mounted.unmount(); }
});

test('unrelated errors retain existing handling and forbidden lookup reports authority loss', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => listResponse([]));
  const mounted = await mountModal({
    onSubmit: async () => { throw new ApiError('Specific failure', { status: 409, code: 'OTHER_CONFLICT' }); },
  });
  try {
    await flush();
    const notes = findAll(mounted.container, (node) => node.tagName === 'TEXTAREA')[0];
    await act(async () => reactProps(notes).onChange({ target: { value: 'Changed' } }));
    await submit(mounted.container);
    assert.match(mounted.container.textContent, /Specific failure/);
    assert.doesNotMatch(byId(mounted.container, 'substitution-duplicate-guidance').textContent, /Status: Unknown/);
  } finally { await mounted.unmount(); }

  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async () => response({ error: {} }, 403));
  let authorityLost = 0;
  const forbidden = await mountModal({ onAuthorityLost: () => { authorityLost += 1; } });
  try {
    await flush();
    assert.equal(authorityLost, 1);
  } finally { await forbidden.unmount(); }
});
