import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
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
});

const [ingredientModule, substitutionModule] = await Promise.all([
  vite.ssrLoadModule('/src/IngredientsTab.jsx'),
  vite.ssrLoadModule('/src/SubstitutionsTab.jsx'),
]);

after(() => vite.close());

const {
  IngredientModal,
  analyzeAliases,
  clearIngredientFieldError,
  ingredientFieldErrorsFromDetails,
  ingredientFormValues,
  validateIngredientForm,
} = ingredientModule;
const {
  SubstitutionModal,
  clearSubstitutionFieldErrors,
  isPositiveAmount,
  parseContexts,
  substitutionFieldErrorsFromDetails,
  substitutionFormValues,
  validateSubstitutionForm,
} = substitutionModule;

function validIngredient(overrides = {}) {
  return {
    name: 'Butter',
    aliasesText: '',
    category: 'dairy',
    allergenTags: ['milk'],
    isActive: true,
    ...overrides,
  };
}

function validSubstitution(overrides = {}) {
  return {
    source: { id: 'source-id', name: 'Butter' },
    substitute: { id: 'substitute-id', name: 'Oil' },
    sourceAmount: '1',
    substituteAmount: '1',
    contextsText: '',
    notes: '',
    isActive: true,
    ...overrides,
  };
}

function renderIngredientModal(name) {
  return renderToStaticMarkup(createElement(IngredientModal, {
    ingredient: {
      id: 'ingredient-id',
      name,
      aliases: [],
      category: 'dairy',
      allergenTags: ['milk'],
      isActive: true,
    },
    onClose() {},
    onSubmit() {},
  }));
}

function renderSubstitutionModal(notes = '') {
  return renderToStaticMarkup(createElement(SubstitutionModal, {
    substitution: {
      id: 'substitution-id',
      sourceIngredient: { id: 'source-id', name: 'Butter' },
      substituteIngredient: { id: 'substitute-id', name: 'Oil' },
      ratio: { sourceAmount: 1, substituteAmount: 0.75 },
      contexts: [],
      notes,
      isActive: true,
    },
    onClose() {},
    onSubmit() {},
  }));
}

test('rendered ingredient name uses trimmed length for validation, submission, and counter', () => {
  const content = 'a'.repeat(100);
  const paddedName = `  ${content}  `;
  const form = validIngredient({ name: paddedName });
  const markup = renderIngredientModal(paddedName);

  assert.match(validateIngredientForm(validIngredient({ name: '   ' })).name, /required/i);
  assert.deepEqual(validateIngredientForm(validIngredient({ name: 'Salt' })), {});
  assert.deepEqual(validateIngredientForm(form), {});
  assert.equal(ingredientFormValues(form).name, content);
  assert.ok(markup.includes(`value="${paddedName}"`));
  assert.match(markup, />100\/100 trimmed characters\.</);
  assert.doesNotMatch(markup, /maxlength=/i);
  assert.match(
    validateIngredientForm(validIngredient({ name: 'a'.repeat(101) })).name,
    /100 characters or fewer/i,
  );
});

test('alias count and per-alias length enforce the 20/100 boundaries', () => {
  const aliases20 = Array.from({ length: 20 }, (_, index) => `alias-${index}`).join(',');
  const aliases21 = `${aliases20},alias-20`;

  assert.deepEqual(validateIngredientForm(validIngredient({ aliasesText: aliases20 })), {});
  assert.match(validateIngredientForm(validIngredient({ aliasesText: aliases21 })).aliases, /up to 20/i);
  assert.deepEqual(
    validateIngredientForm(validIngredient({ aliasesText: 'a'.repeat(100) })),
    {},
  );
  assert.match(
    validateIngredientForm(validIngredient({ aliasesText: 'a'.repeat(101) })).aliases,
    /100 characters or fewer/i,
  );
});

