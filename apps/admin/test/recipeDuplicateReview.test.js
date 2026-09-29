import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';
import React, { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

import { publishBody } from '../src/recipeAuthoring/recipeAuthoringModel.js';
import {
  duplicateReviewGate, initialAuthoringState, recipeAuthoringReducer,
} from '../src/recipeAuthoring/recipeAuthoringState.js';

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
const recipeReviewModule = await vite.ssrLoadModule('/src/recipeAuthoring/RecipeReview.jsx');
const { default: RecipeReview } = recipeReviewModule;
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
    if (['disabled', 'checked'].includes(normalized)) this[normalized] = true;
  }
  removeAttribute(name) {
    const normalized = String(name).toLowerCase();
    this.attributes.delete(normalized);
    if (['disabled', 'checked'].includes(normalized)) this[normalized] = false;
  }
  getAttribute(name) { return this.attributes.get(String(name).toLowerCase()) ?? null; }
  focus() { this.ownerDocument.activeElement = this; }
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

function createHookHarness(hook, props = {}) {
  const slots = [];
  let cursor = 0;
  const nextSlot = (initialValue) => {
    const index = cursor++;
    if (!slots[index]) slots[index] = { value: initialValue };
    return slots[index];
  };
  const dispatcher = {
    useCallback(callback) { cursor += 1; return callback; },
    useEffect() { cursor += 1; },
    useMemo(factory) { cursor += 1; return factory(); },
    useReducer(reducer, initialArg, init) {
      const slot = nextSlot(init ? init(initialArg) : initialArg);
      return [slot.value, (action) => { slot.value = reducer(slot.value, action); }];
    },
    useRef(initialValue) { return nextSlot({ current: initialValue }).value; },
    useState(initialValue) {
      const slot = nextSlot(typeof initialValue === 'function' ? initialValue() : initialValue);
      return [slot.value, (value) => { slot.value = typeof value === 'function' ? value(slot.value) : value; }];
    },
  };
  return () => {
    cursor = 0;
    const internals = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
    const previous = internals.ReactCurrentDispatcher.current;
    internals.ReactCurrentDispatcher.current = dispatcher;
    try { return hook(props); }
    finally { internals.ReactCurrentDispatcher.current = previous; }
  };
}

async function loadAuthoringHookWithApi(api) {
  globalThis.__duplicateReviewTestApi = api;
  const hooks = registerHooks({
    load(url, context, nextLoad) {
      if (url.endsWith('/src/recipeApi.js')) {
        return { format: 'module', shortCircuit: true, source: `
          export const createDraft = (...args) => globalThis.__duplicateReviewTestApi.createDraft(...args);
          export const getRecipe = (...args) => globalThis.__duplicateReviewTestApi.getRecipe(...args);
          export const publishRecipe = (...args) => globalThis.__duplicateReviewTestApi.publishRecipe(...args);
          export const updateRecipe = (...args) => globalThis.__duplicateReviewTestApi.updateRecipe(...args);
          export const uploadRecipeImage = (...args) => globalThis.__duplicateReviewTestApi.uploadRecipeImage(...args);
          export const checkRecipeDuplicates = (...args) => globalThis.__duplicateReviewTestApi.checkRecipeDuplicates(...args);
        ` };
      }
      if (url.endsWith('/src/apiClient.js')) {
        return { format: 'module', shortCircuit: true, source: `
          export class ApiError extends Error {
            constructor(message, options = {}) { super(message); Object.assign(this, options); }
            get isForbidden() { return this.status === 403; }
            get isNetworkError() { return this.kind === 'network'; }
            get isUnauthorized() { return this.status === 401; }
          }
        ` };
      }
      return nextLoad(url, context);
    },
  });
  try {
    return (await import(`../src/recipeAuthoring/useRecipeAuthoring.js?duplicate=${Date.now()}-${Math.random()}`)).default;
  } finally {
    hooks.deregister();
  }
}

