import { RECIPE_UNITS, unitLabel } from '../src/api/recipeOptions';
import {
  cookModeIngredientChecklist,
  formatQuantity,
  ingredientPrimaryLine,
  scaleQuantity,
} from '../src/utils/recipe';

const fs = require('fs');
const path = require('path');

const readScreen = (name) => fs.readFileSync(path.join(__dirname, '../src/screens', name), 'utf8');

function sourceRegion(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  if (from === -1 || to === -1 || to <= from) {
    throw new Error(`recipeUnitContract: could not locate ${start} source region`);
  }
  return source.slice(from, to);
}

const recipeDetailSource = readScreen('RecipeDetailScreen.js');
const shoppingListSource = readScreen('ShoppingListScreen.js');

describe('canonical Recipe unit contract', () => {
  const expected = ['g', 'kg', 'lb', 'oz', 'ml', 'l', 'tsp', 'tbsp', 'cup', 'piece', 'clove', 'slice', 'can', 'pack', 'bunch', 'pinch', 'toTaste'];

  it('keeps the exact backend-aligned 17-value order and pound/ounce labels', () => {
    expect(RECIPE_UNITS).toEqual(expected);
    expect(unitLabel('lb')).toBe('lb');
    expect(unitLabel('oz')).toBe('oz');
  });

  it.each([
    ['lb', 0.75, '0.75 lb Spaghetti'],
    ['oz', 8, '8 oz Pancit Canton Noodles'],
  ])('renders %s unchanged in Recipe Detail helpers', (unit, quantity, expectedLine) => {
    expect(ingredientPrimaryLine({ ingredient: { name: expectedLine.split(' ').slice(2).join(' ') }, quantity, unit })).toBe(expectedLine);
  });

  it.each([
    ['lb', 0.75, '0.75'],
    ['oz', 8, '8'],
  ])('preserves %s quantities through the production display primitives', (unit, quantity, expectedQuantity) => {
    expect(formatQuantity(scaleQuantity(quantity, 4, 4))).toBe(expectedQuantity);
    expect(formatQuantity(quantity)).toBe(expectedQuantity);
    expect(unitLabel(unit)).toBe(unit);
  });

  it('connects the canonical formatter to the actual Recipe Detail quantity render path', () => {
    const formatter = sourceRegion(
      recipeDetailSource,
      'function ingredientDisplayRow(entry, opts) {',
      'function ApiRecipeDetail('
    );
    const dataPath = sourceRegion(
      recipeDetailSource,
      'const ingredientRows = useMemo(',
      'const instructionSteps = useMemo('
    );
    const renderPath = sourceRegion(
      recipeDetailSource,
      '{ingredientRows.length === 0 ? (',
      '<View style={styles.ddInstructionsSection}>'
    );

    expect(formatter).toMatch(/scaleQuantity\(entry\.quantity, opts\.selectedServings, opts\.baseServings\)/);
    expect(formatter).toMatch(/const qty = formatQuantity\(quantity\)/);
    expect(formatter).toMatch(/const unit = entry\.unit \? unitLabel\(entry\.unit\) : ''/);
    expect(formatter).toMatch(/qtyText = \[qty, unit\]\.filter\(Boolean\)\.join\(' '\)/);
    expect(formatter).not.toMatch(/entry\.unit\s*===\s*['"](?:lb|oz)['"]/);
    expect(dataPath).toMatch(/\(recipe\.ingredients \|\| \[\]\)[\s\S]*\.map\(\(entry\) => ingredientDisplayRow\(entry,/);
    expect(renderPath).toMatch(/ingredientRows\.map\(\(row, i\) =>/);
    expect(renderPath).toMatch(/\{row\.qtyText \? <Text style=\{styles\.ddIngredientQty\}>\{row\.qtyText\}<\/Text> : null\}/);
  });

  it('connects the canonical formatter to the actual Shopping List quantity render path', () => {
    const formatter = sourceRegion(
      shoppingListSource,
      'function itemAmountText(item) {',
      'function ItemRow('
    );
    const rowPath = sourceRegion(
      shoppingListSource,
      'function ItemRow(',
      'export default function ShoppingListScreen('
    );

    expect(formatter).toMatch(/const quantity = formatQuantity\(item\.quantity\)/);
    expect(formatter).toMatch(/const unit = item\.unit \? unitLabel\(item\.unit\) : ''/);
    expect(formatter).toMatch(/return \[quantity, unit\]\.filter\(Boolean\)\.join\(' '\) \|\| null/);
    expect(formatter).not.toMatch(/item\.unit\s*===\s*['"](?:lb|oz)['"]/);
    expect(rowPath).toMatch(/const amount = itemAmountText\(item\)/);
    expect(rowPath).toMatch(/\{amount \? <Text style=\{styles\.qty\}>\{amount\}<\/Text> : null\}/);
  });

  it.each([['lb', 0.75], ['oz', 8]])('renders %s unchanged in Cook Mode without conversion', (unit, quantity) => {
    const recipe = { servings: 4, ingredients: [{ ingredient: { name: 'Ingredient' }, quantity, unit }] };
    expect(cookModeIngredientChecklist(recipe, 4)).toEqual([{ name: 'Ingredient', qty: `${quantity} ${unit}` }]);
  });

  it('keeps lb/oz available to the shared manual Shopping List picker mirror', () => {
    expect(RECIPE_UNITS.slice(2, 4)).toEqual(['lb', 'oz']);
  });
});
