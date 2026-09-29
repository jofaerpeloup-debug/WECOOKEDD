import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
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
  get textContent() {
    return this.nodeType === 3 ? this.nodeValue : this.childNodes.map((child) => child.textContent).join('');
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
    async render(next) { await act(async () => { root.render(next); }); },
    async unmount() {
      await act(async () => { root.unmount(); });
      container.parentNode?.removeChild(container);
    },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
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

const [ingredientModule, stepsModule, apiClientModule, authoringStateModule] = await Promise.all([
  vite.ssrLoadModule('/src/IngredientsTab.jsx'),
  vite.ssrLoadModule('/src/recipeAuthoring/RecipeAuthoringSteps.jsx'),
  vite.ssrLoadModule('/src/apiClient.js'),
  vite.ssrLoadModule('/src/recipeAuthoring/recipeAuthoringState.js'),
]);
after(() => vite.close());

const {
  default: IngredientsTab,
  IngredientModal,
  ingredientModalInitialForm,
} = ingredientModule;
const {
  IngredientResolutionPanel, IngredientResolutionPanelWithCreation, requestIngredientResolutions,
} = stepsModule;
const { ApiError } = apiClientModule;
const { initialAuthoringState, recipeAuthoringReducer } = authoringStateModule;

function importedInitialValues(name = 'Calamansi') {
  return { name, aliases: [], category: '', allergenTags: [] };
}

function eligibleState(overrides = {}) {
  return {
    unresolvedIngredients: [{
      key: 'source-3-0', generation: 3, sourceText: '  2 calamansi, juiced  ',
      resolutionError: '', selectedIngredient: null, quantity: '2', unit: 'piece',
      resolution: {
        parsed: { name: ' calamansi ', quantity: 2, unit: 'piece' },
        match: { kind: 'none', totalCandidates: 0, truncated: false, candidates: [] },
      },
      ...overrides,
    }],
    ingredientResolutionGeneration: 3,
    ingredientResolutionStatus: 'idle',
    ingredientResolutionError: '',
  };
}

function byId(root, id) {
  return findOne(root, (node) => node.id === id, `#${id}`);
}

function button(root, label, index = 0) {
  const matches = findAll(root, (node) => node.tagName === 'BUTTON' && node.textContent.includes(label));
  assert.ok(matches[index], `Expected mounted button ${label} at index ${index}`);
  return matches[index];
}

function form(root) { return findOne(root, (node) => node.tagName === 'FORM', 'form'); }
function dialog(root) { return findOne(root, (node) => node.getAttribute?.('role') === 'dialog', 'dialog'); }

async function change(node, value) {
  await act(async () => { reactProps(node).onChange({ target: { value } }); });
}

async function click(node) {
  await act(async () => {
    reactProps(node).onClick?.({
      currentTarget: node, target: node, preventDefault() {}, stopPropagation() {},
    });
  });
}

async function startSubmit(node) {
  let submission;
  await act(async () => {
    submission = reactProps(node).onSubmit({ preventDefault() {} });
    await Promise.resolve();
  });
  return { promise: submission };
}

async function settleSubmit(submission) {
  await act(async () => { await submission.promise; });
}

function resolvedAuthoringState(lines = ['1 calamansi']) {
  let state = recipeAuthoringReducer(initialAuthoringState(), {
    type: 'SET_UNRESOLVED_INGREDIENTS', lines,
  });
  const request = {
    lines,
    submitted: lines.map((sourceText, queueIndex) => ({ queueIndex, sourceText })),
    excluded: [],
  };
  state = recipeAuthoringReducer(state, {
    type: 'INGREDIENT_RESOLUTION_SUCCESS',
    generation: state.ingredientResolutionGeneration,
    request,
    resolutions: lines.map((sourceText, index) => ({
      index, sourceText,
      parsed: { quantity: 1, unit: 'piece', name: 'calamansi' },
      match: { kind: 'none', totalCandidates: 0, truncated: false, candidates: [] },
    })),
  });
  return state;
}

test('imported modal prefill is bounded to parsed name while source is display-only context', () => {
  assert.deepEqual(ingredientModalInitialForm(null, importedInitialValues('  Calamansi  ')), {
    name: 'Calamansi', aliasesText: '', category: '', allergenTags: [], isActive: true,
  });
  const markup = renderToStaticMarkup(createElement(IngredientModal, {
    initialValues: importedInitialValues('Calamansi'),
    sourceContext: '2 calamansi, juiced',
    onClose() {},
    onSubmit() {},
  }));
  assert.match(markup, /Imported source/);
  assert.match(markup, /2 calamansi, juiced/);
  assert.match(markup, /value="Calamansi"/);
  assert.match(markup, /<option value="" disabled="" selected="">Choose a category<\/option>/);
  assert.match(markup, /id="ingredient-aliases"[^>]*value=""/);
  assert.doesNotMatch(markup, /value="2 calamansi, juiced"/);
  assert.doesNotMatch(markup, /Status/);
});

test('resolver renders creation only for the eligible row and hides it once selected', () => {
  const render = (state) => renderToStaticMarkup(createElement(IngredientResolutionPanel, {
    state, dispatch() {}, busy: false, onAuthorityLost() {},
  }));
  assert.match(render(eligibleState()), /\+ Create Ingredient/);
  assert.doesNotMatch(render(eligibleState({ selectedIngredient: { id: 'i1', name: 'Calamansi' } })), /\+ Create Ingredient/);
  assert.doesNotMatch(render(eligibleState({ resolution: {
    parsed: { name: 'calamansi' },
    match: { kind: 'possible', totalCandidates: 0, truncated: false, candidates: [] },
  } })), /\+ Create Ingredient/);
});

test('mounted resolver retry removes stale creation eligibility without clearing an unrelated manual selection', async () => {
  let state = resolvedAuthoringState(['1 calamansi', '1 coconut milk']);
  const dispatch = (action) => { state = recipeAuthoringReducer(state, action); };
  const view = () => createElement(IngredientResolutionPanel, {
    state, dispatch, busy: false, onAuthorityLost() {},
  });
  const mounted = await mount(view());
  try {
    const manualSelection = { id: 'manual-id', name: 'Coconut milk' };
    dispatch({ type: 'UPDATE_INGREDIENT_RESOLUTION', index: 1, patch: { selectedIngredient: manualSelection } });
    await mounted.render(view());
    assert.equal(findAll(mounted.container, (node) => node.tagName === 'BUTTON' && node.textContent.includes('+ Create Ingredient')).length, 1);

    const failedRetry = deferred();
    const failedRetryRequest = requestIngredientResolutions({
      queue: state.unresolvedIngredients,
      generation: state.ingredientResolutionGeneration,
      dispatch,
      request: () => failedRetry.promise,
    });
    await mounted.render(view());
    assert.equal(state.ingredientResolutionStatus, 'loading');
    assert.equal(findAll(mounted.container, (node) => node.tagName === 'BUTTON' && node.textContent.includes('+ Create Ingredient')).length, 0);
    assert.deepEqual(state.unresolvedIngredients[1].selectedIngredient, manualSelection);

    failedRetry.reject(new Error('Catalog unavailable'));
    await failedRetryRequest;
    await mounted.render(view());
    assert.equal(findAll(mounted.container, (node) => node.tagName === 'BUTTON' && node.textContent.includes('+ Create Ingredient')).length, 0);
    assert.match(mounted.container.textContent, /Catalog unavailable/u);
    assert.deepEqual(state.unresolvedIngredients[1].selectedIngredient, manualSelection);

    await requestIngredientResolutions({
      queue: state.unresolvedIngredients,
      generation: state.ingredientResolutionGeneration,
      dispatch,
      request: async () => state.unresolvedIngredients.map((entry, index) => ({
        index, sourceText: entry.sourceText,
        parsed: { quantity: 1, unit: 'piece', name: index === 0 ? 'calamansi' : 'coconut milk' },
        match: { kind: 'none', totalCandidates: 0, truncated: false, candidates: [] },
      })),
    });
    await mounted.render(view());
    const restoredRow = findOne(mounted.container, (node) => node.tagName === 'LI' && node.textContent.includes('1 calamansi'), 'restored calamansi row');
    assert.equal(findAll(restoredRow, (node) => node.tagName === 'BUTTON' && node.textContent.includes('+ Create Ingredient')).length, 1);
  } finally {
    await mounted.unmount();
  }
});

test('mounted eligible row restores focus after close, Escape, and backdrop dismissal without a request', async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests += 1; throw new Error('unexpected request'); };
  const mounted = await mount(createElement(IngredientResolutionPanelWithCreation, {
    state: eligibleState(), dispatch() {}, busy: false, onAuthorityLost() {},
  }));
  try {
    const create = button(mounted.container, '+ Create Ingredient');
    await click(create);
    assert.equal(document.activeElement, byId(mounted.container, 'ingredient-name'));
    assert.equal(requests, 0);

    const currentDialog = dialog(mounted.container);
    const close = button(currentDialog, '', 0);
    const submit = button(currentDialog, 'Add ingredient');
    submit.focus();
    reactProps(currentDialog).onKeyDown({ key: 'Tab', shiftKey: false, preventDefault() {}, stopPropagation() {} });
    assert.equal(document.activeElement, close, 'Tab from the last control must wrap to the first control');
    close.focus();
    reactProps(currentDialog).onKeyDown({ key: 'Tab', shiftKey: true, preventDefault() {}, stopPropagation() {} });
    assert.equal(document.activeElement, submit, 'Shift+Tab from the first control must wrap to the last control');

    await click(close);
    assert.equal(findAll(mounted.container, (node) => node.getAttribute?.('role') === 'dialog').length, 0);
    assert.equal(document.activeElement, create, 'focus must return to the originating create action');
    assert.equal(requests, 0);

    await click(create);
    await act(async () => {
      reactProps(dialog(mounted.container)).onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
    });
    assert.equal(findAll(mounted.container, (node) => node.getAttribute?.('role') === 'dialog').length, 0);
    assert.equal(document.activeElement, create, 'Escape must restore focus to the originating create action');
    assert.equal(requests, 0);

    await click(create);
    const overlay = findOne(mounted.container, (node) => String(node.className).includes('wc-modal-overlay'), 'modal overlay');
    await act(async () => {
      reactProps(overlay).onMouseDown({ target: overlay, currentTarget: overlay, stopPropagation() {} });
    });
    assert.equal(findAll(mounted.container, (node) => node.getAttribute?.('role') === 'dialog').length, 0);
    assert.equal(document.activeElement, create, 'backdrop dismissal must restore focus to the originating create action');
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await mounted.unmount();
  }
});