const review = {
  fingerprintVersion: 'recipe-duplicate-v1',
  resultDigest: 'a'.repeat(64),
  candidateLimit: 500,
  candidateUniverseCount: 1,
  comparedCount: 1,
  truncated: false,
  candidates: [{ recipe: { id: 'candidate', title: 'Adobo', publicationStatus: 'published', publicationStatusSource: 'explicit', isActive: true }, classification: 'exact_duplicate', evidence: { titleExact: true, ingredientMultisetExact: true, instructionSequenceExact: true, fingerprintEqual: true } }],
};

test('duplicate acknowledgement binds to exactly one current digest and enters only Publish', () => {
  let state = { ...initialAuthoringState(), currentStep: 'review', recipeId: 'recipe', publicationStatus: 'draft' };
  state = recipeAuthoringReducer(state, { type: 'DUPLICATE_CHECK_SUCCESS', review });
  assert.equal(duplicateReviewGate(state).allowed, false);
  state = recipeAuthoringReducer(state, { type: 'ACKNOWLEDGE_DUPLICATE_REVIEW', value: true });
  assert.equal(state.duplicateAcknowledgedDigest, review.resultDigest);
  assert.equal(duplicateReviewGate(state).allowed, true);
  assert.deepEqual(publishBody('updated', review), {
    confirmFilipinoCuisine: true,
    expectedUpdatedAt: 'updated',
    duplicateReview: { resultDigest: review.resultDigest, confirmDistinctRecipe: true },
  });
});

test('no-evidence bounded results still carry a digest and permit publish without a checkbox acknowledgement', () => {
  const noEvidence = { ...review, resultDigest: 'b'.repeat(64), candidateUniverseCount: 0, comparedCount: 0, candidates: [] };
  let state = initialAuthoringState();
  state = recipeAuthoringReducer(state, { type: 'DUPLICATE_CHECK_SUCCESS', review: noEvidence });
  assert.equal(state.duplicateReviewStatus, 'no_qualifying_evidence');
  assert.equal(duplicateReviewGate(state).allowed, true);
  assert.equal(publishBody('updated', noEvidence).duplicateReview.resultDigest, noEvidence.resultDigest);
});

test('comparison-input edits and authoritative replacement invalidate review while navigation and unrelated edits do not', () => {
  let state = { ...initialAuthoringState(), currentStep: 'review' };
  state = recipeAuthoringReducer(state, { type: 'DUPLICATE_CHECK_SUCCESS', review });
  state = recipeAuthoringReducer(state, { type: 'ACKNOWLEDGE_DUPLICATE_REVIEW', value: true });
  state = recipeAuthoringReducer(state, { type: 'SET_STEP', step: 'details' });
  assert.equal(state.duplicateAcknowledgedDigest, review.resultDigest);
  state = recipeAuthoringReducer(state, { type: 'CHANGE', field: 'difficulty', value: 'easy' });
  assert.equal(state.duplicateAcknowledgedDigest, review.resultDigest);
  state = recipeAuthoringReducer(state, { type: 'CHANGE', field: 'title', value: 'Changed' });
  assert.equal(state.duplicateReview, null);

  state = recipeAuthoringReducer(state, { type: 'DUPLICATE_CHECK_SUCCESS', review });
  state = recipeAuthoringReducer(state, { type: 'SET_UNRESOLVED_INGREDIENTS', lines: ['1 unknown leaf'] });
  assert.equal(state.duplicateReview, null, 'source replacement must invalidate the review');
});

test('stale server evidence replaces local results, clears acknowledgement, and requests focus without retrying', () => {
  let state = recipeAuthoringReducer(initialAuthoringState(), { type: 'DUPLICATE_CHECK_SUCCESS', review });
  state = recipeAuthoringReducer(state, { type: 'ACKNOWLEDGE_DUPLICATE_REVIEW', value: true });
  const fresh = { ...review, resultDigest: 'c'.repeat(64), truncated: true, candidateUniverseCount: 501 };
  state = recipeAuthoringReducer(state, { type: 'DUPLICATE_REVIEW_STALE', review: fresh, message: 'Stale.' });
  assert.equal(state.duplicateReviewStatus, 'stale');
  assert.equal(state.duplicateReview, fresh);
  assert.equal(state.duplicateAcknowledgedDigest, null);
  assert.equal(state.duplicateReviewFocusRequest, 1);
  assert.equal(duplicateReviewGate(state).allowed, false);
});

