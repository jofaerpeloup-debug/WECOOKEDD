const ShoppingList = require('./shopping-list.model');

const DUPLICATE_KEY_ERROR_CODE = 11000;

// Deliberately never populates items.ingredientId. Populating would
// silently replace a dangling ref with null and lose the raw historical id
// the safe response shape needs to report for a stale/archived Ingredient
// (see shopping-list.service.js#resolveIngredientsById). Persistence only —
// no Ingredient/Recipe business rules live here.

// Lazily creates the caller's ShoppingList exactly once even under
// concurrent first requests: userId has a unique index, so the primary
// defense is an atomic upsert rather than a plain find-then-create. MongoDB
// can still surface a duplicate-key error from the upsert itself in the
// rare case two first-time requests for the same user race each other
// (the loser's insert attempt conflicts with the winner's, already-
// committed document) — that failure is not a real error for the caller,
// just proof someone else already created the same singleton, so it's
// caught here and resolved by reading the document the winner created
// instead of surfacing a raw duplicate-key 500. No transaction/retry loop:
// this is a single fallback read, not a general-purpose retry.
async function findOrCreateByUserId(userId) {
  try {
    return await ShoppingList.findOneAndUpdate(
      { userId },
      { $setOnInsert: { userId, items: [] } },
      { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true }
    );
  } catch (err) {
    if (err && err.code === DUPLICATE_KEY_ERROR_CODE) {
      const existing = await ShoppingList.findOne({ userId });
      if (existing) {
        return existing;
      }
    }
    throw err;
  }
}

function save(shoppingList) {
  return shoppingList.save();
}

module.exports = {
  findOrCreateByUserId,
  save,
};