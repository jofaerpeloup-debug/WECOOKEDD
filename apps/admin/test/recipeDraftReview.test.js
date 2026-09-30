import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import React, { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

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
const { default: RecipesTab } = await vite.ssrLoadModule('/src/RecipesTab.jsx');
after(() => vite.close());

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
  get options() { return this.nodeName === 'SELECT' ? this.childNodes.filter((child) => child.nodeName === 'OPTION') : undefined; }
  get textContent() { return this.nodeType === 3 ? this.nodeValue : this.childNodes.map((child) => child.textContent).join(''); }
  set textContent(value) {
    if (this.nodeType === 3) this.nodeValue = String(value);
    else { this.childNodes = []; if (value !== '') this.appendChild(this.ownerDocument.createTextNode(String(value))); }
  }
  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    this.childNodes.push(child); child.parentNode = this; return child;
  }
  insertBefore(child, before) {
    if (child.parentNode) child.parentNode.removeChild(child);
    const index = this.childNodes.indexOf(before);
    if (index === -1) throw new Error('insertBefore target is not a child');
    this.childNodes.splice(index, 0, child); child.parentNode = this; return child;
  }
  removeChild(child) {
    const index = this.childNodes.indexOf(child);
    if (index === -1) throw new Error('removeChild target is not a child');
    this.childNodes.splice(index, 1); child.parentNode = null; return child;
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
    if (['disabled', 'checked'].includes(normalized)) this[normalized] = true;
  }
  removeAttribute(name) {
    const normalized = String(name).toLowerCase();
    this.attributes.delete(normalized);
    if (['disabled', 'checked'].includes(normalized)) this[normalized] = false;
  }
  getAttribute(name) { return this.attributes.get(String(name).toLowerCase()) ?? null; }
  focus() { this.ownerDocument.activeElement = this; }
  querySelector() { return null; }
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
globalThis.requestAnimationFrame = (callback) => callback();
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function mount(element) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(element); });
  return {
    container,
    async unmount() { await act(async () => { root.unmount(); }); container.parentNode?.removeChild(container); },
  };
}

function response(data, { status = 200 } = {}) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => status >= 400 ? data : ({ success: true, data }),
  });
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

const drafts = [
  { id: '507f1f77bcf86cd799439091', title: 'Newest Draft', publicationStatus: 'draft', isActive: true, updatedAt: '2026-09-30T03:00:00.000Z' },
  { id: '507f1f77bcf86cd799439092', title: 'Older Draft', publicationStatus: 'draft', isActive: true, updatedAt: '2026-09-30T02:00:00.000Z' },
];

function listData(items = drafts, page = 1, totalPages = 2) {
  return { recipes: items, pagination: { page, limit: 20, total: 21, totalPages } };
}