test('a stale publication 409 adopts fresh evidence and makes exactly one publication request', async () => {
  const fresh = { ...review, resultDigest: 'd'.repeat(64), truncated: true, candidateUniverseCount: 501 };
  let publishCalls = 0;
  const recipe = {
    id: 'recipe', title: 'Chicken Adobo', description: 'A complete saved Filipino recipe.', imageUrl: null,
    ingredients: [{ ingredient: { id: 'ingredient', name: 'Chicken' }, quantity: 1, unit: 'kg', optional: false, note: null }],
    instructions: ['Cook the chicken thoroughly.'], dietaryTags: [], difficulty: 'easy', prepTimeMinutes: 10,
    cookTimeMinutes: 30, servings: 4, region: null, category: null,
    publicationStatus: 'draft', isActive: true, updatedAt: '2026-09-29T00:00:00.000Z',
  };
  const api = {
    createDraft: async () => recipe,
    getRecipe: async () => recipe,
    updateRecipe: async () => recipe,
    uploadRecipeImage: async () => null,
    checkRecipeDuplicates: async () => review,
    publishRecipe: async () => {
      publishCalls += 1;
      throw Object.assign(new Error('Recipe duplicate review is stale.'), {
        code: 'RECIPE_DUPLICATE_REVIEW_STALE',
        details: [{ field: 'duplicateReview', duplicateReview: fresh }],
      });
    },
  };
  const useRecipeAuthoring = await loadAuthoringHookWithApi(api);
  const renderHook = createHookHarness(useRecipeAuthoring, { recipe });
  let authoring = renderHook();
  authoring.dispatch({ type: 'ACKNOWLEDGE', value: true });
  authoring.dispatch({ type: 'DUPLICATE_CHECK_SUCCESS', review });
  authoring.dispatch({ type: 'ACKNOWLEDGE_DUPLICATE_REVIEW', value: true });
  authoring = renderHook();

  await authoring.publish();
  authoring = renderHook();

  assert.equal(publishCalls, 1);
  assert.equal(authoring.state.duplicateReviewStatus, 'stale');
  assert.equal(authoring.state.duplicateReview, fresh);
  assert.equal(authoring.state.duplicateAcknowledgedDigest, null);
});

function reviewProps(overrides = {}) {
  const form = {
    title: 'Chicken Adobo', description: 'A complete saved recipe.', imageUrl: null,
    ingredients: [], instructions: ['Cook thoroughly.'], dietaryTags: [], difficulty: 'easy',
    prepTimeMinutes: '10', cookTimeHours: '0', cookTimeMinutePart: '30', servings: '4', region: '', category: '',
  };
  const readiness = { complete: true, sections: {
    basics: { complete: true, messages: [] }, ingredients: { complete: true, messages: [] },
    instructions: { complete: true, messages: [] }, details: { complete: true, messages: [] },
  } };
  return {
    form, readiness, recipeMeta: { recipeId: 'recipe', publicationStatus: 'draft', isActive: true },
    duplicateReview: null, duplicateReviewStatus: 'idle', duplicateReviewError: '',
    duplicateAcknowledgedDigest: null, duplicateReviewFocusRequest: 0, duplicateCheckNeedsSave: false,
    unresolvedIngredientCount: 0, busy: false, onCheckDuplicates() {}, onAcknowledgeDuplicateReview() {},
    ...overrides,
  };
}

function renderReview(overrides = {}) {
  return renderToStaticMarkup(createElement(RecipeReview, reviewProps(overrides)));
}

test('truncated rendered results show the incomplete-window warning, suppress clearance, and require acknowledgement', () => {
  const truncated = { ...review, candidates: [], truncated: true, candidateUniverseCount: 700, comparedCount: 500 };
  const html = renderReview({ duplicateReview: truncated, duplicateReviewStatus: 'no_qualifying_evidence' });
  assert.match(html, /role="status"[^>]*>Checked the newest 500 of 700 eligible Recipes\. Older eligible Recipes were not compared\./);
  assert.doesNotMatch(html, /No qualifying duplicate or variant evidence was found/);
  assert.match(html, /type="checkbox"/);
  assert.match(html, /I reviewed this result and want to continue as a distinct Recipe or variant/);
  assert.doesNotMatch(html, /no duplicates found/i);
});

