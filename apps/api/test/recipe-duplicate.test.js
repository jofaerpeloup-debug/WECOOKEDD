const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { dirname } = require('node:path');
const Module = require('node:module');

const {
  FINGERPRINT_VERSION,
  canonicalRecipePayload,
  classifyRecipe,
  createDuplicateReview,
  fingerprintRecipe,
} = require('../src/modules/recipes/recipe-duplicate');

const INGREDIENT_A = '507f1f77bcf86cd799439011';
const INGREDIENT_B = '507f1f77bcf86cd799439012';

function recipe(overrides = {}) {
  return {
    _id: overrides._id || '507f1f77bcf86cd799439099',
    title: 'Chicken Adobo',
    ingredients: [{ ingredientId: INGREDIENT_A, quantity: 1, unit: 'kg' }],
    instructions: ['Brown chicken.', 'Simmer sauce.'],
    publicationStatus: 'published',
    isActive: true,
    updatedAt: '2026-09-29T00:00:00.000Z',
    ...overrides,
  };
}

function loadClassificationMutant(classification) {
  const filename = require.resolve('../src/modules/recipes/recipe-duplicate');
  const source = readFileSync(filename, 'utf8');
  const anchor = 'return comparison.classification ? { recipe, ...comparison } : null;';
  assert.equal(source.split(anchor).length - 1, 1, 'classification result anchor must be unique');
  const mutant = new Module(filename, module);
  mutant.filename = filename;
  mutant.paths = Module._nodeModulePaths(dirname(filename));
  mutant._compile(
    source.replace(anchor, `return comparison.classification ? { recipe, ...comparison, classification: '${classification}' } : null;`),
    filename
  );
  return mutant.exports;
}

test('canonical payload uses the frozen normalization and preserves repeated usages', () => {
  const value = recipe({
    title: '  CHICKEN\u2003Ado\u0301bo  ',
    ingredients: [
      { ingredientId: INGREDIENT_B.toUpperCase(), quantity: null, unit: 'toTaste' },
      { ingredientId: INGREDIENT_A, quantity: 1, unit: 'kg' },
      { ingredientId: INGREDIENT_A, quantity: 1, unit: 'kg' },
    ],
  });
  const payload = canonicalRecipePayload(value);
  assert.equal(payload.version, FINGERPRINT_VERSION);
  assert.equal(payload.titleKey, 'chicken adóbo');
  assert.equal(payload.ingredientMultiset.length, 3);
  assert.equal(payload.ingredientMultiset.filter(([id]) => id === INGREDIENT_A).length, 2);
  assert.deepEqual(payload.instructionSequence, value.instructions);
});

test('classification precedence covers exact, near-exact, possible variant, same-title-only, and unrelated', () => {
  const subject = recipe();
  assert.equal(classifyRecipe(subject, recipe({ _id: '1' })).classification, 'exact_duplicate');
  assert.equal(classifyRecipe(subject, recipe({ _id: '2', title: 'Adobong Manok' })).classification, 'near_exact_duplicate');
  assert.equal(classifyRecipe(subject, recipe({ _id: '3', instructions: ['Different steps.'] })).classification, 'possible_variant');
  assert.equal(classifyRecipe(subject, recipe({
    _id: '4', ingredients: [{ ingredientId: INGREDIENT_B, quantity: 2, unit: 'piece' }], instructions: ['Different steps.'],
  })).classification, null);
  assert.equal(classifyRecipe(subject, recipe({
    _id: '5', title: 'Sinigang', ingredients: [{ ingredientId: INGREDIENT_B, quantity: 2, unit: 'piece' }], instructions: ['Different steps.'],
  })).classification, null);
});

test('ingredient equality is an exact multiset with exact quantity and unit and no conversion', () => {
  const repeated = recipe({ ingredients: [
    { ingredientId: INGREDIENT_A, quantity: 1, unit: 'kg' },
    { ingredientId: INGREDIENT_A, quantity: 1, unit: 'kg' },
  ] });
  assert.equal(classifyRecipe(repeated, recipe()).evidence.ingredientMultisetExact, false);
  assert.equal(classifyRecipe(recipe(), recipe({ ingredients: [{ ingredientId: INGREDIENT_A, quantity: 1000, unit: 'g' }] })).evidence.ingredientMultisetExact, false);
  assert.equal(classifyRecipe(
    recipe({ ingredients: [{ ingredientId: INGREDIENT_A, quantity: 1, unit: 'lb' }] }),
    recipe({ ingredients: [{ ingredientId: INGREDIENT_A, quantity: 16, unit: 'oz' }] })
  ).evidence.ingredientMultisetExact, false);
});

