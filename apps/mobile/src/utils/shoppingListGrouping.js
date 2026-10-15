import {
  INGREDIENT_CATEGORIES,
  INGREDIENT_CATEGORY_LABELS,
} from '@wecooked/contracts';

export const UNAVAILABLE_CATEGORY_LABEL = 'Category unavailable';

export function groupShoppingListItems(items) {
  if (!Array.isArray(items) || items.length === 0) return [];

  const rowsByCategory = new Map(INGREDIENT_CATEGORIES.map((category) => [category, []]));
  const unavailableRows = [];
  const customRows = [];

  for (const item of items) {
    if (item?.type === 'custom') { customRows.push(item); continue; }
    const rows = rowsByCategory.get(item?.category);
    if (rows) rows.push(item);
    else unavailableRows.push(item);
  }

  const sections = INGREDIENT_CATEGORIES
    .filter((category) => rowsByCategory.get(category).length > 0)
    .map((category) => ({
      category,
      label: INGREDIENT_CATEGORY_LABELS[category],
      rows: rowsByCategory.get(category),
    }));

  if (unavailableRows.length > 0) {
    sections.push({ category: null, label: UNAVAILABLE_CATEGORY_LABEL, rows: unavailableRows });
  }
  if (customRows.length > 0) {
    sections.push({ category: 'custom', label: 'Custom Items', rows: customRows });
  }

  return sections;
}