test('bounded no-evidence result renders no acknowledgement control through default RecipeReview', () => {
  const noEvidence = {
    ...review, resultDigest: 'e'.repeat(64), candidateUniverseCount: 0, comparedCount: 0, truncated: false, candidates: [],
  };
  const html = renderReview({ duplicateReview: noEvidence, duplicateReviewStatus: 'no_qualifying_evidence' });
  assert.match(html, /No qualifying duplicate or variant evidence was found in the checked candidate window\./);
  assert.doesNotMatch(html, /type="checkbox"/);
  assert.doesNotMatch(html, /I reviewed this result and want to continue as a distinct Recipe or variant/);
});

test('default RecipeReview renders the frozen legacy Published lifecycle label', () => {
  const legacyCandidate = {
    recipe: {
      id: 'legacy-candidate', title: 'Legacy Adobo', publicationStatus: 'published',
      publicationStatusSource: 'legacy', isActive: true,
    },
    classification: 'exact_duplicate',
    evidence: { titleExact: true, ingredientMultisetExact: true, instructionSequenceExact: true, fingerprintEqual: true },
  };
  const html = renderReview({
    duplicateReview: { ...review, candidates: [legacyCandidate] }, duplicateReviewStatus: 'results',
  });
  assert.match(html, /Legacy Adobo<\/strong><span class="wc-pill">Published \u00b7 Legacy status<\/span>/);
});

test('default RecipeReview keeps each candidate inside its classification section', async () => {
  const groupedReview = {
    ...review,
    candidateUniverseCount: 2,
    comparedCount: 2,
    candidates: [
      { ...review.candidates[0], recipe: { ...review.candidates[0].recipe, id: 'exact', title: 'Exact candidate' } },
      {
        recipe: { id: 'variant', title: 'Variant candidate', publicationStatus: 'published', publicationStatusSource: 'explicit', isActive: true },
        classification: 'possible_variant',
        evidence: { titleExact: true, ingredientMultisetExact: false, instructionSequenceExact: true, fingerprintEqual: false },
      },
    ],
  };
  const mounted = await mount(createElement(RecipeReview, reviewProps({
    duplicateReview: groupedReview, duplicateReviewStatus: 'results',
  })));
  try {
    const exactSection = findOne(
      mounted.container,
      (node) => node.tagName === 'SECTION' && node.getAttribute('aria-labelledby') === 'duplicate-exact_duplicate',
      'exact-duplicate classification section'
    );
    const variantSection = findOne(
      mounted.container,
      (node) => node.tagName === 'SECTION' && node.getAttribute('aria-labelledby') === 'duplicate-possible_variant',
      'possible-variant classification section'
    );
    assert.match(exactSection.textContent, /Exact duplicates/);
    assert.match(exactSection.textContent, /Exact candidate/);
    assert.doesNotMatch(exactSection.textContent, /Variant candidate/);
    assert.match(variantSection.textContent, /Possible variants/);
    assert.match(variantSection.textContent, /Variant candidate/);
    assert.doesNotMatch(variantSection.textContent, /Exact candidate/);
  } finally {
    await mounted.unmount();
  }
});

