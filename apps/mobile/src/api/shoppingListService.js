// Shopping List feature service for the mobile app — the single data path for
// the authenticated user's shopping list:
//
//   ShoppingListProvider (src/context/ShoppingListContext.js)
//     -> shoppingListService
//     -> api (src/api/client.js — shared, UNCHANGED)
//     -> Express REST API (/api/v1/shopping-list)
//     -> MongoDB
//
// Every call requires authentication; the shared client already attaches the
// bearer access token and performs one transparent refresh+retry. This module
// never calls `fetch`, never touches the token store, and NEVER sends a userId
// or a shoppingListId — ownership is always derived from the authenticated
// backend identity (req.auth.userId). There is no client-side "create list"
// operation: GET lazily upserts the caller's single list server-side.
//
// Every endpoint (read and mutation) returns the full authoritative
// `data.shoppingList` — this module unwraps to that object so callers always
// hold current server state (merge results are otherwise not derivable from the
// request alone).
//
// Contract reference: docs/milestones/MOBILE-SHOP5-custom-shopping-items-recipe-provenance.md.
// Zero Firestore involvement.

import { INGREDIENT_CATEGORIES } from '@wecooked/contracts';
import { ApiError, api } from './client';
import { RECIPE_UNITS } from './recipeOptions';
import { normalizeCustomLabel } from '../utils/shoppingCustomLabel';

const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;
const CATEGORIES = new Set(INGREDIENT_CATEGORIES);
const UNITS = new Set(RECIPE_UNITS);