test('mounted imported modal requires an explicit category before any request', async () => {
  let requests = 0;
  const mounted = await mount(createElement(IngredientModal, {
    initialValues: importedInitialValues('Calamansi'),
    sourceContext: '1 calamansi',
    onClose() {},
    async onSubmit() { requests += 1; },
  }));
  try {
    const submission = await startSubmit(form(mounted.container));
    await settleSubmit(submission);
    assert.equal(requests, 0);
    assert.match(mounted.container.textContent, /valid category/i);
    assert.ok(dialog(mounted.container));
  } finally {
    await mounted.unmount();
  }
});

test('mounted modal prevents double submit and dismissal, locks every field while saving, then retains values and permits retry', async () => {
  const pending = deferred();
  const calls = [];
  const successes = [];
  let closes = 0;
  const mounted = await mount(createElement(IngredientModal, {
    initialValues: importedInitialValues('Calamansi'),
    sourceContext: '2 calamansi, juiced',
    onClose() { closes += 1; },
    onSuccess(ingredient) { successes.push(ingredient); },
    onSubmit(payload) {
      calls.push(payload);
      return calls.length === 1 ? pending.promise : Promise.resolve({ id: 'created-id', name: payload.name });
    },
  }));
  try {
    await change(byId(mounted.container, 'ingredient-aliases'), 'golden lime');
    await change(byId(mounted.container, 'ingredient-category'), 'produce');
    await click(button(mounted.container, 'Milk'));
    const mountedForm = form(mounted.container);
    const firstSubmission = await startSubmit(mountedForm);
    const duplicateSubmission = reactProps(mountedForm).onSubmit({ preventDefault() {} });
    await duplicateSubmission;
    assert.equal(calls.length, 1, 'a deferred request must not permit a second submit');

    for (const id of ['ingredient-name', 'ingredient-aliases', 'ingredient-category']) {
      assert.equal(byId(mounted.container, id).disabled, true, `${id} must be disabled while saving`);
    }
    const allergenButtons = findAll(mounted.container, (node) => node.tagName === 'BUTTON' && String(node.className).includes('wc-chip'));
    assert.ok(allergenButtons.length > 0);
    assert.ok(allergenButtons.every((node) => node.disabled), 'allergen controls must be disabled while saving');
    const close = findOne(mounted.container, (node) => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === 'Close', 'close control');
    assert.equal(close.disabled, true, 'close control must be disabled while saving');
    assert.equal(findOne(mounted.container, (node) => node.tagName === 'BUTTON' && String(node.className).includes('wc-btn-primary'), 'submit button').disabled, true);
    assert.equal(button(mounted.container, 'Cancel').disabled, true);

    await click(close);
    await click(button(mounted.container, 'Cancel'));
    const overlay = findOne(mounted.container, (node) => String(node.className).includes('wc-modal-overlay'), 'modal overlay');
    await act(async () => {
      reactProps(overlay).onMouseDown({ target: overlay, currentTarget: overlay, stopPropagation() {} });
      reactProps(dialog(mounted.container)).onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
    });
    assert.equal(closes, 0, 'all dismissal paths must stay locked while saving');

    pending.reject(new ApiError('Unable to reach the API.', { kind: 'network', code: 'NETWORK_ERROR' }));
    await settleSubmit(firstSubmission);
    assert.equal(byId(mounted.container, 'ingredient-name').value, 'Calamansi');
    assert.equal(byId(mounted.container, 'ingredient-aliases').value, 'golden lime');
    assert.equal(byId(mounted.container, 'ingredient-category').value, 'produce');
    for (const id of ['ingredient-name', 'ingredient-aliases', 'ingredient-category']) {
      assert.equal(byId(mounted.container, id).disabled, false, `${id} must be editable after failure`);
    }
    const recoveredAllergenButtons = findAll(mounted.container, (node) => node.tagName === 'BUTTON' && String(node.className).includes('wc-chip'));
    assert.ok(recoveredAllergenButtons.every((node) => !node.disabled), 'allergen controls must be editable after failure');
    assert.ok(String(button(mounted.container, 'Milk').className).includes('selected'), 'reviewed allergen selection must remain intact');
    assert.equal(findOne(mounted.container, (node) => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === 'Close', 'close control').disabled, false);
    assert.equal(button(mounted.container, 'Cancel').disabled, false);
    assert.match(mounted.container.textContent, /Unable to reach the API/u);

    const retry = await startSubmit(form(mounted.container));
    await settleSubmit(retry);
    assert.equal(calls.length, 2, 'retry must be another explicit submit');
    assert.deepEqual(calls[1], {
      name: 'Calamansi', aliases: ['golden lime'], category: 'produce', allergenTags: ['milk'],
    });
    assert.deepEqual(successes, [{ id: 'created-id', name: 'Calamansi' }]);
    assert.equal(closes, 1);
  } finally {
    await mounted.unmount();
  }
});

