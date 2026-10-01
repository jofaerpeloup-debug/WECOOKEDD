# ING-CATALOG-UX1 - Ingredient Allergen Filter

## 1. Goal and baseline

Freeze the smallest Moderator/Admin Ingredient-catalog change that exposes the
backend's existing exact allergen filter in the current Ingredient toolbar.

The audited live-repository baseline is `main` at
`8f1d3af892d98ee3e4828c2948ccc293f7a95572`, equal to the merge base with
`main` and aligned with the requested baseline.

The initial phase was a read-only audit plus contract freeze. Implementation
is **COMPLETE** and is limited to the production and test allowlists in section
7, plus factual evidence updates to this milestone. Finalization is authorized
for exactly those three paths. No package change, database mutation, backend
change, runtime verification, or stash operation is part of this milestone.

## 2. Canonical allergen contract

The Ingredient model's `ALLERGEN_TAGS` array is the authoritative persisted and
API-validation enum. Its exact values, spelling, and order are:

| Value | Existing Admin label |
| --- | --- |
| `milk` | Milk |
| `egg` | Egg |
| `fish` | Fish |
| `shellfish` | Shellfish |
| `treeNut` | Tree nut |
| `peanut` | Peanut |
| `wheat` | Wheat |
| `soy` | Soy |
| `sesame` | Sesame |

`Ingredient.allergenTags` is an array of only those enum values and defaults to
`[]`. Request validation reuses the model export for create, update, and the
single `allergen` list query parameter. Matching is exact and case-sensitive at
validation; no value normalization, aliasing, fuzzy matching, or inference is
part of the contract.

The Admin already keeps the corresponding select-friendly values and labels in
`apps/admin/src/ingredientOptions.js` as `INGREDIENT_ALLERGEN_TAGS`. That module
is already imported by `IngredientsTab.jsx` for form validation and edit/create
chips. The filter must map this existing option array directly. It must not add
a third enum or rename a value. Moving the pre-existing API/Admin mirrors into
a new cross-workspace shared contract is not required by this small milestone.

## 3. Existing backend support

`GET /api/v1/ingredients` already supports the optional query parameter
`allergen=<canonical value>` through the existing architecture:

```text
authenticated GET route
  -> strict listIngredientsSchema
  -> ingredientController.listIngredients
  -> ingredientService.listIngredients
  -> ingredientRepository.findMany/countByFilter
  -> Ingredient collection
```

- validation accepts one exact canonical allergen and rejects unsupported or
  repeated/array-shaped values;
- the controller passes the validated `allergen` unchanged;
- the service applies `filter.allergenTags = allergen`;
- Mongo equality against the array field selects records containing that one
  tag;
- the same filter object is used for rows and the pagination count; and
- the repository performs reads only.

Category, allergen, status, and search are accumulated on one Mongo filter.
Search remains the existing escaped, case-insensitive name-or-alias `$or`.
Therefore allergen is AND-composed with category, status, and search. Sort,
page, and limit retain their current behavior.

No route, validation, controller, service, repository, model, serializer,
schema, or index change is authorized. Existing focused model, service,
validation, and route suites passed on this baseline (117 tests), including the
controlled allergen enum and service-level category/allergen composition.

## 4. Existing Admin client support and current UI gap

`apps/admin/src/ingredientApi.js#listIngredients` already accepts `allergen`,
passes it as the `allergen` query key to the shared authenticated API client,
and returns the existing `{ ingredients, pagination }` shape. The API client
omits `undefined`, `null`, and empty-string query values.

`IngredientsTab.jsx` already has:

- local `filters.allergen`, initialized to `''`;
- `allergen: filters.allergen || undefined` in the server list request;
- one `patchFilters` function that resets page to `1` for any non-page change;
- allergen-aware filtered-empty copy;
- existing loading, error/retry, table, and pagination behavior; and
- the imported `INGREDIENT_ALLERGEN_TAGS` options.