async function enterDraftReview(fetchImpl) {
  globalThis.fetch = fetchImpl;
  const mounted = await mount(createElement(RecipesTab, { canWrite: true }));
  const switchButton = findOne(mounted.container, (node) => node.nodeName === 'BUTTON' && node.textContent === 'Draft review', 'Draft review switch');
  await act(async () => { reactProps(switchButton).onClick(); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
  return mounted;
}

test('Moderator alone sees the production Draft review entry', () => {
  const moderator = renderToStaticMarkup(createElement(RecipesTab, { canWrite: true }));
  const admin = renderToStaticMarkup(createElement(RecipesTab, { canWrite: false }));
  assert.match(moderator, />Draft review<\/button>/u);
  assert.doesNotMatch(admin, />Draft review<\/button>/u);
});
test('initial Draft review performs one exact list request and selection performs one exact READY1 request', async () => {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/publish-readiness')) {
      return response({ publishReadiness: {
        ready: false,
        recipeId: drafts[0].id,
        recipeUpdatedAt: drafts[0].updatedAt,
        issues: [
          { code: 'RECIPE_INCOMPLETE', path: 'description', message: 'Description is required.' },
          { code: 'RECIPE_INGREDIENT_INACTIVE', path: 'ingredients.0.ingredientId', message: 'Ingredient is inactive.' },
        ],
        duplicateReview: {
          truncated: true, comparedCount: 500, candidateUniverseCount: 501,
          candidates: [{ recipe: { id: 'candidate', title: 'Adobo Twin', publicationStatus: 'published', publicationStatusSource: 'explicit', isActive: false }, classification: 'possible_variant', evidence: { titleExact: true } }],
        },
      } });
    }
    return response(listData());
  };
  const mounted = await enterDraftReview(globalThis.fetch);
  assert.equal(calls.length, 1);
  const listUrl = new URL(calls[0].url);
  assert.equal(listUrl.pathname.endsWith('/recipes'), true);
  assert.equal(listUrl.searchParams.get('publicationStatus'), 'draft');
  assert.equal(listUrl.searchParams.get('status'), 'active');
  assert.equal(listUrl.searchParams.get('sort'), 'updatedDesc');
  assert.equal(calls.filter(({ url }) => url.includes('publish-readiness')).length, 0);
  assert.match(mounted.container.textContent, /Newest Draft.*Older Draft/u);
  const initialRows = findAll(mounted.container, (node) => node.nodeName === 'TR' && /Draft/u.test(node.textContent));
  assert.equal(initialRows.filter((row) => /Not checked/u.test(row.textContent)).length, 2);

  const review = findOne(mounted.container, (node) => node.nodeName === 'BUTTON' && node.textContent === 'Review', 'Review action');
  await act(async () => { await reactProps(review).onClick(); });
  assert.equal(calls.filter(({ url }) => url.includes('publish-readiness')).length, 1);
  const readinessCall = calls.find(({ url }) => url.includes('publish-readiness'));
  assert.deepEqual(JSON.parse(readinessCall.options.body), { expectedUpdatedAt: drafts[0].updatedAt });
  assert.match(mounted.container.textContent, /Needs attention/u);
  assert.match(mounted.container.textContent, /Description is required\..*Ingredient is inactive\./u);
  assert.match(mounted.container.textContent, /Duplicate review required/u);
  assert.match(mounted.container.textContent, /Adobo Twin.*possible variant.*Archived/u);
  assert.match(mounted.container.textContent, /Comparison window incomplete: compared 500 of 501 candidates/u);
  const evaluatedRow = findOne(mounted.container, (node) => node.nodeName === 'TR' && /Newest Draft/u.test(node.textContent), 'evaluated Draft row');
  const untouchedRow = findOne(mounted.container, (node) => node.nodeName === 'TR' && /Older Draft/u.test(node.textContent), 'unevaluated Draft row');
  assert.match(evaluatedRow.textContent, /Needs attention/u);
  assert.doesNotMatch(evaluatedRow.textContent, /Not checked/u);
  assert.match(untouchedRow.textContent, /Not checked/u);
  assert.equal(findAll(mounted.container, (node) => node.nodeName === 'TIME' && node.getAttribute('datetime') === drafts[0].updatedAt).length >= 1, true);
  await mounted.unmount();
});

test('replacement loading removes old actions and rejects late READY1 from the old list context', async () => {
  const pendingReadiness = deferred();
  const pendingReplacement = deferred();
  const replacement = { ...drafts[0], id: '507f1f77bcf86cd799439099', title: 'Replacement Draft', updatedAt: '2026-09-30T05:00:00.000Z' };
  let readinessCalls = 0;
  globalThis.fetch = (url) => {
    const value = String(url);
    if (value.includes('/publish-readiness')) {
      readinessCalls += 1;
      return pendingReadiness.promise;
    }
    if (new URL(value).searchParams.get('search') === 'replacement') return pendingReplacement.promise;
    return response(listData());
  };
  const mounted = await enterDraftReview(globalThis.fetch);
  const oldReview = findOne(mounted.container, (node) => node.nodeName === 'BUTTON' && node.textContent === 'Review', 'old Review action');
  const retainedOldHandler = reactProps(oldReview).onClick;
  await act(async () => { retainedOldHandler(); });
  const busyPanel = findOne(mounted.container, (node) => node.nodeName === 'ASIDE', 'busy readiness panel');
  assert.equal(busyPanel.getAttribute('aria-busy'), 'true');
  assert.match(busyPanel.textContent, /Checking saved Draft/u);

  const search = findOne(mounted.container, (node) => node.nodeName === 'INPUT' && reactProps(node)['aria-label'] === 'Search Draft titles', 'Draft search');
  await act(async () => { reactProps(search).onChange({ target: { value: 'replacement' } }); });
  assert.doesNotMatch(mounted.container.textContent, /Newest Draft|Older Draft|Checking saved Draft/u);
  assert.match(mounted.container.textContent, /Loading Drafts/u);
  assert.equal(findAll(mounted.container, (node) => node.nodeName === 'BUTTON' && node.textContent === 'Review').length, 0);

  await act(async () => { retainedOldHandler(); });
  assert.equal(readinessCalls, 1, 'a retained old-row handler is inert during replacement loading');
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
  pendingReplacement.resolve(await response(listData([replacement], 1, 1)));
  await act(async () => { await pendingReplacement.promise; });
  assert.match(mounted.container.textContent, /Replacement Draft.*Not checked/u);

  pendingReadiness.resolve(await response({ publishReadiness: {
    ready: false,
    recipeId: drafts[0].id,
    recipeUpdatedAt: drafts[0].updatedAt,
    issues: [{ code: 'OLD', path: 'title', message: 'Late old-context readiness' }],
    duplicateReview: null,
  } }));
  await act(async () => { await pendingReadiness.promise; });
  assert.doesNotMatch(mounted.container.textContent, /Late old-context readiness|Needs attention/u);
  assert.match(mounted.container.textContent, /Replacement Draft.*Not checked/u);
  await mounted.unmount();
});