test('mounted modal retains reviewed values for 400, 409, final 401, 403, and 5xx failures', async () => {
  const cases = [
    {
      error: new ApiError('Bad name.', { status: 400, code: 'VALIDATION_ERROR', details: [{ field: 'name', message: 'Backend name error.' }] }),
      expected: /Backend name error/u,
    },
    {
      error: new ApiError('Already exists.', { status: 409, code: 'INGREDIENT_ALREADY_EXISTS' }),
      expected: /including archived records/u,
    },
    { error: new ApiError('Unauthorized.', { status: 401 }), expected: /session has expired/u },
    { error: new ApiError('Permission changed.', { status: 403 }), expected: /Permission changed/u, authority: true },
    { error: new ApiError('Safe server failure.', { status: 500 }), expected: /Safe server failure/u },
  ];
  for (const failure of cases) {
    let authorityLosses = 0;
    let closes = 0;
    const mounted = await mount(createElement(IngredientModal, {
      initialValues: importedInitialValues('Reviewed name'),
      sourceContext: 'source',
      onClose() { closes += 1; },
      onAuthorityLost() { authorityLosses += 1; },
      async onSubmit() { throw failure.error; },
    }));
    try {
      await change(byId(mounted.container, 'ingredient-aliases'), 'reviewed alias');
      await change(byId(mounted.container, 'ingredient-category'), 'pantry');
      const submission = await startSubmit(form(mounted.container));
      await settleSubmit(submission);
      assert.match(mounted.container.textContent, failure.expected);
      assert.equal(byId(mounted.container, 'ingredient-name').value, 'Reviewed name');
      assert.equal(byId(mounted.container, 'ingredient-aliases').value, 'reviewed alias');
      assert.equal(byId(mounted.container, 'ingredient-category').value, 'pantry');
      assert.equal(byId(mounted.container, 'ingredient-name').disabled, false);
      assert.equal(closes, 0);
      assert.equal(authorityLosses, failure.authority ? 1 : 0);
    } finally {
      await mounted.unmount();
    }
  }
});