test('quantity, unit, null quantity, and repeated-usage multiplicity are independent comparison inputs', () => {
  const subject = recipe({ ingredients: [
    { ingredientId: INGREDIENT_A, quantity: 1, unit: 'kg' },
    { ingredientId: INGREDIENT_A, quantity: 1, unit: 'kg' },
    { ingredientId: INGREDIENT_B, quantity: 2, unit: 'piece' },
  ] });
  const quantityOnly = recipe({ ingredients: [
    { ingredientId: INGREDIENT_A, quantity: 2, unit: 'kg' },
    { ingredientId: INGREDIENT_A, quantity: 1, unit: 'kg' },
    { ingredientId: INGREDIENT_B, quantity: 2, unit: 'piece' },
  ] });
  const unitOnly = recipe({ ingredients: [
    { ingredientId: INGREDIENT_A, quantity: 1, unit: 'g' },
    { ingredientId: INGREDIENT_A, quantity: 1, unit: 'kg' },
    { ingredientId: INGREDIENT_B, quantity: 2, unit: 'piece' },
  ] });
  const sameUniqueValuesDifferentMultiplicity = recipe({ ingredients: [
    { ingredientId: INGREDIENT_A, quantity: 1, unit: 'kg' },
    { ingredientId: INGREDIENT_B, quantity: 2, unit: 'piece' },
    { ingredientId: INGREDIENT_B, quantity: 2, unit: 'piece' },
  ] });
  assert.equal(classifyRecipe(subject, quantityOnly).evidence.ingredientMultisetExact, false);
  assert.equal(classifyRecipe(subject, unitOnly).evidence.ingredientMultisetExact, false);
  assert.equal(classifyRecipe(subject, sameUniqueValuesDifferentMultiplicity).evidence.ingredientMultisetExact, false);

  const sharedUsage = { ingredientId: INGREDIENT_A, unit: 'piece', note: 'same preparation', optional: false };
  const nullQuantity = recipe({ ingredients: [{ ...sharedUsage, quantity: null }] });
  const sameNullQuantity = recipe({ ingredients: [{ ...sharedUsage, quantity: null }] });
  const numericQuantity = recipe({ ingredients: [{ ...sharedUsage, quantity: 1 }] });
  assert.equal(classifyRecipe(nullQuantity, sameNullQuantity).classification, 'exact_duplicate');
  const nullVersusNumeric = classifyRecipe(nullQuantity, numericQuantity);
  assert.equal(nullVersusNumeric.evidence.ingredientMultisetExact, false);
  assert.equal(nullVersusNumeric.classification, 'possible_variant');
});

test('ingredient order is ignored while instruction order remains significant', () => {
  const subject = recipe({
    ingredients: [
      { ingredientId: INGREDIENT_A, quantity: 1, unit: 'kg' },
      { ingredientId: INGREDIENT_B, quantity: 2, unit: 'piece' },
    ],
  });
  const reorderedIngredients = recipe({
    ingredients: [...subject.ingredients].reverse(),
  });
  const reorderedInstructions = recipe({
    ingredients: subject.ingredients,
    instructions: [...subject.instructions].reverse(),
  });
  assert.equal(classifyRecipe(subject, reorderedIngredients).evidence.ingredientMultisetExact, true);
  assert.equal(classifyRecipe(subject, reorderedIngredients).classification, 'exact_duplicate');
  assert.equal(classifyRecipe(subject, reorderedInstructions).evidence.instructionSequenceExact, false);
  assert.equal(classifyRecipe(subject, reorderedInstructions).classification, 'possible_variant');
});

test('possible variant requires exactly one matching component and same title alone is insufficient', () => {
  const subject = recipe();
  const instructionsOnly = recipe({
    ingredients: [{ ingredientId: INGREDIENT_B, quantity: 2, unit: 'piece' }],
  });
  const comparison = classifyRecipe(subject, instructionsOnly);
  assert.deepEqual(comparison.evidence, {
    titleExact: true,
    ingredientMultisetExact: false,
    instructionSequenceExact: true,
    fingerprintEqual: false,
  });
  assert.equal(comparison.classification, 'possible_variant');

  const sameTitleOnly = recipe({
    ingredients: [{ ingredientId: INGREDIENT_B, quantity: 2, unit: 'piece' }],
    instructions: ['Use a completely different method.'],
  });
  assert.equal(classifyRecipe(subject, sameTitleOnly).classification, null);
});