test('default RecipeReview renders candidate lifecycle and true/false evidence from current result data', () => {
  const lifecycleReview = {
    ...review,
    candidateUniverseCount: 3,
    comparedCount: 3,
    candidates: [
      { ...review.candidates[0], recipe: { ...review.candidates[0].recipe, id: 'published', title: 'Published candidate' } },
      {
        recipe: { id: 'draft', title: 'Draft candidate', publicationStatus: 'draft', publicationStatusSource: 'explicit', isActive: true },
        classification: 'possible_variant',
        evidence: { titleExact: true, ingredientMultisetExact: false, instructionSequenceExact: true, fingerprintEqual: false },
      },
      {
        recipe: { id: 'archived', title: 'Archived candidate', publicationStatus: 'published', publicationStatusSource: 'explicit', isActive: false },
        classification: 'near_exact_duplicate',
        evidence: { titleExact: false, ingredientMultisetExact: true, instructionSequenceExact: true, fingerprintEqual: false },
      },
    ],
  };
  const html = renderReview({ duplicateReview: lifecycleReview, duplicateReviewStatus: 'results' });
  assert.match(html, /Published candidate<\/strong><span class="wc-pill">Published<\/span>/);
  assert.match(html, /Draft candidate<\/strong><span class="wc-pill">Draft<\/span>/);
  assert.match(html, /Archived candidate<\/strong><span class="wc-pill">Published · Archived<\/span>/);
  assert.match(html, /Published candidate[\s\S]*Title exact<\/dt><dd>Yes[\s\S]*Exact fingerprint payload<\/dt><dd>Yes/);
  assert.match(html, /Draft candidate[\s\S]*Ingredient multiset exact<\/dt><dd>No[\s\S]*Instruction sequence exact<\/dt><dd>Yes[\s\S]*Exact fingerprint payload<\/dt><dd>No/);
  assert.match(html, /Archived candidate[\s\S]*Title exact<\/dt><dd>No[\s\S]*Ingredient multiset exact<\/dt><dd>Yes/);
});

test('mounted default RecipeReview binds acknowledgement to the current digest and forwards checkbox events', async () => {
  assert.equal('DuplicateReviewResultState' in recipeReviewModule, false, 'internal result component must remain private');
  const changes = [];
  const mounted = await mount(createElement(RecipeReview, reviewProps({
    duplicateReview: review,
    duplicateReviewStatus: 'results',
    duplicateAcknowledgedDigest: 'b'.repeat(64),
    onAcknowledgeDuplicateReview: (value) => changes.push(value),
  })));
  try {
    const checkbox = findOne(mounted.container, (node) => node.tagName === 'INPUT' && reactProps(node).type === 'checkbox', 'duplicate acknowledgement checkbox');
    assert.equal(checkbox.checked, false, 'a stale digest must not render accepted');
    await act(async () => { reactProps(checkbox).onChange({ target: { checked: true } }); });
    assert.deepEqual(changes, [true], 'default RecipeReview must forward the real checkbox value');

    await mounted.render(createElement(RecipeReview, reviewProps({
      duplicateReview: review,
      duplicateReviewStatus: 'results',
      duplicateAcknowledgedDigest: review.resultDigest,
      onAcknowledgeDuplicateReview: (value) => changes.push(value),
    })));
    const currentCheckbox = findOne(mounted.container, (node) => node.tagName === 'INPUT' && reactProps(node).type === 'checkbox', 'current acknowledgement checkbox');
    assert.equal(currentCheckbox.checked, true, 'only the matching current digest renders accepted');
    await act(async () => { reactProps(currentCheckbox).onChange({ target: { checked: false } }); });
    assert.deepEqual(changes, [true, false], 'default RecipeReview must forward both checkbox values');
  } finally {
    await mounted.unmount();
  }
});

test('rendered Review attaches saved-canonical warning and busy/status/error accessibility semantics to actual states', () => {
  const html = renderReview({ duplicateReviewStatus: 'checking', unresolvedIngredientCount: 2 });
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /role="status">Checking the eligible Recipe window/);
  assert.match(html, /This check uses only saved canonical Recipe ingredients\. Unresolved imported ingredient rows were not compared\./);
  const errorHtml = renderReview({ duplicateReview: null, duplicateReviewStatus: 'error', duplicateReviewError: 'Safe failure' });
  assert.match(errorHtml, /role="alert">Safe failure<\/p>/);
});

test('stale rendered evidence exposes retry/review state and disables its cleared acknowledgement', () => {
  const html = renderReview({
    duplicateReview: review, duplicateReviewStatus: 'stale', duplicateReviewError: 'Review is stale.',
    duplicateAcknowledgedDigest: null,
  });
  assert.match(html, /role="alert">Review is stale\.<\/p>/);
  assert.match(html, /role="status">The saved review changed\./);
  assert.match(html, /type="checkbox" disabled=""/);
  assert.doesNotMatch(html, /checked=""/);
  assert.match(html, />Check again<\/button>/);
});
