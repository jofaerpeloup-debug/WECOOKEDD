# WeCooked — P2 Canonical Shopping Categories

**Status:** READY FOR IMPLEMENTATION

**Classification:** `BACKEND_EXTENSION + FRONTEND_INTEGRATION`

**Frozen branch:** `feat/mobile-p2-canonical-shopping-categories`

**Frozen HEAD:** `e5b283e0e8f0a441d09560d1bf8be8de267d11e3`

## 1. Goal

Project the current canonical Ingredient category into Shopping List responses and group the mobile Shopping List from that server-returned value. P2 adds no second category authority and does not change Shopping List persistence.

The completed read-only P2 audit passed. This document freezes that result; implementation must not reopen the architecture or silently expand scope.

## 2. Canonical taxonomy and labels

The existing shared `@wecooked/contracts` taxonomy is authoritative. Values and casing are exact.

| Value | Display label |
| --- | --- |
| `produce` | Produce |
| `meat` | Meat |
| `seafood` | Seafood |
| `dairy` | Dairy |
| `egg` | Egg |
| `grain` | Grain |
| `legume` | Legume |
| `nutSeed` | Nut / seed |
| `herb` | Herb |
| `spice` | Spice |
| `oilFat` | Oil / fat |
| `sweetener` | Sweetener |
| `baking` | Baking |
| `condiment` | Condiment |
| `beverage` | Beverage |
| `protein` | Protein |
| `pantry` | Pantry |
| `soy` | Soy |

`other` is retired and is not a canonical taxonomy value. It must not be restored as a fallback.

## 3. Frozen architecture

- `Ingredient.category` remains the canonical authority.
- Do not persist category on Shopping List items.
- Project the **current** canonical `Ingredient.category` into every Shopping List response.
- `category` is an additive, output-only Shopping List item field.
- Shopping List create and update requests must not accept `category`; existing strict validation must continue rejecting it.
- Use the existing shared `@wecooked/contracts` taxonomy, order, and labels.
- Missing Ingredient -> `category: null`.
- Inactive or archived Ingredient -> `category: null`.
- Legacy, retired, or otherwise noncanonical category -> `category: null`.
- Do not restore `other` as a fallback taxonomy value.
- Mobile must group only from server-returned `item.category`.
- Do not guess category from an ingredient name or any other client-side heuristic.
- Do not introduce local or mock Shopping List category authority.
- No schema migration.
- No backfill.
- No category snapshot.

The response field contract is exactly one of the 18 canonical values above or `null`. Do not add a `categoryLabel` response field; clients use the shared contract labels.

Mobile grouping is frozen as follows:

- canonical sections follow shared taxonomy order;
- empty sections are omitted;
- null, unknown, and noncanonical response values appear last under `Category unavailable`;
- existing backend item order is preserved within each section;
- checked items are not moved into an invented completed group;
- existing item IDs remain row keys.

## 4. Exact production allowlist

Only the following production files may change during P2 implementation.

### Backend production

```text
apps/api/src/modules/shopping-lists/shopping-list.serializer.js
```

### Mobile production

```text
apps/mobile/src/screens/ShoppingListScreen.js
apps/mobile/src/utils/shoppingListGrouping.js
```

`apps/mobile/src/utils/shoppingListGrouping.js` is the approved new pure grouping helper.

### Admin production

```text
NONE
```

Do **not** add `apps/mobile/src/api/shoppingListService.js` for a comment- or JSDoc-only change. If implementation later proves that a real runtime modification to that file is required, STOP and justify expanding this allowlist before editing it.

No model, repository, service, controller, route, Ingredient, Recipe, shared-contract, context, picker, navigation, theme, mock-data, package, or lockfile production change is authorized.

## 5. Exact test-change allowlist

Only the following test files may change during P2 implementation.

### Backend tests

```text
apps/api/test/shopping-list-routes.test.js
apps/api/test/shopping-list-validation.test.js
```

### Mobile tests

```text
apps/mobile/__tests__/shoppingListGrouping.test.js
apps/mobile/__tests__/shoppingListStaticAudit.test.js
```

