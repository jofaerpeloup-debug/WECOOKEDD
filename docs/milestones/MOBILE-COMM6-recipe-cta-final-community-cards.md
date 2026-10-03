# MOBILE-COMM6 — Recipe CTA and Final Community Post Cards

**Phase:** FINALIZE FOR PR

**Status:** IMPLEMENTATION COMPLETE — CLOSURE PASS — READY FOR PR

**Baseline:** `main @ 715ad26317246389dd1084b98f134f6af65eb2ac`

**Audit authority:** latest MOBILE-COMM6 independent read-only review and closure result

**Roadmap authority:** `docs/milestones/MOBILE-PARITY-AUDIT2-final-product-parity-audit.md`

**Verdict:** `MOBILE-COMM6 FINALIZED — READY TO MERGE (RUNTIME DEFERRED)`

This document freezes exactly the audited frontend-only MOBILE-COMM6 slice. Implementation must stop before changing any production or test file outside the exact allowlists below.

## 1. Frozen milestone boundary

- This is a frontend-only milestone.
- Reuse the existing `RecipeDetail` route and its existing authoritative Recipe API hydration.
- `CommunityScreen` is the only production file permitted to change.
- Do not add or change backend routes, API contracts, serializers, schemas, models, repositories, services, controllers, navigation registration, packages, configuration, migrations, or data.
- Do not add `RecipeIngredientsScreen` or any other screen or route.
- Do not construct or pass a recipe payload from the Community attachment summary.

## 2. Frozen CTA and navigation contract

- Render the visible `View Recipe` CTA only when `recipeAttachment.isAvailable === true` and the attachment contains a valid recipe, including a valid non-empty `recipe.id`.
- The CTA opens the existing `RecipeDetail` route with exactly:

```js
{
  recipeSource: 'api',
  recipeId: attachment.recipe.id
}
```

- Do not pass `initialRecipe`, `recipe`, ingredients, attachment data, or any additional navigation argument.
- `RecipeDetail` remains responsible for fetching the full authoritative recipe by `recipeId` and for its existing loading, error, retry, and unavailable behavior.
- An unavailable attachment, null attachment, or invalid recipe must not render the CTA and must never trigger Recipe Detail navigation.
- Preserve the existing unavailable-recipe panel and its `Recipe unavailable` copy.
- The CTA must be an accessible button with a stable `View Recipe` name suitable for mounted interaction tests.
- Recipe imagery and the recipe title tag remain presentation only; neither may create an alternate navigation contract.

## 3. Frozen final Community card contract

Each post card must preserve this visible order:

1. Avatar.
2. Author and server-derived timestamp.
3. `Follow`/`Following` for a non-owner author, or owner delete for the authenticated owner's post.
4. Available recipe image, or the existing unavailable-recipe panel when the attachment is unavailable.
5. Available recipe title tag.
6. Post caption.
7. `View Recipe` CTA when and only when the frozen CTA eligibility contract is satisfied.
8. Like/comment controls followed by the existing expanded comments UI.

The final-card work must preserve:

- server-projected avatar display and initial fallback;
- the existing `All` and `Following` modes and their server-backed behavior;
- follow/unfollow visibility, pessimistic mutation, single-flight ownership, cross-card reconciliation, and guarded Following reload behavior;
- like state/count behavior and duplicate-tap suppression;
- lazy comments, authoritative comment counts, comment create/delete behavior, pagination, and race guards;
- owner-only post and comment delete controls and confirmed-delete behavior;
- feed loading, error/retry, empty, refresh, pagination, mutation-version, operation-token, owner/account, generation, and unmount protections;
- post composer and optional real-recipe attachment behavior.

Avatars, author names, timestamps, recipe media, recipe title tags, captions, and controls must not become public-profile navigation targets. No public-profile navigation is permitted.

## 4. Exact production allowlist

- `apps/mobile/src/screens/CommunityScreen.js`

No other production file may change. Any required production expansion must stop for a new audit decision.

## 5. Exact test allowlist

- `apps/mobile/__tests__/communityInteraction.test.js`
- `apps/mobile/__tests__/communityStaticAudit.test.js`
- `apps/mobile/__tests__/recipeDetailStaticAudit.test.js`