test('empty state and list error retry preserve explicit loading, alert, and empty semantics', async () => {
  let listAttempt = 0;
  globalThis.fetch = () => {
    listAttempt += 1;
    if (listAttempt === 1) return response({ error: { code: 'SERVER_ERROR', message: 'List unavailable', details: [] } }, { status: 500 });
    return response(listData([], 1, 1));
  };
  const mounted = await enterDraftReview(globalThis.fetch);
  const alert = findOne(mounted.container, (node) => node.getAttribute?.('role') === 'alert', 'list error alert');
  assert.match(alert.textContent, /List unavailable/u);
  const retry = findOne(alert, (node) => node.nodeName === 'BUTTON' && node.textContent === 'Retry', 'list retry');
  await act(async () => { reactProps(retry).onClick(); });
  const busyList = findOne(mounted.container, (node) => node.getAttribute?.('aria-busy') === 'true', 'busy Draft list');
  assert.match(busyList.textContent, /Loading Drafts/u);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
  assert.match(mounted.container.textContent, /No active Drafts match this view/u);
  assert.equal(findAll(mounted.container, (node) => node.getAttribute?.('role') === 'alert').length, 0);
  await mounted.unmount();
});

test('page replacement clears rows and title search resets the authoritative request to page 1', async () => {
  const listUrls = [];
  const pageTwo = [{ ...drafts[1], title: 'Page Two Draft' }];
  globalThis.fetch = (url) => {
    const parsed = new URL(String(url));
    listUrls.push(parsed);
    if (parsed.searchParams.get('search') === 'new') return response(listData([drafts[0]], 1, 1));
    if (parsed.searchParams.get('page') === '2') return response(listData(pageTwo, 2, 2));
    return response(listData());
  };
  const mounted = await enterDraftReview(globalThis.fetch);
  const next = findOne(mounted.container, (node) => node.nodeName === 'BUTTON' && node.textContent.includes('Next'), 'next page');
  await act(async () => { reactProps(next).onClick(); });
  assert.doesNotMatch(mounted.container.textContent, /Newest Draft|Older Draft/u);
  assert.match(mounted.container.textContent, /Loading Drafts/u);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
  assert.match(mounted.container.textContent, /Page Two Draft.*Not checked/u);

  const search = findOne(mounted.container, (node) => node.nodeName === 'INPUT' && reactProps(node)['aria-label'] === 'Search Draft titles', 'Draft search');
  await act(async () => { reactProps(search).onChange({ target: { value: 'new' } }); });
  assert.doesNotMatch(mounted.container.textContent, /Page Two Draft/u);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
  const lastRequest = listUrls.at(-1);
  assert.equal(lastRequest.searchParams.get('page'), '1');
  assert.equal(lastRequest.searchParams.get('search'), 'new');
  assert.match(mounted.container.textContent, /Newest Draft.*Not checked/u);
  await mounted.unmount();
});

