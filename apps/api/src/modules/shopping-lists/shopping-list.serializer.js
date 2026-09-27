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

module.exports = { toPublicShoppingList };
