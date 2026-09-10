// M3: `cuisine` is retired from the Recipe contract; `region` / `category`
// are open canonical slugs. These guard the mobile-side contract mirror so a
// stale cuisine dependency can't quietly come back.

import {
  RECIPE_DIFFICULTIES,
  DISCOVER_FILTERS,
  slugLabel,
  categoryLabel,
  regionLabel,
  difficultyLabel,
} from '../src/api/recipeOptions';
import { recipeBadges } from '../src/utils/recipe';
import * as recipeOptions from '../src/api/recipeOptions';

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

  it('has no Discover filter that queries cuisine / region / category', () => {
    expect(DISCOVER_FILTERS.map((f) => f.key)).toEqual(['all', 'easy', 'vegetarian', 'vegan']);
    for (const f of DISCOVER_FILTERS) {
      expect(Object.keys(f.query)).not.toContain('cuisine');
      expect(Object.keys(f.query)).not.toContain('region');
      expect(Object.keys(f.query)).not.toContain('category');
    }
  });
});

describe('slugLabel humanizes an open canonical slug without fabricating', () => {
  it('title-cases hyphenated slugs', () => {
    expect(slugLabel('central-luzon')).toBe('Central Luzon');
    expect(slugLabel('main-dish')).toBe('Main Dish');
    expect(categoryLabel('dessert')).toBe('Dessert');
    expect(regionLabel('bicol')).toBe('Bicol');
  });

  it('returns an empty string for an absent value', () => {
    expect(slugLabel(null)).toBe('');
    expect(slugLabel(undefined)).toBe('');
    expect(slugLabel('')).toBe('');
  });
});

describe('recipeBadges uses category/region, never cuisine', () => {
  it('shows the category first, then dietary tags', () => {
    expect(recipeBadges({ category: 'main-dish', dietaryTags: ['vegan'] })).toEqual([
      'Main Dish',
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
