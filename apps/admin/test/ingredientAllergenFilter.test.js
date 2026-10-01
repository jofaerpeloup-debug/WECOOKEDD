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
  get options() {
    return this.tagName === 'SELECT'
      ? findAll(this, (node) => node.tagName === 'OPTION')
      : undefined;
  }
  get value() {
    if (this.tagName === 'SELECT') {
      return this.options.find((option) => option.selected)?.value ?? this._value ?? '';
    }
    if (this.tagName === 'OPTION') {
      return this._value ?? this.getAttribute('value') ?? this.textContent;
    }
    return this._value ?? '';
  }
  set value(next) { this._value = String(next); }
  get textContent() {
    return this.nodeType === 3
      ? this.nodeValue
      : this.childNodes.map((child) => child.textContent).join('');
  }
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
    if (['disabled', 'required', 'checked', 'selected', 'multiple'].includes(normalized)) {
      this[normalized] = true;
    }
  }
  removeAttribute(name) {
    const normalized = String(name).toLowerCase();
    this.attributes.delete(normalized);
    if (['disabled', 'required', 'checked', 'selected', 'multiple'].includes(normalized)) {
      this[normalized] = false;
    }
  }
  getAttribute(name) { return this.attributes.get(String(name).toLowerCase()) ?? null; }
  hasAttribute(name) { return this.attributes.has(String(name).toLowerCase()); }
  focus() { this.ownerDocument.activeElement = this; }
  querySelectorAll(selector) {
    const tags = [...selector.matchAll(/(?:^|,\s*)(button|input|select)/g)]
      .map((match) => match[1].toUpperCase());
    return findAll(
      this,
      (node) => tags.includes(node.tagName)
        && (!selector.includes(':not([disabled])') || !node.disabled),
    );
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

function findOne(root, predicate, description) {
  const match = findAll(root, predicate)[0];
  assert.ok(match, `Expected mounted ${description}`);
  return match;
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

async function mount(element) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(element); });
  return {
    container,
    async unmount() {
      await act(async () => { root.unmount(); });
      container.parentNode?.removeChild(container);
    },
  };
}

function control(root, label) {
  return findOne(
    root,
    (node) => node.getAttribute?.('aria-label') === label,
    `${label} control`,
  );
}

function button(root, label) {
  return findOne(
    root,
    (node) => node.tagName === 'BUTTON' && node.textContent.includes(label),
    `${label} button`,
  );
}

async function changeMany(changes) {
  await act(async () => {
    for (const [node, value] of changes) {
      reactProps(node).onChange({ target: { value } });
    }
  });
}

async function click(node) {
  await act(async () => {
    reactProps(node).onClick({
      currentTarget: node,
      target: node,
      preventDefault() {},
      stopPropagation() {},
    });
  });
}

async function settleDebouncedRequest() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
  });
}

function queryOf(request) {
  return new URL(request.url).searchParams;
}

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

const [ingredientModule, ingredientOptionsModule] = await Promise.all([
  vite.ssrLoadModule('/src/IngredientsTab.jsx'),
  vite.ssrLoadModule('/src/ingredientOptions.js'),
]);
after(() => vite.close());

const { default: IngredientsTab } = ingredientModule;
const { INGREDIENT_ALLERGEN_TAGS } = ingredientOptionsModule;