`apps/mobile/__tests__/shoppingListGrouping.test.js` is the approved new behavior-level test file.

### Admin tests

```text
NONE
```

Running an existing regression test does not add it to the test-change allowlist.

## 6. Exact focused test commands

Run the backend commands from `apps/api`:

```powershell
node --test --test-isolation=none test/shopping-list-routes.test.js
node --test --test-isolation=none test/shopping-list-validation.test.js
```

Run the mobile command from the repository root:

```powershell
npm test --workspace=apps/mobile -- --runInBand __tests__/shoppingListGrouping.test.js __tests__/shoppingListStaticAudit.test.js
```

## 7. Exact regression test commands

Run these backend commands from `apps/api`:

```powershell
node --test --test-isolation=none test/shopping-list-model.test.js
node --test --test-isolation=none test/shopping-list-repository.test.js
node --test --test-isolation=none test/shopping-list-service.test.js
node --test --test-isolation=none test/ingredient-model.test.js test/ingredient-validation.test.js
```

Run the full mobile regression from the repository root:

```powershell
npm test --workspace=apps/mobile -- --runInBand
```

Then run from the repository root:

```powershell
git diff --check
git status --short --branch
```

The completed audit baseline used the existing Shopping List model, validation, repository, service, routes, mobile Shopping List static audit, and Ingredient model/validation suites:

```text
148 passed
0 failed
```

That count is audit baseline evidence, not a fixed post-implementation target; the approved new grouping tests will legitimately increase it.

## 8. Required implementation coverage

Backend coverage must prove:

- each canonical active Ingredient category projects unchanged;
- missing, archived/inactive, retired, and noncanonical Ingredient categories project as `null`;
- recategorization is visible on the next response and no category snapshot exists;
- manual canonical add and recipe import return current category;
- merges retain current projection and existing quantity/check semantics;
- create and patch payloads containing `category` fail strict validation;
- response envelope, existing fields, ownership, and cross-user isolation remain unchanged.

Mobile coverage must prove:

- grouping reads only `item.category`;
- shared canonical order and labels are used;
- ingredient names are never inspected for classification;
- null, unknown, and noncanonical values use the final `Category unavailable` section;
- backend order is preserved within a section;
- repeated items and different-unit rows remain distinct;
- checked state and stable item-ID keys remain unchanged;
- category section labels have accessible heading semantics;
- existing loading, empty, error, refresh, mutation, and light/dark theme behavior remains intact.

Automated tests do not establish device rendering, visual quality, or runtime accessibility.

## 9. Frozen existing behavior

P2 must preserve:

- ownership and cross-user isolation;
- canonical `ingredientId` manual add;
- recipe import;
- `ingredientId + unit` merge behavior;
- quantity summing;
- checked reset on merge;
- check and uncheck;
- individual removal, including stale items;
- clear-all confirmation and behavior;
- full-list mutation responses;
- `ShoppingListContext` mutation locking and session behavior;
- auth and shared API client behavior;
- Recipe Detail;
- Meal Plan;
- P1 Reviews;
- P1 Cooking History;
- navigation;
- light and dark theme behavior;
- packages and lockfiles.

No AsyncStorage, mock data, local state, or client-supplied category may become authoritative.

## 10. Negative scope

P2 must not expand into:

- free-text or custom Shopping Items;
- taxonomy redesign;
- category snapshot persistence;
- nutrition;
- substitutions;
- recommendation or AI work;
- analytics;
- reminders or notifications;
- recipe authoring;
- P3 discovery work;
- dependency upgrades;
- obsolete mock cleanup;
- unrelated documentation fixes.

## 11. Stop conditions

STOP and justify a milestone amendment before proceeding if implementation requires:

- any production or test change outside the exact allowlists;
- any Shopping List schema, migration, backfill, or category snapshot;
- any client-submitted category authority;
- any new or changed taxonomy value or label;
- any name-based or local/mock category inference;
- any package or lockfile change.

## 12. Freeze verdict

**P2 MILESTONE FROZEN — READY FOR IMPLEMENTATION**