test('mounted imported flow submits the real create API body, binds only the targeted duplicate row, and still requires Confirm ingredient', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const serverIngredient = { id: 'server-id', name: 'Canonical Calamansi', category: 'produce', aliases: [] };
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: true, status: 201, async json() { return { success: true, data: { ingredient: serverIngredient } }; } };
  };
  let state = resolvedAuthoringState(['1 calamansi', '1 calamansi']);
  const originalForm = state.form;
  const dispatch = (action) => { state = recipeAuthoringReducer(state, action); };
  const view = () => createElement(IngredientResolutionPanelWithCreation, {
    state, dispatch, busy: false, onAuthorityLost() {},
  });
  const mounted = await mount(view());
  try {
    await click(button(mounted.container, '+ Create Ingredient', 1));
    await change(byId(mounted.container, 'ingredient-category'), 'produce');
    const submission = await startSubmit(form(mounted.container));
    await settleSubmit(submission);
    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /\/ingredients$/u);
    assert.deepEqual(JSON.parse(requests[0].options.body), {
      name: 'calamansi', aliases: [], category: 'produce', allergenTags: [],
    });
    assert.equal(state.unresolvedIngredients.length, 2);
    assert.equal(state.unresolvedIngredients[0].selectedIngredient, null);
    assert.deepEqual(state.unresolvedIngredients[1].selectedIngredient, { id: 'server-id', name: 'Canonical Calamansi' });
    assert.equal(state.form, originalForm, 'catalog success must not create a Recipe row');

    await mounted.render(view());
    await click(button(mounted.container, 'Confirm ingredient', 1));
    assert.equal(state.unresolvedIngredients.length, 1);
    assert.equal(state.unresolvedIngredients[0].key, 'source-1-0');
    assert.deepEqual(state.form.ingredients[0].ingredient, { id: 'server-id', name: 'Canonical Calamansi' });
  } finally {
    globalThis.fetch = originalFetch;
    await mounted.unmount();
  }
});