No other test file may change. Any required test expansion must stop for a new audit decision.

## 6. Frozen verification requirements

### Mounted CTA and navigation proof

- Mount `CommunityScreen` with an available attachment containing a valid recipe, confirm `View Recipe` is visible, press it, and prove exactly one navigation call to `RecipeDetail` with exactly the frozen two-field argument object.
- Prove the call contains no `initialRecipe`, constructed recipe object, or additional navigation field.
- Mount an unavailable attachment and prove the existing `Recipe unavailable` panel remains visible, `View Recipe` is absent, and no recipe navigation occurs.
- Prove a null attachment and an available attachment without a valid recipe cannot expose or trigger the CTA.
- Keep fixtures server-shaped and use mounted behavior for the navigation assertion; a source-only assertion is not sufficient.

### Static card and boundary proof

- Prove the final visible card ordering: header identity/actions, recipe media or unavailable panel, recipe title tag, caption, CTA, then like/comment controls and comments.
- Prove the CTA guard requires `isAvailable === true` and a valid recipe ID.
- Prove the exact `RecipeDetail` route name and exact `{ recipeSource: 'api', recipeId: attachment.recipe.id }` arguments.
- Extend the Recipe Detail caller audit to include `CommunityScreen` and reject callers that omit `recipeSource: 'api'` or introduce a constructed recipe payload.
- Prove there is no `RecipeIngredientsScreen`, new route, public-profile navigation, Community upload path, Saved/bookmark control, Trending control, or `For You` control in this milestone.
- Prove the production and test diff is confined to the exact allowlists.

### Regression proof

- Preserve and run all existing assertions in the three allowlisted test files; do not replace or weaken existing coverage to add the CTA tests.
- Existing Community mounted coverage for avatars, feed modes, follow, likes, comments, deletes, refresh, pagination, account changes, stale responses, and unmount continuations must remain passing.
- Existing Recipe Detail API hydration, route rejection, navigation, security, and real-data assertions must remain passing.
- Race fixtures must remain visibly corrupting so removal of the existing guards makes the relevant tests fail.

### Closure gates

- Run the three focused allowlisted mobile test files together, then report exact pass counts.
- Run `git diff --check`.
- Inspect `git diff --name-status`, `git diff --stat`, and `git status --short --branch`, including the new milestone document, to prove exact scope and preserved unrelated working state.
- Complete an independent read-only adversarial review of the actual implementation diff before closure.
- Device/emulator visual, touch, and accessibility runtime verification must be reported accurately as passed or deferred; automated tests do not substitute for physical runtime proof.

## 7. Deferred and out-of-scope work

- Post bookmarks and the Saved Community feed (`MOBILE-COMM5`).
- Server-ranked Trending and `For You` feeds (`MOBILE-COMM7`).
- Notifications and notification producers.
- Public profiles and all author/profile navigation.
- Community image uploads or new Community media persistence.
- New recipe fields, schema, serializers, or backend work.
- A dedicated Recipe Ingredients screen or route.
- New navigation registration, packages, configuration, migrations, or database work.
- Any card behavior beyond the frozen ordering and existing behavior preservation.

## 8. Blockers

- No finalization blocker.
- Device/emulator visual, touch, and accessibility runtime verification is deferred, not run, and not claimed as passing.

## 9. Closure evidence

- Implementation complete.
- Independent review findings fixed.
- Closure: PASS.
- COMM6 regression: 97/97 PASS.
- Hardened boundary audit: 19/19 PASS.
- `git diff --check`: PASS.
- Device/emulator visual, touch, and accessibility runtime: DEFERRED — NOT RUN — NOT CLAIMED AS PASS.

## 10. Finalization constraints

- Release scope is exactly the one production file, three test files, and this milestone document.
- Preserve all unrelated untracked files.
- Do not inspect, apply, pop, drop, or otherwise touch the protected Cook Mode stash.

## 11. Verdict

**MOBILE-COMM6 FINALIZED — READY TO MERGE (RUNTIME DEFERRED)**
