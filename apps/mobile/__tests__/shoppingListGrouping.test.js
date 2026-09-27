import {
  INGREDIENT_CATEGORIES,
  INGREDIENT_CATEGORY_LABELS,
} from '@wecooked/contracts';
import {
  groupShoppingListItems,
  UNAVAILABLE_CATEGORY_LABEL,
} from '../src/utils/shoppingListGrouping';

function item(id, category, overrides = {}) {
  return {
    id,
    category,
    ingredientId: `ingredient-${id}`,
    ingredient: { id: `ingredient-${id}`, name: `Name ${id}` },
    quantity: 1,
    unit: 'piece',
    isChecked: false,
    ...overrides,
  };
}

describe('groupShoppingListItems', () => {
  it('uses shared canonical order and labels while omitting empty sections', () => {
    const input = [item('soy', 'soy'), item('produce', 'produce'), item('dairy', 'dairy')];

    const sections = groupShoppingListItems(input);

    expect(sections.map(({ category }) => category)).toEqual(['produce', 'dairy', 'soy']);
    expect(sections.map(({ label }) => label)).toEqual([
      INGREDIENT_CATEGORY_LABELS.produce,
      INGREDIENT_CATEGORY_LABELS.dairy,
      INGREDIENT_CATEGORY_LABELS.soy,
    ]);
    expect(sections).toHaveLength(3);
    expect(INGREDIENT_CATEGORIES.indexOf('produce')).toBeLessThan(INGREDIENT_CATEGORIES.indexOf('dairy'));
  });

  it('groups exclusively by item.category and never lets ingredient names influence classification', () => {
    const misleading = item('misleading', 'spice', {
      ingredient: { id: 'ingredient-misleading', name: 'Fresh milk and spinach' },
    });

    const sections = groupShoppingListItems([misleading]);

    expect(sections).toEqual([{
      category: 'spice',
      label: INGREDIENT_CATEGORY_LABELS.spice,
      rows: [misleading],
    }]);
  });

  it('preserves backend row order, repeated rows, units, and checked state within a section', () => {
    const first = item('first', 'produce', { ingredientId: 'same', unit: 'kg', isChecked: true });
    const second = item('second', 'produce', { ingredientId: 'same', unit: 'piece' });
    const repeated = item('third', 'produce', { ingredientId: 'same', unit: 'kg' });

    const [section] = groupShoppingListItems([first, second, repeated]);

    expect(section.rows).toEqual([first, second, repeated]);
    expect(section.rows).toHaveLength(3);
    expect(section.rows[0].isChecked).toBe(true);
    expect(section.rows[1].unit).toBe('piece');
  });

  it.each([null, undefined, 'other', 'unknown'])('puts %p in the final unavailable section', (category) => {
    const unavailable = item('unavailable', category);
    const sections = groupShoppingListItems([unavailable, item('produce', 'produce')]);

    expect(sections.at(-1)).toEqual({
      category: null,
      label: UNAVAILABLE_CATEGORY_LABEL,
      rows: [unavailable],
    });
  });

  it('keeps all unavailable rows in their original relative order', () => {
    const rows = [item('unknown', 'unknown'), item('missing', null), item('retired', 'other')];

    expect(groupShoppingListItems(rows)[0].rows).toEqual(rows);
  });

  it.each([undefined, null, []])('returns no sections for %p', (input) => {
    expect(groupShoppingListItems(input)).toEqual([]);
  });

  it('does not mutate the input array or its item objects', () => {
    const rows = [item('two', 'meat'), item('one', 'produce')];
    const snapshot = JSON.parse(JSON.stringify(rows));

    groupShoppingListItems(rows);

    expect(rows).toEqual(snapshot);
  });
});