function record(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function exact(value, keys) {
  return record(value)
    && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
}

function objectId(value) {
  return typeof value === 'string' && OBJECT_ID_RE.test(value);
}

function timestamp(value) {
  return typeof value === 'string'
    && !Number.isNaN(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function invalidResponse() {
  return new ApiError('The shopping list response was malformed.', {
    kind: 'api',
    code: 'INVALID_RESPONSE',
    status: 502,
  });
}

function validIngredient(value, ingredientId) {
  return exact(value, ['id', 'name'])
    && objectId(value.id)
    && value.id === ingredientId
    && typeof value.name === 'string'
    && value.name.trim() === value.name
    && value.name.length > 0;
}

function validSource(source) {
  if (!record(source)) return false;
  if (source.kind === 'legacy' || source.kind === 'manual') return exact(source, ['kind']);
  if (source.kind === 'single') return exact(source, ['kind', 'title', 'quantityEdited'])
    && typeof source.title === 'string' && source.title.trim().length > 0
    && typeof source.quantityEdited === 'boolean';
  if (source.kind === 'multiple' || source.kind === 'unavailable') {
    return exact(source, ['kind', 'quantityEdited']) && typeof source.quantityEdited === 'boolean';
  }
  return false;
}

function validItem(item) {
  if (item?.type === 'custom') {
    return exact(item, ['id', 'type', 'label', 'isChecked'])
      && objectId(item.id) && typeof item.isChecked === 'boolean'
      && normalizeCustomLabel(item.label) === item.label;
  }
  if (!exact(item, [
    'id', 'ingredient', 'ingredientId', 'isAvailable', 'category',
    'quantity', 'unit', 'isChecked', 'type', 'source',
  ])
    || item.type !== 'ingredient' || !validSource(item.source)
    || !objectId(item.id)
    || !objectId(item.ingredientId)
    || typeof item.isAvailable !== 'boolean'
    || typeof item.isChecked !== 'boolean'
    || !UNITS.has(item.unit)) return false;

  if (item.ingredient !== null && !validIngredient(item.ingredient, item.ingredientId)) return false;
  if (item.ingredient === null && item.isAvailable) return false;
  if (item.isAvailable) {
    if (item.ingredient === null || (item.category !== null && !CATEGORIES.has(item.category))) return false;
  } else if (item.category !== null) {
    return false;
  }

  return item.unit === 'toTaste'
    ? item.quantity === null
    : typeof item.quantity === 'number' && Number.isFinite(item.quantity) && item.quantity > 0;
}

export function parseShoppingListResponse(data) {
  const list = data?.shoppingList;
  if (!exact(data, ['shoppingListFormat', 'shoppingList']) || data.shoppingListFormat !== 2
    || !exact(list, ['id', 'items', 'createdAt', 'updatedAt'])
    || !objectId(list.id)
    || !Array.isArray(list.items)
    || list.items.length > 200
    || !list.items.every(validItem)
    || new Set(list.items.map((item) => item.id.toLowerCase())).size !== list.items.length
    || !timestamp(list.createdAt)
    || !timestamp(list.updatedAt)) {
    throw invalidResponse();
  }
  return list;
}

/**
 * GET /api/v1/shopping-list/v2
 * Lazily creates (upserts) the caller's single list server-side, so a brand-new
 * user gets `200` with `items: []` — never a 404, and no create call is needed.
 * @returns {Promise<{ id: string|null, items: object[], createdAt: string|null, updatedAt: string|null }>}
 *   Each item: `{ id, ingredient: { id, name } | null, ingredientId, isAvailable,
 *   quantity: number|null, unit, isChecked }`.
 */
export function getShoppingList() {
  return api.get('/shopping-list/v2').then(parseShoppingListResponse).catch((err) => {
    if (err instanceof ApiError && err.status === 404 && err.code === 'ROUTE_NOT_FOUND') {
      throw new ApiError('Update WeCooked server to use this shopping list.', {
        kind: 'api', status: 426, code: 'SHOPPING_LIST_SERVER_UPGRADE_REQUIRED',
      });
    }
    throw err;
  });
}

/**
 * POST /api/v1/shopping-list/v2/recipes/:recipeId
 * Imports a recipe's currently-usable ingredient usages (incl. active optional
 * ones) into the caller's list, merged by `ingredientId` + exact `unit`.
 * NO body, NO multiplier, NO servings parameter — the backend uses the recipe's
 * base quantities only.
 * @param {string} recipeId  a real backend Recipe id (never a legacy mock id
 *   like "r4" — that fails the ObjectId param with 400 VALIDATION_ERROR).
 * @returns {Promise<object>} the full post-import list. Throws ApiError:
 *   - RECIPE_NOT_FOUND (404) — recipe unknown / archived / unusable
 *   - SHOPPING_LIST_LIMIT_EXCEEDED (400) — post-merge count would exceed 200
 */
export function addRecipe(recipeId) {
  return api.post(`/shopping-list/v2/recipes/${encodeURIComponent(recipeId)}`).then(parseShoppingListResponse);
}

/**
 * POST /api/v1/shopping-list/v2/items
 * Adds ONE canonical ingredient to the caller's list, merged by
 * `ingredientId` + exact `unit` (same key as recipe import). The ingredient
 * id MUST come from the canonical Ingredient API; custom rows use addCustomItem.
 *
 * Body contract (createItemSchema, `.strict()`):
 *   - measurable unit -> `{ ingredientId, unit, quantity }` where `quantity`
 *     is already a finite JS number > 0 (the backend does NOT coerce strings).
 *   - `unit: 'toTaste'` -> `{ ingredientId, unit }` — `quantity` is OMITTED
 *     (never a stale positive value); sending one is a 400.
 * Never sends userId or shoppingListId.
 *
 * @param {{ ingredientId: string, unit: string, quantity?: number }} item
 * @returns {Promise<object>} the full post-add list. Throws ApiError:
 *   - INGREDIENT_NOT_FOUND (404) / INGREDIENT_INACTIVE (400) — bad/archived id
 *   - SHOPPING_LIST_LIMIT_EXCEEDED (400) — post-merge count would exceed 200
 *   - VALIDATION_ERROR (400) — malformed quantity/unit combination
 */
export function addItem({ ingredientId, unit, quantity } = {}) {
  const body =
    unit === 'toTaste' ? { type: 'ingredient', ingredientId, unit } : { type: 'ingredient', ingredientId, unit, quantity };
  return api.post('/shopping-list/v2/items', { body }).then(parseShoppingListResponse);
}

export function addCustomItem(label) {
  return api.post('/shopping-list/v2/items', { body: { type: 'custom', label } })
    .then(parseShoppingListResponse);
}

/**
 * PATCH /api/v1/shopping-list/v2/items/:itemId
 * @param {string} itemId  the shopping-list ITEM id (not an ingredientId).
 * @param {{ type: 'ingredient'|'custom', isChecked?: boolean, quantity?: number|null, unit?: string }} patch
 *   The tagged body is validated against the persisted row type by the server.
 * @returns {Promise<object>} the full post-patch list. Throws ApiError:
 *   - SHOPPING_LIST_ITEM_NOT_FOUND (404) — no such item on the caller's list
 *   - SHOPPING_LIST_ITEM_ALREADY_EXISTS (409) — a unit change would collide
 *   - VALIDATION_ERROR (400)
 */
export function updateItem(itemId, patch) {
  return api.patch(`/shopping-list/v2/items/${encodeURIComponent(itemId)}`, { body: patch })
    .then(parseShoppingListResponse);
}

/**
 * DELETE /api/v1/shopping-list/v2/items/:itemId
 * Physically removes one item, keyed by the shopping-list ITEM id. Works even
 * when the item's ingredient has since been archived/deleted.
 * @param {string} itemId
 * @returns {Promise<object>} the full post-delete list. Throws ApiError
 *   SHOPPING_LIST_ITEM_NOT_FOUND (404) when the item is already gone
 *   (idempotent: treat as removed).
 */
export function removeItem(itemId) {
  return api.del(`/shopping-list/v2/items/${encodeURIComponent(itemId)}`).then(parseShoppingListResponse);
}

/**
 * DELETE /api/v1/shopping-list/v2/items/checked
 * Removes only rows currently stored as checked and returns the complete list.
 * No body and no client-derived count or owner/list selector.
 */
export function clearCheckedItems() {
  return api.del('/shopping-list/v2/items/checked').then(parseShoppingListResponse);
}

/**
 * DELETE /api/v1/shopping-list/v2/items
 * Clears every item. No body. Idempotent — clearing an empty list is a no-op
 * that still returns `200` with `items: []`.
 * @returns {Promise<object>} the full (now empty) list.
 */
export function clearItems() {
  return api.del('/shopping-list/v2/items').then(parseShoppingListResponse);
}
