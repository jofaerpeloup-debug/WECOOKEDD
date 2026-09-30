import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  RECIPE_REGIONS as CONTRACT_REGIONS, RECIPE_REGION_LABELS,
  RECIPE_CATEGORIES as CONTRACT_CATEGORIES, RECIPE_CATEGORY_LABELS,
  RECIPE_DIETARY_TAGS as CONTRACT_TAGS,
} from '@wecooked/contracts';
import {
  RECIPE_REGIONS, RECIPE_CATEGORIES, RECIPE_DIETARY_TAGS,
  regionLabel, categoryLabel,
} from '../src/recipeOptions.js';
import { emptyRecipeForm, validateStep } from '../src/recipeAuthoring/recipeAuthoringModel.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Admin options preserve shared order and labels', () => {
  assert.deepEqual(CONTRACT_REGIONS, [
    'national-capital-region', 'cordillera-administrative-region', 'ilocos-region',
    'cagayan-valley', 'central-luzon', 'calabarzon', 'mimaropa-region',
    'bicol-region', 'western-visayas', 'negros-island-region', 'central-visayas',
    'eastern-visayas', 'zamboanga-peninsula', 'northern-mindanao', 'davao-region',
    'soccsksargen', 'caraga', 'bangsamoro-autonomous-region-in-muslim-mindanao',
  ]);
  assert.deepEqual(CONTRACT_CATEGORIES, ['breakfast', 'lunch', 'dinner', 'snack']);
  assert.deepEqual(CONTRACT_TAGS, ['vegetarian', 'vegan', 'pescatarian', 'glutenFree', 'dairyFree', 'nutFree']);
  assert.deepEqual(Object.keys(RECIPE_REGION_LABELS), CONTRACT_REGIONS);
  assert.deepEqual(Object.keys(RECIPE_CATEGORY_LABELS), CONTRACT_CATEGORIES);
  assert.deepEqual(CONTRACT_REGIONS.map((value) => RECIPE_REGION_LABELS[value]), [
    'National Capital Region (NCR)', 'Cordillera Administrative Region (CAR)',
    'Ilocos Region', 'Cagayan Valley', 'Central Luzon', 'CALABARZON',
    'MIMAROPA Region', 'Bicol Region', 'Western Visayas',
    'Negros Island Region (NIR)', 'Central Visayas', 'Eastern Visayas',
    'Zamboanga Peninsula', 'Northern Mindanao', 'Davao Region', 'SOCCSKSARGEN',
    'Caraga', 'Bangsamoro Autonomous Region in Muslim Mindanao (BARMM)',
  ]);
  assert.deepEqual(CONTRACT_CATEGORIES.map((value) => RECIPE_CATEGORY_LABELS[value]), [
    'Breakfast', 'Lunch', 'Dinner', 'Snack',
  ]);
  assert.deepEqual(RECIPE_REGIONS, CONTRACT_REGIONS.map((value) => ({ value, label: RECIPE_REGION_LABELS[value] })));
  assert.deepEqual(RECIPE_CATEGORIES, CONTRACT_CATEGORIES.map((value) => ({ value, label: RECIPE_CATEGORY_LABELS[value] })));
  assert.deepEqual(RECIPE_DIETARY_TAGS.map(({ value }) => value), CONTRACT_TAGS);
  assert.equal(regionLabel('national-capital-region'), 'National Capital Region (NCR)');
  assert.equal(categoryLabel('dinner'), 'Dinner');
  assert.equal(regionLabel('unknown'), '');
});

test('optional values remain valid and unknown values fail client-side validation', () => {
  const blank = emptyRecipeForm();
  assert.deepEqual(validateStep(blank, 'details'), {});
  assert.deepEqual(validateStep({ ...blank, region: 'bicol-region', category: 'snack' }, 'details'), {});
  assert.equal(validateStep({ ...blank, region: 'bicol' }, 'details').region, 'Choose a supported region.');
  assert.equal(validateStep({ ...blank, category: 'dessert' }, 'details').category, 'Choose a supported category.');
});

test('authoring and catalog use controlled optional selectors backed by shared options', () => {
  const authoring = readFileSync(path.join(root, 'src/recipeAuthoring/RecipeAuthoringSteps.jsx'), 'utf8');
  const catalog = readFileSync(path.join(root, 'src/RecipesTab.jsx'), 'utf8');
  assert.match(authoring, /<label>Region<select[\s\S]*RECIPE_REGIONS\.map/);
  assert.match(authoring, /<label>Category<select[\s\S]*RECIPE_CATEGORIES\.map/);
  assert.match(authoring, /<option value="">Not set<\/option>/);
  assert.doesNotMatch(authoring, /recipeCuisine|recipeCategory|suitableForDiet/);
  assert.match(catalog, /aria-label="Filter by region"[\s\S]*RECIPE_REGIONS\.map/);
  assert.match(catalog, /aria-label="Filter by category"[\s\S]*RECIPE_CATEGORIES\.map/);
});