The sole production gap is that the toolbar does not render a control that can
change `filters.allergen`. Filter state is component-local `useState`; the
screen does not use URL-backed filters. This milestone keeps that pattern and
adds no route or query-parameter state architecture.

## 5. Frozen filter UX and behavior

Add one native `<select>` to the existing `.wc-ing-filters` toolbar beside the
current Ingredient filters:

- accessible name: `Filter by allergen`;
- controlled value: `filters.allergen`;
- first option: `All allergens`, value `''`;
- remaining options: map `INGREDIENT_ALLERGEN_TAGS` in its existing order; and
- change handler: `patchFilters({ allergen: e.target.value })`.

`All allergens` is the default and means no allergen restriction. Because an
empty value becomes `undefined` and the API client omits it, clearing the
control removes the `allergen` query key rather than sending a sentinel.

Selecting or clearing an allergen uses the current debounced server-side list
request and resets `page` to `1`. The request preserves the current trimmed
search, category, status, sort, and limit. All criteria compose in that single
request; no client-side row filtering is allowed.

Filtered zero results continue to show `No ingredients match these filters.`
Loading, error/retry, table, and pagination remain unchanged. Filtering is a
GET-only action and must never call create, update, archive, restore, alias
collision, or any other mutation/advisory endpoint.

The control is visible to both current Ingredient-catalog modes. Admin remains
read-only and Moderator remains the catalog operator with `catalog.write`.
Existing server capability checks and `canWrite` UI gates remain authoritative;
this feature changes no role, permission, navigation, or authorization rule.

## 6. Frozen test contract

Use one focused mounted Admin test that intercepts the real client request path
and exercises the rendered control. It must prove:

1. the `Filter by allergen` control exists and defaults to `All allergens`;
2. its non-empty option values and labels exactly equal the existing
   `INGREDIENT_ALLERGEN_TAGS` export;
3. choosing one allergen sends its exact canonical value as `allergen` on
   `GET /api/v1/ingredients`;
4. choosing `All allergens` removes the `allergen` query key;
5. changing allergen from a later page sends `page=1`;
6. the same request preserves current search, status, category, sort, and
   limit, proving composition rather than isolated string presence;
7. a successful empty response renders the existing truthful filtered-empty
   state;
8. the request trace contains only Ingredient-list GETs during filter changes
   and no POST, PATCH, or DELETE; and
9. existing create/edit/archive/restore code and behavior are unchanged.

The interaction test must await the existing debounce and settled React state.
Static source matching alone is insufficient for request composition,
pagination reset, clearing, or no-mutation proof. Existing mutation coverage
remains regression evidence; this feature must not rewrite it.

## 7. Exact implementation allowlists

Production implementation allowlist:

```text
apps/admin/src/IngredientsTab.jsx
```

`apps/admin/src/ingredientOptions.js` is a required reused import, not an
authorized edit. Repository evidence does not justify a shared constants,
client, or backend production change. If implementation discovers that any
additional production file is necessary, stop and re-audit instead of widening
scope.

Test implementation allowlist:

```text
apps/admin/test/ingredientAllergenFilter.test.js
```

No existing focused Ingredient Admin test exercises list-filter interactions;
the form-validation test only checks rendered taxonomy/form behavior, while the
larger ING2 test owns creation behavior. One new focused mounted test therefore
keeps ownership narrow.

Milestone allowlist:

```text
docs/milestones/ING-CATALOG-UX1-ingredient-allergen-filter.md
```

## 8. Deferred runtime gate

Development runtime verification is **DEFERRED BY PROJECT DECISION**. It was
not run and is not claimed as passing. The deferred gate must later:

Run only a tiny development Admin runtime with existing development data:

1. open Ingredients and confirm `All allergens` shows the normal catalog;
2. choose one canonical allergen already present in development data;
3. confirm every returned row displays that exact tag;
4. combine it with one existing filter and confirm the intersection;
5. clear back to `All allergens` and confirm the restriction is removed; and
6. confirm the network trace contains list GETs only and no Ingredient mutation.