test('alias parsing ignores blank segments and mirrors backend duplicate normalization', () => {
  const empty = analyzeAliases(' , , ');
  assert.deepEqual(empty.aliases, []);
  assert.equal(empty.hasBlankEntries, true);
  assert.deepEqual(validateIngredientForm(validIngredient({ aliasesText: ' , , ' })), {});

  const analysis = analyzeAliases(
    ' Butter, butter, BUTTER, sweet   cream, SWEET cream, , ',
  );

  assert.equal(analysis.hasBlankEntries, true);
  assert.equal(analysis.duplicateCount, 3);
  assert.deepEqual(analysis.aliases, ['Butter', 'sweet cream']);
  assert.deepEqual(
    ingredientFormValues(validIngredient({
      name: '  Cultured Butter  ',
      aliasesText: ' Butter, butter, sweet   cream ',
    })),
    {
      name: 'Cultured Butter',
      aliases: ['Butter', 'sweet cream'],
      category: 'dairy',
      allergenTags: ['milk'],
    },
  );
});

test('ingredient category, allergens, and active state remain controlled', () => {
  assert.deepEqual(validateIngredientForm(validIngredient()), {});
  assert.match(validateIngredientForm(validIngredient({ category: 'unsupported' })).category, /valid category/i);
  assert.match(
    validateIngredientForm(validIngredient({ allergenTags: ['unsupported'] })).allergenTags,
    /supported allergen/i,
  );
  assert.match(validateIngredientForm(validIngredient({ isActive: 'yes' })).isActive, /valid status/i);
});

test('substitution requires selected, distinct source and replacement ingredients', () => {
  assert.match(validateSubstitutionForm(validSubstitution({ source: null })).source, /choose/i);
  assert.match(validateSubstitutionForm(validSubstitution({ substitute: null })).substitute, /choose/i);
  assert.match(
    validateSubstitutionForm(validSubstitution({
      substitute: { id: 'source-id', name: 'Butter' },
    })).substitute,
    /different ingredients/i,
  );
  assert.deepEqual(validateSubstitutionForm(validSubstitution()), {});
});

test('ratio accepts positive integers and decimals but rejects zero, negatives, and invalid values', () => {
  assert.deepEqual(validateSubstitutionForm(validSubstitution({ sourceAmount: '2' })), {});
  assert.deepEqual(
    validateSubstitutionForm(validSubstitution({ sourceAmount: '0.5', substituteAmount: '1.25' })),
    {},
  );
  assert.equal(isPositiveAmount(Number.MIN_VALUE), true);

  for (const value of ['0', '-1', '', 'not-a-number', 'Infinity', Number.POSITIVE_INFINITY, NaN]) {
    assert.match(
      validateSubstitutionForm(validSubstitution({ substituteAmount: value })).ratio,
      /greater than 0/i,
      `Expected ${String(value)} to be rejected`,
    );
  }
});

test('rendered ratio inputs rely on explicit application validation', () => {
  const markup = renderSubstitutionModal();
  assert.doesNotMatch(markup, /\smin=/i);
  assert.equal((markup.match(/step="any"/g) || []).length, 2);
  assert.doesNotMatch(markup, /\smax=/i);
  assert.match(validateSubstitutionForm(validSubstitution({ substituteAmount: '0' })).ratio, /^Ratio must be greater than 0\.$/);
  assert.match(validateSubstitutionForm(validSubstitution({ substituteAmount: '-1' })).ratio, /^Ratio must be greater than 0\.$/);
  assert.deepEqual(validateSubstitutionForm(validSubstitution({ substituteAmount: '0.75' })), {});
});

