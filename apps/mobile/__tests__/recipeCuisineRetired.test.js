// M3: `cuisine` is retired from the Recipe contract; `region` / `category`
// use shared canonical enums. These guard the mobile-side contract so a
// stale cuisine dependency can't quietly come back.

import {
  RECIPE_DIFFICULTIES,
  RECIPE_REGIONS,
  RECIPE_CATEGORIES,
  RECIPE_DIETARY_TAGS,
  DISCOVER_FILTERS,
  categoryLabel,
  regionLabel,
  difficultyLabel,
  dietaryTagLabel,
} from '../src/api/recipeOptions';
import { recipeBadges } from '../src/utils/recipe';
import * as recipeOptions from '../src/api/recipeOptions';
import {
  RECIPE_REGIONS as SHARED_RECIPE_REGIONS,
  RECIPE_CATEGORIES as SHARED_RECIPE_CATEGORIES,
  RECIPE_DIETARY_TAGS as SHARED_RECIPE_DIETARY_TAGS,
} from '@wecooked/contracts';

describe('recipeOptions no longer carries a cuisine contract', () => {
  it('exports no cuisine enum or cuisine label helper', () => {
    expect(recipeOptions.RECIPE_CUISINES).toBeUndefined();
    expect(recipeOptions.CUISINE_LABELS).toBeUndefined();
    expect(recipeOptions.cuisineLabel).toBeUndefined();
  });

  it('keeps the unchanged difficulty enum', () => {
    expect(RECIPE_DIFFICULTIES).toEqual(['easy', 'medium', 'hard']);
    expect(difficultyLabel('easy')).toBe('Easy');
  });

  it('exposes the exact shared region, category, and dietary order', () => {
    expect(RECIPE_REGIONS).toEqual([
      'national-capital-region', 'cordillera-administrative-region', 'ilocos-region',
      'cagayan-valley', 'central-luzon', 'calabarzon', 'mimaropa-region',
      'bicol-region', 'western-visayas', 'negros-island-region', 'central-visayas',
      'eastern-visayas', 'zamboanga-peninsula', 'northern-mindanao', 'davao-region',
      'soccsksargen', 'caraga', 'bangsamoro-autonomous-region-in-muslim-mindanao',
    ]);
    expect(RECIPE_CATEGORIES).toEqual(['breakfast', 'lunch', 'dinner', 'snack']);
    expect(RECIPE_DIETARY_TAGS).toEqual([
      'vegetarian', 'vegan', 'pescatarian', 'glutenFree', 'dairyFree', 'nutFree',
    ]);
    expect(RECIPE_REGIONS).toBe(SHARED_RECIPE_REGIONS);
    expect(RECIPE_CATEGORIES).toBe(SHARED_RECIPE_CATEGORIES);
    expect(RECIPE_DIETARY_TAGS).toBe(SHARED_RECIPE_DIETARY_TAGS);
  });

  it('renders every frozen Region/category/dietary label from shared authority', () => {
    expect(RECIPE_REGIONS.map(regionLabel)).toEqual([
      'National Capital Region (NCR)', 'Cordillera Administrative Region (CAR)',
      'Ilocos Region', 'Cagayan Valley', 'Central Luzon', 'CALABARZON',
      'MIMAROPA Region', 'Bicol Region', 'Western Visayas',
      'Negros Island Region (NIR)', 'Central Visayas', 'Eastern Visayas',
      'Zamboanga Peninsula', 'Northern Mindanao', 'Davao Region', 'SOCCSKSARGEN',
      'Caraga', 'Bangsamoro Autonomous Region in Muslim Mindanao (BARMM)',
    ]);
    expect(RECIPE_CATEGORIES.map(categoryLabel)).toEqual(['Breakfast', 'Lunch', 'Dinner', 'Snack']);
    expect(RECIPE_DIETARY_TAGS.map(dietaryTagLabel)).toEqual([
      'Vegetarian', 'Vegan', 'Pescatarian', 'Gluten-free', 'Dairy-free', 'Nut-free',
    ]);
  });

  it('has no Discover filter that queries cuisine / region / category', () => {
    expect(DISCOVER_FILTERS.map((f) => f.key)).toEqual(['all', 'easy', 'vegetarian', 'vegan']);
    for (const f of DISCOVER_FILTERS) {
      expect(Object.keys(f.query)).not.toContain('cuisine');
      expect(Object.keys(f.query)).not.toContain('region');
      expect(Object.keys(f.query)).not.toContain('category');
    }
  });
});

describe('canonical metadata labels do not fabricate unknown values', () => {
  it('uses shared labels for known values', () => {
    expect(categoryLabel('dinner')).toBe('Dinner');
    expect(regionLabel('bicol-region')).toBe('Bicol Region');
    expect(categoryLabel('dessert')).toBe('');
    expect(regionLabel('bicol')).toBe('');
  });

  it('returns an empty string for absent values', () => {
    expect(regionLabel(null)).toBe('');
    expect(categoryLabel(undefined)).toBe('');
  });
});

describe('recipeBadges uses category/region, never cuisine', () => {
  it('shows the category first, then dietary tags', () => {
    expect(recipeBadges({ category: 'dinner', dietaryTags: ['vegan'] })).toEqual([
      'Dinner',
      'Vegan',
    ]);
  });

  it('falls back to region when there is no category', () => {
    expect(recipeBadges({ region: 'central-luzon', dietaryTags: [] })).toEqual(['Central Luzon']);
  });

  it('ignores a legacy cuisine value entirely and never invents a classifier', () => {
    expect(recipeBadges({ cuisine: 'filipino', dietaryTags: ['glutenFree'] })).toEqual([
      'Gluten-free',
    ]);
    expect(recipeBadges({ dietaryTags: [] })).toEqual([]);
  });
});