Do not create temporary data and do not run against production. Automated
tests do not substitute for this development runtime gate. The deferred runtime
does not block implementation merge because the feature is UI-only, backend
and client support already existed, mounted request behavior is covered, the
production build passes, and independent review found no production defect.

## 9. Out of scope

- Ingredient alias work;
- Substitution duplicate work;
- a new backend endpoint or API architecture;
- model, schema, index, serializer, validation, service, repository, or
  controller changes;
- allergen editing redesign or canonical-value renaming;
- multi-select, fuzzy matching, or client-side filtering;
- recipe discovery/filtering;
- user profile or allergy features;
- dietary or allergen inference;
- allergy-free, cross-contact, health, or safety guarantees;
- roles, authorization, navigation, loading, error, or empty-state redesign;
- URL-backed filter state;
- temporary or production data changes; and
- MongoDB credential rotation, which remains deferred security debt.

## 10. Implementation evidence

Implementation on `feat/ing-catalog-ux1-allergen-filter` adds one controlled
native select to the existing Ingredient toolbar in
`apps/admin/src/IngredientsTab.jsx`. It uses the accessible name
`Filter by allergen`, defaults to `All allergens`, and maps the existing
`INGREDIENT_ALLERGEN_TAGS` options without duplicating or renaming values. Its
change handler patches only `allergen` through the existing `patchFilters`
path, which preserves the other filter state and resets the page to `1`.

`apps/admin/test/ingredientAllergenFilter.test.js` mounts the live component
and intercepts its real client request path. The focused test passed `1/1` and
proved the rendered default and exact canonical options, `milk` and `treeNut`
request values, omission after clearing, page reset, search/category/status
composition, preserved sort/limit, normal filtered-empty rendering, and an
Ingredient-list-GET-only request trace.

The existing Ingredient Admin form regression passed `15/15`. The Admin Vite
production build passed with `1654` modules transformed. The first sandboxed
build attempt hit the established Windows `spawn EPERM` environment boundary;
the identical build command passed outside that boundary. No backend, API
client, option/constants, schema, index, package, or database file changed.
The existing backend allergen contract was previously verified by `117`
focused API tests passing; those tests were not rerun during finalization.

Implementation status: **COMPLETE**. Production scope is exactly
`apps/admin/src/IngredientsTab.jsx`.

## 11. Independent review and required test fix

Independent review verdict: **PASS WITH REQUIRED FIXES**. The review found no
production defect. Its required finding was a focused-test coverage gap: the
test cleared the selected allergen while already on page `1`, so it did not
prove that clearing from a later Ingredient page resets pagination.

The mounted behavioral test was corrected to keep `treeNut` selected while
navigating to page `2`, then clear the control through the rendered interaction
and observe the next real client request. That request omits `allergen`, resets
to page `1`, and preserves search, category, status, sort, and limit. Existing
canonical-option, exact-value, selection-reset, composition, zero-result, and
GET-only coverage remains in place. The corrected focused test passed `1/1`.
Production behavior and production code were unchanged by this narrow
test-coverage phase.

Post-fix focused test result: **PASS 1/1**. Development runtime verification
remains explicitly deferred and is not marked complete.

## 12. Finalization record

No implementation blocker was found at the audited baseline. Backend and Admin
client support already exist, canonical options are already available to the
component, and the missing toolbar control fits the one-file production scope.

Final milestone scope is exactly:

- production: `apps/admin/src/IngredientsTab.jsx`;
- test: `apps/admin/test/ingredientAllergenFilter.test.js`; and
- documentation: `docs/milestones/ING-CATALOG-UX1-ingredient-allergen-filter.md`.

Independent review: **PASS WITH REQUIRED FIXES**. The required test-only fix
was completed with a mounted interaction that selects `treeNut`, navigates to
page `2`, clears the allergen, verifies the page resets to `1`, and verifies the
other filters remain preserved. Production defect: **NONE**.

MongoDB credential rotation remains separately recorded as deferred security
debt and is not part of this milestone.

**ING-CATALOG-UX1 FINALIZED - READY TO MERGE (RUNTIME DEFERRED)**