test('mounted pending success cannot bind after source replacement or disappearance', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const replacement of [['replacement source'], []]) {
      const pending = deferred();
      globalThis.fetch = () => pending.promise;
      let state = resolvedAuthoringState(['original source']);
      const originalGeneration = state.ingredientResolutionGeneration;
      const dispatch = (action) => { state = recipeAuthoringReducer(state, action); };
      const view = () => createElement(IngredientResolutionPanelWithCreation, {
        state, dispatch, busy: false, onAuthorityLost() {},
      });
      const mounted = await mount(view());
      try {
        await click(button(mounted.container, '+ Create Ingredient'));
        await change(byId(mounted.container, 'ingredient-category'), 'produce');
        const submission = await startSubmit(form(mounted.container));
        state = recipeAuthoringReducer(state, { type: 'SET_UNRESOLVED_INGREDIENTS', lines: replacement });
        assert.notEqual(state.ingredientResolutionGeneration, originalGeneration);
        await mounted.render(view());
        pending.resolve({
          ok: true, status: 201,
          async json() { return { success: true, data: { ingredient: { id: 'late-id', name: 'Late result' } } }; },
        });
        await settleSubmit(submission);
        assert.deepEqual(state.unresolvedIngredients.map((entry) => entry.sourceText), replacement);
        assert.ok(state.unresolvedIngredients.every((entry) => entry.selectedIngredient === null));
      } finally {
        await mounted.unmount();
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('mounted standalone Ingredient edit retains PATCH behavior', async () => {
  const payloads = [];
  let closes = 0;
  const ingredient = {
    id: 'existing-id', name: 'Butter', aliases: [], category: 'dairy', allergenTags: ['milk'], isActive: true,
  };
  const mounted = await mount(createElement(IngredientModal, {
    ingredient,
    onClose() { closes += 1; },
    async onSubmit(payload) { payloads.push(payload); return { ...ingredient, ...payload }; },
  }));
  try {
    await change(byId(mounted.container, 'ingredient-name'), 'Cultured Butter');
    const submission = await startSubmit(form(mounted.container));
    await settleSubmit(submission);
    assert.deepEqual(payloads, [{ name: 'Cultured Butter' }]);
    assert.equal(closes, 1);
  } finally {
    await mounted.unmount();
  }
});

test('mounted standalone Add keeps its default category and real successful creation path', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if ((options.method || 'GET') === 'POST') {
      return {
        ok: true,
        status: 201,
        async json() {
          return { success: true, data: { ingredient: { id: 'standalone-id', name: 'Ginger', category: 'produce', aliases: [], allergenTags: [] } } };
        },
      };
    }
    return {
      ok: true,
      status: 200,
      async json() { return { success: true, data: { ingredients: [], pagination: { page: 1, totalPages: 1, total: 0 } } }; },
    };
  };
  const mounted = await mount(createElement(IngredientsTab, { canWrite: true, onAuthorityLost() {} }));
  try {
    await click(button(mounted.container, 'Add ingredient'));
    assert.equal(byId(mounted.container, 'ingredient-category').value, 'produce', 'standalone Add must keep its existing default category');
    await change(byId(mounted.container, 'ingredient-name'), 'Ginger');
    const submission = await startSubmit(form(mounted.container));
    await settleSubmit(submission);

    const posts = requests.filter(({ options }) => options.method === 'POST');
    assert.equal(posts.length, 1);
    assert.match(posts[0].url, /\/ingredients$/u);
    assert.deepEqual(JSON.parse(posts[0].options.body), {
      name: 'Ginger', aliases: [], category: 'produce', allergenTags: [],
    });
    assert.equal(findAll(mounted.container, (node) => node.getAttribute?.('role') === 'dialog').length, 0, 'successful standalone creation must close the modal');
  } finally {
    globalThis.fetch = originalFetch;
    await mounted.unmount();
  }
});