test('fingerprints and result digests are deterministic for equivalent inputs', () => {
  const subject = recipe();
  assert.equal(fingerprintRecipe(subject).fingerprint, fingerprintRecipe({ ...subject }).fingerprint);
  assert.match(fingerprintRecipe(subject).fingerprint, /^[0-9a-f]{64}$/);

  const candidates = [
    recipe({ _id: 'b', title: 'Zulu' }),
    recipe({ _id: 'a', title: 'Alpha' }),
    recipe({ _id: 'c', title: 'Chicken Adobo', instructions: ['Changed.'] }),
  ];
  const base = { candidates, candidateLimit: 500, candidateUniverseCount: 3, comparedCount: 3, truncated: false };
  const first = createDuplicateReview(subject, base);
  const second = createDuplicateReview(subject, { ...base, candidates: [...candidates].reverse() });
  assert.equal(first.resultDigest, second.resultDigest);
  assert.deepEqual(first.matches.map(({ recipe: item }) => item._id), ['a', 'b', 'c']);
  const equivalent = createDuplicateReview({ ...subject }, {
    ...base,
    candidates: candidates.map((candidate) => ({
      ...candidate,
      ingredients: candidate.ingredients.map((entry) => ({ ...entry })),
      instructions: [...candidate.instructions],
    })),
  });
  assert.equal(first.resultDigest, equivalent.resultDigest);
});

test('result digest binds every frozen metadata, candidate, lifecycle, and timestamp field', () => {
  const subject = recipe();
  const candidate = recipe({ _id: 'candidate' });
  const base = { candidateLimit: 500, candidateUniverseCount: 1, comparedCount: 1, truncated: false, candidates: [candidate] };
  const stable = createDuplicateReview(subject, base);
  const cases = [
    ['candidateLimit', subject, { ...base, candidateLimit: 499 }],
    ['candidateUniverseCount', subject, { ...base, candidateUniverseCount: 2 }],
    ['comparedCount', subject, { ...base, comparedCount: 2 }],
    ['truncated', subject, { ...base, truncated: true }],
    ['qualifying candidate ID', subject, { ...base, candidates: [{ ...candidate, _id: 'different-candidate' }] }],
    ['candidate lifecycle state', subject, { ...base, candidates: [{ ...candidate, publicationStatus: 'draft' }] }],
    ['candidate updatedAt', subject, { ...base, candidates: [{ ...candidate, updatedAt: '2026-09-29T00:00:01.000Z' }] }],
  ];
  for (const [field, nextSubject, nextInput] of cases) {
    assert.notEqual(stable.resultDigest, createDuplicateReview(nextSubject, nextInput).resultDigest, `${field} must change resultDigest`);
  }
  assert.equal('score' in stable.matches[0].evidence, false);
});

test('result digest changes when only the qualifying candidate classification changes', () => {
  const subject = recipe();
  const candidate = recipe({ _id: 'candidate' });
  const input = {
    candidateLimit: 500,
    candidateUniverseCount: 1,
    comparedCount: 1,
    truncated: false,
    candidates: [candidate],
  };
  const baseline = createDuplicateReview(subject, input);
  const classificationMutant = loadClassificationMutant('near_exact_duplicate');
  const changed = classificationMutant.createDuplicateReview(subject, input);

  assert.equal(baseline.matches[0].classification, 'exact_duplicate');
  assert.equal(changed.matches[0].classification, 'near_exact_duplicate');
  assert.deepEqual(changed.matches[0].candidatePayload, baseline.matches[0].candidatePayload);
  assert.deepEqual(changed.matches[0].recipe, baseline.matches[0].recipe);
  assert.deepEqual(changed.matches[0].evidence, baseline.matches[0].evidence);
  assert.notEqual(changed.resultDigest, baseline.resultDigest);
});

test('result digest changes when only subject canonical content changes', () => {
  const subject = recipe();
  const changedSubject = recipe({ title: 'Chicken Adobo Special' });
  const unrelatedCandidate = recipe({
    _id: 'candidate',
    title: 'Sinigang',
    ingredients: [{ ingredientId: INGREDIENT_B, quantity: 2, unit: 'piece' }],
    instructions: ['Boil tamarind broth.'],
  });
  const input = {
    candidateLimit: 500,
    candidateUniverseCount: 1,
    comparedCount: 1,
    truncated: false,
    candidates: [unrelatedCandidate],
  };
  const baseline = createDuplicateReview(subject, input);
  const changed = createDuplicateReview(changedSubject, input);

  assert.equal(classifyRecipe(subject, unrelatedCandidate).classification, null);
  assert.equal(classifyRecipe(changedSubject, unrelatedCandidate).classification, null);
  assert.deepEqual(baseline.matches, []);
  assert.deepEqual(changed.matches, []);
  assert.notDeepEqual(canonicalRecipePayload(changedSubject), canonicalRecipePayload(subject));
  assert.notEqual(changed.resultDigest, baseline.resultDigest);
});