test('rapid selection and search/page/list changes discard stale READY1 state', async () => {
  const pendingA = deferred();
  const calls = [];
  globalThis.fetch = (url, options = {}) => {
    const value = String(url);
    calls.push(value);
    if (value.includes(`${drafts[0].id}/publish-readiness`)) return pendingA.promise;
    if (value.includes(`${drafts[1].id}/publish-readiness`)) return response({ publishReadiness: {
      ready: true, recipeId: drafts[1].id, recipeUpdatedAt: drafts[1].updatedAt, issues: [],
      duplicateReview: { truncated: false, comparedCount: 2, candidateUniverseCount: 2, candidates: [] },
    } });
    const urlObject = new URL(value);
    const page = Number(urlObject.searchParams.get('page') || 1);
    return response(listData(drafts, page));
  };
  const mounted = await enterDraftReview(globalThis.fetch);
  let reviews = findAll(mounted.container, (node) => node.nodeName === 'BUTTON' && node.textContent === 'Review');
  await act(async () => { reactProps(reviews[0]).onClick(); });
  await act(async () => { await reactProps(reviews[1]).onClick(); });
  assert.match(mounted.container.textContent, /Ready to publish/u);
  assert.match(mounted.container.textContent, /No duplicate or variant candidates in the current bounded comparison/u);
  const readyRow = findOne(mounted.container, (node) => node.nodeName === 'TR' && /Older Draft/u.test(node.textContent), 'ready Draft row');
  const supersededRow = findOne(mounted.container, (node) => node.nodeName === 'TR' && /Newest Draft/u.test(node.textContent), 'superseded Draft row');
  assert.match(readyRow.textContent, /Ready to publish/u);
  assert.doesNotMatch(readyRow.textContent, /Not checked/u);
  assert.match(supersededRow.textContent, /Not checked/u);
  pendingA.resolve(await response({ publishReadiness: {
    ready: false, recipeId: drafts[0].id, recipeUpdatedAt: drafts[0].updatedAt,
    issues: [{ code: 'OLD', path: 'old', message: 'Late Draft A result' }], duplicateReview: null,
  } }));
  await act(async () => { await pendingA.promise; });
  assert.doesNotMatch(mounted.container.textContent, /Late Draft A result/u);
  assert.match(mounted.container.textContent, /Older Draft.*Ready to publish/u);

  const search = findOne(mounted.container, (node) => node.nodeName === 'INPUT' && reactProps(node)['aria-label'] === 'Search Draft titles', 'Draft search');
  await act(async () => { reactProps(search).onChange({ target: { value: 'adobo' } }); });
  assert.doesNotMatch(mounted.container.textContent, /Ready to publish/u);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });

  reviews = findAll(mounted.container, (node) => node.nodeName === 'BUTTON' && node.textContent === 'Review');
  await act(async () => { await reactProps(reviews[1]).onClick(); });
  const next = findOne(mounted.container, (node) => node.nodeName === 'BUTTON' && node.textContent.includes('Next'), 'next page');
  await act(async () => { reactProps(next).onClick(); });
  assert.doesNotMatch(mounted.container.textContent, /Ready to publish/u);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });

  reviews = findAll(mounted.container, (node) => node.nodeName === 'BUTTON' && node.textContent === 'Review');
  await act(async () => { await reactProps(reviews[1]).onClick(); });
  const refresh = findOne(mounted.container, (node) => node.nodeName === 'BUTTON' && node.textContent === 'Refresh list', 'refresh list');
  await act(async () => { reactProps(refresh).onClick(); });
  assert.doesNotMatch(mounted.container.textContent, /Ready to publish/u);
  assert.equal(calls.filter((url) => url.includes('publish-readiness')).length, 4);
  await mounted.unmount();
});

