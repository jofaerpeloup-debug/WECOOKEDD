const { INGREDIENT_CATEGORIES } = require('@wecooked/contracts');

const canonicalCategories = new Set(INGREDIENT_CATEGORIES);

// Maps one embedded item plus its resolved Ingredient (or null, when the
// Ingredient has been archived or deleted outright) to the public shape.
// ingredientId is always the raw historical id stored on the item itself —
// never derived from the (possibly null) resolved Ingredient — so a stale
// reference still reports which ingredient it used to point at.
function toItemSummary(item, ingredientsById) {
  const ingredient = ingredientsById.get(String(item.ingredientId)) ?? null;
  return {
    id: String(item._id),
    ingredient: ingredient ? { id: String(ingredient._id), name: ingredient.name } : null,
    ingredientId: String(item.ingredientId),
    isAvailable: Boolean(ingredient && ingredient.isActive),
    category: ingredient && ingredient.isActive && canonicalCategories.has(ingredient.category)
      ? ingredient.category
      : null,
    quantity: item.quantity ?? null,
    unit: item.unit,
    isChecked: item.isChecked,
  };
}

// Maps a { shoppingList, ingredientsById } result (as returned by every
// shopping-list.service.js function) to the public API representation.
// Never exposes userId or __v — built field-by-field rather than spread.
function toPublicShoppingList({ shoppingList, ingredientsById }) {
  return {
    id: String(shoppingList._id),
    items: shoppingList.items.map((item) => toItemSummary(item, ingredientsById)),
    createdAt: shoppingList.createdAt,
    updatedAt: shoppingList.updatedAt,
  };
}

function toSource(item, sourcesById) {
  const ids = item.sourceRecipeIds || [];
  if (ids.length === 0) return { kind: item.originKind === 'manual' ? 'manual' : 'legacy' };
  const quantityEdited = item.quantityEdited;
  const visible = ids.map((id) => sourcesById.get(String(id)));
  if (visible.some((source) => !source)) return { kind: 'unavailable', quantityEdited };
  if (visible.length > 1) return { kind: 'multiple', quantityEdited };
  return { kind: 'single', title: visible[0].title, quantityEdited };
}

function toPublicShoppingListV2({ shoppingList, ingredientsById, sourcesById }) {
  return {
    id: String(shoppingList._id),
    items: shoppingList.items.map((item) => item.type === 'custom'
      ? { id: String(item._id), type: 'custom', label: item.label, isChecked: item.isChecked }
      : { ...toItemSummary(item, ingredientsById), type: 'ingredient', source: toSource(item, sourcesById) }),
    createdAt: shoppingList.createdAt,
    updatedAt: shoppingList.updatedAt,
  };
}

module.exports = { toPublicShoppingList, toPublicShoppingListV2 };