test('mounted allergen filter preserves canonical options, composition, pagination, and GET-only behavior', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    const query = new URL(String(url)).searchParams;
    const page = Number(query.get('page') || 1);
    const emptyResult = query.get('allergen') === 'milk';
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          success: true,
          data: {
            ingredients: emptyResult ? [] : [{
              id: 'ingredient-1',
              name: 'Milk',
              aliases: [],
              category: 'dairy',
              allergenTags: ['milk'],
              isActive: true,
            }],
            pagination: {
              page,
              limit: 20,
              total: emptyResult ? 0 : 60,
              totalPages: emptyResult ? 0 : 3,
            },
          },
        };
      },
    };
  };

  const mounted = await mount(createElement(IngredientsTab, { canWrite: true }));
  try {
    const allergen = control(mounted.container, 'Filter by allergen');
    assert.equal(allergen.value, '', 'All allergens must be selected by default');
    assert.deepEqual(
      allergen.options.map((option) => ({ value: option.value, label: option.textContent })),
      [{ value: '', label: 'All allergens' }, ...INGREDIENT_ALLERGEN_TAGS],
      'filter options must exactly reuse the canonical Admin contract',
    );

    await settleDebouncedRequest();
    assert.equal(requests.length, 1);
    assert.equal(queryOf(requests[0]).has('allergen'), false);

    await click(button(mounted.container, 'Next'));
    await settleDebouncedRequest();
    assert.equal(queryOf(requests.at(-1)).get('page'), '2');

    const search = findOne(
      mounted.container,
      (node) => node.tagName === 'INPUT' && node.getAttribute('placeholder') === 'Search name or alias…',
      'Ingredient search input',
    );
    await changeMany([
      [search, '  butter  '],
      [control(mounted.container, 'Filter by category'), 'dairy'],
      [control(mounted.container, 'Filter by status'), 'inactive'],
      [allergen, 'milk'],
    ]);
    await settleDebouncedRequest();

    const milkQuery = queryOf(requests.at(-1));
    assert.equal(milkQuery.get('allergen'), 'milk');
    assert.equal(milkQuery.get('search'), 'butter');
    assert.equal(milkQuery.get('category'), 'dairy');
    assert.equal(milkQuery.get('status'), 'inactive');
    assert.equal(milkQuery.get('sort'), 'nameAsc');
    assert.equal(milkQuery.get('limit'), '20');
    assert.equal(milkQuery.get('page'), '1', 'allergen selection must reset pagination');
    assert.match(mounted.container.textContent, /No ingredients match these filters\./u);

    await changeMany([[allergen, 'treeNut']]);
    await settleDebouncedRequest();
    const treeNutQuery = queryOf(requests.at(-1));
    assert.equal(treeNutQuery.get('allergen'), 'treeNut');
    assert.equal(treeNutQuery.get('search'), 'butter');
    assert.equal(treeNutQuery.get('category'), 'dairy');
    assert.equal(treeNutQuery.get('status'), 'inactive');
    assert.equal(
      reactProps(allergen).value,
      'treeNut',
      'treeNut must remain selected before paging',
    );

    await click(button(mounted.container, 'Next'));
    await settleDebouncedRequest();
    const laterPageQuery = queryOf(requests.at(-1));
    assert.equal(laterPageQuery.get('allergen'), 'treeNut');
    assert.equal(laterPageQuery.get('page'), '2', 'allergen must be selected on a later page');
    assert.equal(laterPageQuery.get('search'), 'butter');
    assert.equal(laterPageQuery.get('category'), 'dairy');
    assert.equal(laterPageQuery.get('status'), 'inactive');
    assert.equal(laterPageQuery.get('sort'), 'nameAsc');
    assert.equal(laterPageQuery.get('limit'), '20');

    await changeMany([[allergen, '']]);
    await settleDebouncedRequest();
    const clearedQuery = queryOf(requests.at(-1));
    assert.equal(clearedQuery.has('allergen'), false, 'All allergens must omit the query key');
    assert.equal(clearedQuery.get('search'), 'butter');
    assert.equal(clearedQuery.get('category'), 'dairy');
    assert.equal(clearedQuery.get('status'), 'inactive');
    assert.equal(clearedQuery.get('sort'), 'nameAsc');
    assert.equal(clearedQuery.get('limit'), '20');
    assert.equal(clearedQuery.get('page'), '1', 'clearing allergen from a later page must reset pagination');

    assert.ok(requests.length >= 5);
    assert.ok(
      requests.every(({ url, options }) => (
        (options.method || 'GET') === 'GET'
        && new URL(url).pathname.endsWith('/ingredients')
      )),
      'filter interactions must only issue Ingredient list GET requests',
    );
  } finally {
    globalThis.fetch = originalFetch;
    await mounted.unmount();
  }
});