test('late READY1 response after Draft review unmount on view change cannot render', async () => {
  const pendingReadiness = deferred();
  globalThis.fetch = (url) => String(url).includes('/publish-readiness')
    ? pendingReadiness.promise
    : response(listData());
  const mounted = await enterDraftReview(globalThis.fetch);
  const review = findOne(mounted.container, (node) => node.nodeName === 'BUTTON' && node.textContent === 'Review', 'Review action');
  await act(async () => { reactProps(review).onClick(); });
  const catalog = findOne(mounted.container, (node) => node.nodeName === 'BUTTON' && node.textContent === 'Catalog', 'Catalog view switch');
  await act(async () => { reactProps(catalog).onClick(); });
  assert.doesNotMatch(mounted.container.textContent, /Checking saved Draft|Not checked/u);

  pendingReadiness.resolve(await response({ publishReadiness: {
    ready: true,
    recipeId: drafts[0].id,
    recipeUpdatedAt: drafts[0].updatedAt,
    issues: [],
    duplicateReview: null,
  } }));
  await act(async () => { await pendingReadiness.promise; });
  assert.doesNotMatch(mounted.container.textContent, /Ready to publish/u);
  assert.ok(findOne(mounted.container, (node) => node.nodeName === 'INPUT' && /Search title or description/u.test(node.getAttribute?.('placeholder') || ''), 'Catalog search'));
  await mounted.unmount();
});

test('conflict/error/identity states fail closed, retry is explicit, and Open Draft reaches the existing wizard', async () => {
  let readinessAttempt = 0;
  let listCalls = 0;
  globalThis.fetch = (url, options = {}) => {
    const value = String(url);
    if (value.endsWith(`/recipes/${drafts[0].id}`)) return response({ recipe: {
      ...drafts[0], description: null, region: null, category: null, difficulty: null,
      prepTimeMinutes: null, cookTimeMinutes: null, servings: null, ingredients: [],
      instructions: [], dietaryTags: [], imageUrl: null,
    } });
    if (!value.includes('/publish-readiness')) { listCalls += 1; return response(listData()); }
    readinessAttempt += 1;
    if (readinessAttempt === 1) return response({ error: { code: 'SERVER_ERROR', message: 'Safe failure', details: [] } }, { status: 500 });
    if (readinessAttempt === 2) return response({ publishReadiness: {
      ready: true, recipeId: drafts[0].id, recipeUpdatedAt: drafts[0].updatedAt, issues: [], duplicateReview: null,
    } });
    if (readinessAttempt === 3) return response({ publishReadiness: {
      ready: true, recipeId: drafts[0].id, recipeUpdatedAt: '2026-09-30T04:00:00.000Z', issues: [],
      duplicateReview: { truncated: false, comparedCount: 0, candidateUniverseCount: 0, candidates: [] },
    } });
    return response({ error: { code: 'RECIPE_EDIT_CONFLICT', message: 'Changed', details: [] } }, { status: 409 });
  };
  const mounted = await enterDraftReview(globalThis.fetch);
  let review = findOne(mounted.container, (node) => node.nodeName === 'BUTTON' && node.textContent === 'Review', 'Review action');
  await act(async () => { await reactProps(review).onClick(); });
  assert.match(mounted.container.textContent, /Could not check readiness.*Safe failure/u);
  const retry = findOne(mounted.container, (node) => node.nodeName === 'BUTTON' && node.textContent === 'Retry', 'readiness retry');
  await act(async () => { await reactProps(retry).onClick(); });
  assert.match(mounted.container.textContent, /Ready to publish.*Not evaluated by READY1 for this saved Draft/u);

  review = findOne(mounted.container, (node) => node.nodeName === 'BUTTON' && node.textContent === 'Review', 'Review action after retry');
  await act(async () => { await reactProps(review).onClick(); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
  assert.equal(listCalls, 2, 'response-version mismatch reloads the list');
  assert.doesNotMatch(mounted.container.textContent, /Ready to publish/u);

  review = findOne(mounted.container, (node) => node.nodeName === 'BUTTON' && node.textContent === 'Review', 'Review action after version refresh');
  await act(async () => { await reactProps(review).onClick(); });
  assert.match(mounted.container.textContent, /Draft changed - refresh the list and review it again/u);
  const open = findOne(mounted.container, (node) => node.nodeName === 'BUTTON' && node.textContent === 'Open Draft', 'Open Draft action');
  await act(async () => { reactProps(open).onClick(); });
  assert.ok(findOne(mounted.container, (node) => node.getAttribute?.('role') === 'dialog' && node.getAttribute('aria-labelledby') === 'recipe-author-title', 'existing authoring wizard'));
  await mounted.unmount();
});