test('contexts enforce 10 entries and 40 trimmed characters per entry', () => {
  const contexts10 = Array.from({ length: 10 }, (_, index) => `context-${index}`).join(',');
  const contexts11 = `${contexts10},context-10`;

  assert.deepEqual(parseContexts(' baking, , frying '), ['baking', 'frying']);
  assert.deepEqual(validateSubstitutionForm(validSubstitution({ contextsText: contexts10 })), {});
  assert.match(
    validateSubstitutionForm(validSubstitution({ contextsText: contexts11 })).contexts,
    /up to 10/i,
  );
  assert.deepEqual(
    validateSubstitutionForm(validSubstitution({ contextsText: 'c'.repeat(40) })),
    {},
  );
  assert.match(
    validateSubstitutionForm(validSubstitution({ contextsText: 'c'.repeat(41) })).contexts,
    /40 characters or fewer/i,
  );
});

test('rendered notes use trimmed length for validation, submission, and counter', () => {
  const content = 'n'.repeat(500);
  const paddedNotes = `  ${content}  `;
  const form = validSubstitution({ notes: paddedNotes });
  const markup = renderSubstitutionModal(paddedNotes);

  assert.deepEqual(validateSubstitutionForm(validSubstitution({ notes: '' })), {});
  assert.deepEqual(validateSubstitutionForm(form), {});
  assert.equal(substitutionFormValues(form).notes, content);
  assert.ok(markup.includes(paddedNotes));
  assert.match(markup, />Optional\. 500\/500 trimmed characters\.</);
  assert.doesNotMatch(markup, /maxlength=/i);
  assert.match(
    validateSubstitutionForm(validSubstitution({ notes: 'n'.repeat(501) })).notes,
    /500 characters or fewer/i,
  );

  assert.deepEqual(
    substitutionFormValues(validSubstitution({
      sourceAmount: '0.5',
      substituteAmount: '1.25',
      contextsText: ' baking, frying ',
      notes: '  Best in cakes.  ',
    })),
    {
      sourceIngredientId: 'source-id',
      substituteIngredientId: 'substitute-id',
      ratio: { sourceAmount: 0.5, substituteAmount: 1.25 },
      contexts: ['baking', 'frying'],
      notes: 'Best in cakes.',
    },
  );
});

test('backend validation details map only to relevant fields and clear on matching edits', () => {
  const ingredientErrors = ingredientFieldErrorsFromDetails([
    { field: 'name', message: 'Backend name error.' },
    { field: 'aliases.0', message: 'Backend alias error.' },
    { field: 'notes', message: 'Unrelated error.' },
  ]);
  assert.deepEqual(ingredientErrors, {
    name: 'Backend name error.',
    aliases: 'Backend alias error.',
  });
  assert.deepEqual(clearIngredientFieldError(ingredientErrors, 'name'), {
    aliases: 'Backend alias error.',
  });
  assert.deepEqual(clearIngredientFieldError(ingredientErrors, 'aliases'), {
    name: 'Backend name error.',
  });

  const substitutionErrors = substitutionFieldErrorsFromDetails([
    { field: 'ratio.sourceAmount', message: 'Backend ratio error.' },
    { field: 'notes', message: 'Backend notes error.' },
  ]);
  assert.equal(substitutionErrors.ratio, 'Backend ratio error.');
  assert.equal(substitutionErrors.notes, 'Backend notes error.');
  assert.equal(substitutionErrors.source, undefined);
  assert.equal(substitutionErrors.substitute, undefined);

  const unrelatedErrors = substitutionFieldErrorsFromDetails([
    { field: 'category', message: 'Unrelated error.' },
  ]);
  assert.equal(unrelatedErrors.source, undefined);
  assert.equal(unrelatedErrors.substitute, undefined);
  assert.equal(unrelatedErrors.ratio, undefined);
  assert.equal(unrelatedErrors.contexts, undefined);
  assert.equal(unrelatedErrors.notes, undefined);
  assert.equal(unrelatedErrors.form, undefined);
  assert.deepEqual(
    clearSubstitutionFieldErrors(substitutionErrors, ['ratio']),
    { notes: 'Backend notes error.' },
  );
  assert.deepEqual(
    clearSubstitutionFieldErrors(substitutionErrors, ['notes']),
    { ratio: 'Backend ratio error.' },
  );
});
