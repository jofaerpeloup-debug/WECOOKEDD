# MOBILE-M27 - Teammate Frontend Adoption

## STATUS

**AUDIT COMPLETE - FRONTEND ADOPTION SCOPE FROZEN**

- Audit date: 2026-09-26 (Asia/Singapore)
- Live repository branch: `main`
- Live repository HEAD: `2074c102783634c4df859d50c44161e583857db9`
- Base: `main` / merge-base `2074c102783634c4df859d50c44161e583857db9`
- HEAD first parent: `53d83849264dccd7d920c3545558b95691b82ecc`
- Teammate repository: <https://github.com/jofaerpeloup-debug/WECOOKEDD.git>
- Teammate branch/ref: `refs/heads/main`
- Teammate full commit SHA: `bae924b043f2761fd29b5df28d67b84fbb20d3be`
- Pinned source: <https://github.com/jofaerpeloup-debug/WECOOKEDD/tree/bae924b043f2761fd29b5df28d67b84fbb20d3be>
- Application code was read-only. This milestone file is the only file created or modified by this audit.
- No file was staged, committed, or pushed.
- No `.env` file was opened or inspected.

The checkout began with pre-existing untracked files, including `AGENTS.md`, `app.json`, API audit output, temporary Expo output, protected documentation, and the `docs/milestones/` directory. They are not MOBILE-M27 changes and must be preserved.

## GOAL

Adopt only safe presentation and interaction details from the pinned teammate frontend while preserving WeCooked's live backend, authenticated session, authorization, navigation, API-backed state, error handling, and completed behavior.

This milestone is not permission to port the teammate application wholesale. It is a narrow visual-adoption milestone. AI Assistant is explicitly deferred. Data features that cannot be rendered truthfully from current authoritative contracts must be routed to DATA-M25 or a separately approved future backend milestone.

## CONTROLLED SCOPE AMENDMENT - REGISTER AUTH CONSISTENCY

- Amendment audit date: 2026-09-26 (Asia/Singapore).
- Audit checkout: `feat/mobile-m27-teammate-frontend-adoption` at `2074c102783634c4df859d50c44161e583857db9`; merge-base with `main` is the same commit.
- The pre-existing Batch 1 tracked diff is limited to `apps/mobile/src/screens/LoginScreen.js` and `apps/mobile/__tests__/authScreensStaticAudit.test.js`; it was inspected and not modified by this amendment audit.
- The pinned teammate tree contains `src/screens/LoginScreen.js` but no Register screen, Register route, or Sign Up screen/reference. This amendment must never be described as teammate Register adoption.
- The production Register file is `apps/mobile/src/screens/RegisterScreen.js`. It submits only trimmed `name` and `email` plus the exact password through `AuthContext.signUp` -> `authService.register` -> unauthenticated `POST /auth/register` -> the existing shared session-establishment path. A successful response establishes the server-issued session, hydrates the authoritative user, changes AuthContext to `authenticated`, and lets `RootNavigator` replace the unauthenticated stack without imperative post-register navigation.
- Existing behavior is frozen: shared email/new-password validation and field-error mapping; the live password-requirements checklist; exact password preservation; iOS registration autofill handling; safe non-field error mapping; duplicate-submit, gesture, hardware-back, edit, and action guards; register/Google loading and errors; Login navigation; auth-state-driven stack replacement; and the single existing native Google sign-in flow.
- Registration creates an unverified local account, best-effort issues and sends the existing verification link, and still issues the existing session if verification delivery fails. Register does not directly call verification/resend services or add verification navigation; `VerifyEmail` and the current deep-link lifecycle remain unchanged.
- Register has no terms, privacy, consent checkbox, guest/demo path, Facebook path, client role/status selection, or separate Google-signup architecture. None may be invented by the visual pass.
- The extension is presentation-only and uses the already audited teammate Login/auth direction plus existing WeCooked theme/design patterns. It requires no backend, schema, package, asset, navigation, context, service, shared component, or auth-architecture change.

## CONTROLLED SCOPE AMENDMENT - BATCH 5 INGREDIENT PICKER ACCESSIBILITY

- Amendment audit date: 2026-09-27 (Asia/Singapore).
- Audit checkout: `feat/mobile-m27-teammate-frontend-adoption` at `2074c102783634c4df859d50c44161e583857db9`.
- `ShoppingListScreen` imports and mounts the existing `IngredientPickerModal`, passes `ShoppingListContext.addItem` directly as `onAdd`, and controls only the modal's visible/close state.
- The mounted picker has verified accessibility gaps: the icon-only close control has no descriptive role/label; the title is not exposed as a heading; ingredient-result and unit controls lack explicit control semantics; the selected unit does not expose `accessibilityState.selected`; and applicable disabled and busy/loading states are not fully exposed.
- These findings are classified `FRONTEND_ONLY`. Remediation is limited to accessibility roles, labels, and state exposure in the existing picker UI and requires no product, backend, data-contract, or package change.
- Batch 5 production scope is exactly `apps/mobile/src/screens/ShoppingListScreen.js`, `apps/mobile/src/screens/ProfileScreen.js`, `apps/mobile/src/screens/SettingsScreen.js`, plus `apps/mobile/src/components/IngredientPickerModal.js` for accessibility remediation only. No other Batch 5 production file is authorized.
- Batch 5 test scope remains exactly `apps/mobile/__tests__/shoppingListStaticAudit.test.js`, `apps/mobile/__tests__/profileStaticAudit.test.js`, and `apps/mobile/__tests__/settingsStaticAudit.test.js`. The existing shopping-list static audit must carry picker accessibility regression coverage; no new test file is authorized or necessary.
- Picker regression coverage must prove the close control role/label, title heading role, ingredient-result control role/label, unit control role, selected-unit `accessibilityState.selected`, applicable disabled and busy/loading state exposure, and the unchanged `{ ingredientId: selected.id, unit, quantity }` add payload.
- Frozen behavior: ingredient search and its service/API, canonical ingredient ids, `ShoppingListContext`, `addItem`, quantity and unit semantics, modal data flow, navigation, backend, and packages must remain unchanged.

## CURRENT VERIFIED STATE

### Repository and workspace

- `main` tracks `origin/main` and was not ahead or behind when audited.
- `HEAD`, local `main`, and the merge-base with `main` are the same commit: `2074c102783634c4df859d50c44161e583857db9`.
- `origin` is `https://github.com/klaynn/wecooked.git`.
- A `teammate-ui` remote already points to `https://github.com/jofaerpeloup-debug/WECOOKEDD.git`; it was not fetched into or merged with the live checkout.
- The tracked working-tree diff was empty before this document was created. The checkout contained pre-existing untracked files listed by `git status --short --branch`.

### Mobile architecture

- `apps/mobile` is an Expo SDK 57 / React Native 0.86 application using React Navigation 7.
- `App.js` composes `ThemeProvider`, `AuthProvider`, `FavoritesProvider`, `CollectionsProvider`, `ShoppingListProvider`, and `CookHistoryProvider` around `RootNavigator`.
- `RootNavigator` owns mutually exclusive authenticated and unauthenticated route sets. The unauthenticated set includes `Landing`, `Login`, `Register`, `ResetPassword`, and `VerifyEmail`. The authenticated set includes `MainTabs` plus the current detail and account routes.
- `MainTabs` has exactly four route screens: `Home`, `Community`, `Swaps`, and `Profile`. The raised center action is not a route. `Discover`, `Saved`, `Assistant`, `MealPlan`, `SwapDetail`, `RecipeDetail`, `CookMode`, and `List` remain authenticated stack destinations.
- Deep links are narrowly configured for reset-password and verify-email flows. MOBILE-M27 must not broaden that surface.
- Current theme, design tokens, shared navigation shell, and screen composition already derive from earlier teammate-adoption work. The code still names prior reference commit `c1c86ed`; MOBILE-M27 uses the newer pin above only for the gaps audited here.

### Authentication and session architecture

- `AuthContext` has exactly three session states: `restoring`, `authenticated`, and `unauthenticated`.
- The WeCooked backend issues and rotates access/refresh tokens. The access token is process-memory-only; the native refresh token is stored only in Expo SecureStore; web refresh state is memory-only.
- `apps/mobile/src/api/client.js` is the single shared API transport. It attaches bearer tokens, understands the WeCooked response envelope, and permits one refresh-and-retry on authenticated 401 responses.
- `/api/v1/users/me` is authoritative for user hydration. Profile reconciliation is identity-guarded.
- Password login, registration, logout, logout-all, password reset, email verification, native Google login, and Google linking already have real backend flows.
- The teammate authentication implementation is not compatible with these invariants: it persists boolean login/guest flags, accepts arbitrary credentials, treats Facebook as a local login shortcut, and performs client-side OAuth exchanges with client secrets. None of it may be ported.

### Current real-data integrations

- Recipes: authenticated list/search/filter/detail via `/api/v1/recipes`.
- Ratings/reviews: authenticated list/create/update/delete via recipe review routes.
- Favorites and collections: authenticated, user-scoped API state.
- Ingredients and substitutions: authenticated catalog search and directed substitution lookup.
- Shopping list: authenticated, user-scoped list/add/update/remove/clear and add-recipe operations.
- Profile: `/users/me` plus strict self-update of name, dietary preferences, allergies, and notification enabled state.
- Cook history: authenticated completion recording, recipe status, and server-authoritative totals.
- Meal plan and community: authenticated API-backed domains already present outside the minimum MOBILE-M27 edit set.

### Current backend limits relevant to adoption

- Recipe list supports search, region, category, difficulty, one dietary tag, ingredient, maximum prep time, pagination, and the exact sorts `titleAsc`, `titleDesc`, `newest`, `oldest`, `prepTimeAsc`, and `prepTimeDesc`.
- Recipe responses do not contain nutrition/macronutrient data, popularity/trending rank, view counts, confidence metrics, or arbitrary "vibe" classifications.
- Review summaries provide authoritative `averageRating` and `ratingCount`, but recipe-list sorting does not support rating or review count.
- Substitutions provide source/substitute identities, a unit-agnostic numeric ratio, contexts, and notes. They do not provide pH, moisture, coagulation temperature, functional science fields, images, confidence, or automatic recipe mutation.
- Shopping-list custom items require a canonical ingredient id, unit, and a valid quantity/unit combination. Arbitrary free text and guessed categories are not a supported persistence contract.
- Public self-profile data has name, email, role/status, preferences, linked-provider summaries, verification state, and timestamps. Avatar, bio, cooking level, following, and editable email are not supported self-profile fields.
- The API exposes capability-gated audit-log reading, but no Admin Insights aggregate/analytics endpoint or mobile Admin Insights route exists.
- There is no approved AI Assistant backend contract.

## SOURCE-OF-TRUTH ORDER

1. `/AGENTS.md` and the live WeCooked repository at the audited HEAD.
2. Current backend schemas, serializers, authorization middleware, and API routes.
3. Current mobile auth/session, navigation, service, context, and screen contracts.
4. This frozen MOBILE-M27 milestone after audit approval.
5. The teammate repository pinned to `main@bae924b043f2761fd29b5df28d67b84fbb20d3be`, for presentation reference only.
6. The teammate README, screenshots, comments, and mock data only when they agree with the pinned tree and higher authorities.

The pinned teammate README is demonstrably stale: it advertises Landing, Swap Detail, and Admin Insights screens, but none of `src/screens/LandingScreen.js`, `src/screens/SwapDetailScreen.js`, or an Admin/Insights screen exists at the pinned SHA. The live teammate tree, not its README table, is authoritative for what can actually be inspected.

## FROZEN DECISIONS

1. Retain the current WeCooked auth/session implementation unchanged.
2. Retain current backend authority and user scoping; never add client-selected ownership or privilege data.
3. Retain the current route topology, authenticated/unauthenticated stack split, deep-link configuration, and four-tab shell.
4. Adopt teammate presentation only around data already supplied by existing live services and contexts.
5. Do not copy `src/data/mockData.js`, seeded records, local-only domain contexts, fake refresh hooks, Unsplash URLs, or placeholder counts into production paths.
6. Do not replace loading, error, empty, stale-data, or unavailable states with mock content.
7. Keep unavailable backend features honestly unavailable. Do not render `0`, a percentage, a rank, a badge, or a chart when the value is not authoritative.
8. Do not copy teammate `package.json` or `package-lock.json`; do not add packages or upgrade Expo for visual parity.
9. Do not add teammate AI settings, client-side OpenAI calls, build-time public AI keys, or device-stored AI keys.
10. Do not add teammate client-side Google OAuth/client-secret behavior, guest auth, Facebook shortcut auth, or local login flags.
11. Do not restore retired `cuisine`; current `region` and `category` contracts remain authoritative.
12. Use backend recipe `imageUrl` or existing bundled/fallback rendering only. Do not hotlink teammate Unsplash images.
13. Preserve current real ratings, favorites, collections, shopping list, profile, cook history, and substitution behavior.
14. Admin Insights remains unimplemented until an authoritative, capability-gated backend contract exists.
15. AI Assistant remains visible only as the current honest unavailable shell and is otherwise deferred.
16. Register visual consistency is a WeCooked auth-consistency extension derived from the audited Login/auth direction, not adoption of a teammate Register implementation. Only presentation may change; all current registration, verification, session, Google, validation, error, loading, duplicate-submit, and navigation behavior remains frozen.

## ARCHITECTURE RULES

- Screen -> existing context/service -> shared API client -> authenticated API route -> service/repository/Mongoose/MongoDB remains the state flow.
- Screens must not call `fetch` for WeCooked data.
- Screens must not import teammate/local mock domain data.
- Existing contexts remain the single client-side projection of their backend domain. Do not create parallel saved, shopping, profile, or session stores.
- UI may own transient presentation state such as expanded cards, selected tabs, input drafts, and animation state. It may not claim persisted domain state without an authoritative write.
- A missing value renders as unavailable/empty/error according to the existing contract. It must not be inferred from array length, a seed, a cached user from another identity, or a hard-coded number.
- Existing request-generation, stale-response, session-change, and pending-mutation guards must survive presentation edits.
- Existing accessibility roles/labels, keyboard behavior, safe-area handling, responsive layout, and light/dark/system theme behavior must not regress.
- Any requirement for new navigation routes, API/service/context changes, dependencies, assets, or backend fields triggers a stop and re-audit.

## IN SCOPE

- Read-only comparison of the named teammate screens/features against current mobile and backend support.
- Later visual/layout refinements to the explicitly allowlisted current mobile screens.
- A presentation-only Register visual-consistency extension using the approved Login/auth direction, subject to the frozen Register behavior and exact allowlists below.
- Reusing existing theme tokens and existing components from imports already used by an allowlisted screen.
- Reordering or restyling presentation while preserving real state, actions, routes, and honest status handling.
- Adding or strengthening only the exact allowlisted mobile tests.
- Recording backend/data gaps for DATA-M25 or a future backend milestone.

## OUT OF SCOPE

- Any API, database, schema, serializer, route, service, repository, authorization, admin/staff, or migration change.
- Auth/session, Google, registration behavior or architecture, reset/verification, SecureStore, token, shared API client, or deep-link changes.
- Navigation topology, route additions/removals/renames, and tab changes.
- Package manifests, lockfiles, Expo upgrades, dependency additions, native modules, app config, EAS config, or build configuration.
- `mockData.js`, local domain replacements, placeholder/hotlinked media, fake refresh, fake persistence, or demo authentication.
- AI Assistant implementation or AI configuration.
- Admin Insights implementation.
- Analytics, ranking, recommendation, confidence, nutrition, scientific measurement, notification feed, or unsupported profile persistence.
- Backend work routed to DATA-M25 or a future milestone.
- Unnamed teammate screens such as Trending, Cooking History, Recipe Ingredients, notification delivery, AI Settings, or expanded onboarding/navigation behavior.

## EXTERNAL REFERENCES

- Teammate repository: <https://github.com/jofaerpeloup-debug/WECOOKEDD.git>
- Audited branch: `main`
- Audited ref: `refs/heads/main`
- Audited full SHA: `bae924b043f2761fd29b5df28d67b84fbb20d3be`
- Pinned tree: <https://github.com/jofaerpeloup-debug/WECOOKEDD/tree/bae924b043f2761fd29b5df28d67b84fbb20d3be>
- Remote resolution evidence: `HEAD -> refs/heads/main -> bae924b043f2761fd29b5df28d67b84fbb20d3be`.

No moving branch name may be used as implementation evidence. If teammate `main` advances, MOBILE-M27 remains pinned to the SHA above unless this document is explicitly re-audited and amended.

## AUDIT QUESTIONS

1. Does the teammate screen exist in the pinned tree, or only in its README?
2. Is the screen's data already supplied by a current authenticated WeCooked contract?
3. Is the teammate behavior merely presentation, or does it introduce a second source of truth?
4. Does the teammate feature fabricate persistence, analytics, ranking, confidence, nutrition, scientific data, identity, or authorization?
5. Can the presentation be adopted without changing routes, auth, services, contexts, packages, or backend fields?
6. Does every action preserve loading, empty, error, stale-response, session-change, and mutation-pending behavior?
7. Is any displayed count or status derived from authoritative runtime data rather than local seeds, static arrays, or guessed defaults?
8. Would implementation require a file outside the exact allowlists below?

## FEATURE / GAP MATRIX

Classification definitions:

- `EXISTING_BACKEND_SUPPORTED`: already implemented in live WeCooked and, when stateful, backed by the current authoritative contract.
- `FRONTEND_ONLY`: safe presentation/transient UI with no unsupported persistence or data claim.
- `FRONTEND_INTEGRATION_REQUIRED`: teammate presentation may be adopted only by retaining/wiring it to an existing real WeCooked path.
- `BACKEND_REQUIRED`: truthful implementation needs a new authoritative backend/data contract.
- `UNSAFE_OR_FAKE`: teammate behavior/data must not be copied.
- `DEFER`: intentionally excluded from MOBILE-M27.

Every matrix row has exactly one classification.

| Screen / feature | Classification | Verified decision |
| --- | --- | --- |
| Landing / onboarding composition | `EXISTING_BACKEND_SUPPORTED` | The teammate tree uses `OnboardingScreen`; live WeCooked already presents the same five product-introduction themes through `LandingScreen` and split onboarding helpers while keeping Register/Login as real destinations. |
| Landing illustrative preview cards | `FRONTEND_ONLY` | Decorative previews are acceptable only as clearly illustrative UI; they must not be presented as the signed-in user's counts or persisted data. |
| Login visual shell | `FRONTEND_INTEGRATION_REQUIRED` | Any presentation change must retain real password login, password reset, registration, native Google flow, validation, errors, and auth-state-driven navigation. |
| Register / Sign Up visual consistency | `FRONTEND_ONLY` | WeCooked may extend the approved Login/auth visual language to its existing Register screen while preserving the real name/email/password submission, validation and password checklist, server-issued session, best-effort email-verification delivery, native Google flow, safe errors, pending guards, Login navigation, and auth-state stack swap. The pinned teammate tree has no Register implementation; this is not teammate Register adoption. |
| Teammate arbitrary login / boolean session / guest bypass / Facebook shortcut | `UNSAFE_OR_FAKE` | The teammate accepts arbitrary credentials and stores local booleans. This must never enter WeCooked. |
| Teammate client-side Google secret and token exchange | `UNSAFE_OR_FAKE` | Public/mobile client secrets and direct identity hydration bypass WeCooked's challenge and backend exchange. |
| Dashboard recipe search, newest recipes, greeting, and recipe navigation | `FRONTEND_INTEGRATION_REQUIRED` | Current `listRecipes` and authenticated user data remain authoritative; preserve debounce, refresh, stale-generation, loading, and failure handling. |
| Dashboard search history UI | `EXISTING_BACKEND_SUPPORTED` | Current history is explicitly local UX state and already separated from recipe authority. It may be restyled without becoming catalog state. |
| Dashboard authoritative trending/ranking | `BACKEND_REQUIRED` | Recipe-list API has no rating/popularity sort or view/popularity signal. Route to DATA-M25/future analytics. |
| Teammate ranking from mock rating/review fields | `UNSAFE_OR_FAKE` | Static recipe ratings and array-derived ranking may not be shown as real trends. |
| Dashboard notification feed/unread indicator | `BACKEND_REQUIRED` | Current backend stores only a notification-enabled preference; it has no authoritative notification-feed domain. |
| Discover current search plus Easy/Vegetarian/Vegan filters | `FRONTEND_INTEGRATION_REQUIRED` | Preserve current API queries and pagination behavior while adopting safe presentation. |
| Discover region/category/difficulty/dietary/ingredient/prep-time and supported sort controls | `EXISTING_BACKEND_SUPPORTED` | These query dimensions exist, but UI vocabulary must be authoritative; region/category have no controlled browse vocabulary today. |
| Discover vibes, multiple inferred diet filters, rating sort, most-cooked sort, and cuisine | `BACKEND_REQUIRED` | These are absent or retired in current contracts. Do not derive them from mock fields. |
| Teammate fake refresh and in-memory recipe filtering | `UNSAFE_OR_FAKE` | Must not replace paginated server queries or real refresh/error state. |
| Recipe Detail core recipe fields and fresh-by-id load | `FRONTEND_INTEGRATION_REQUIRED` | Preserve the current API refresh path and unavailable/error behavior. |
| Recipe Detail ratings/reviews, favorites, collections, list, meal plan, and cook status | `EXISTING_BACKEND_SUPPORTED` | Current authenticated APIs already support these actions; visual edits must retain ownership and pending/error guards. |
| Recipe ingredient quantity scaling | `FRONTEND_ONLY` | Deterministic display-only scaling of authoritative quantities is allowed if clearly labeled and does not mutate the stored recipe. |
| Teammate scaled cook time and estimated nutrition/macros | `UNSAFE_OR_FAKE` | The backend supplies neither serving-dependent time nor nutrition. Do not present estimates as recipe facts. |
| Recipe authoritative nutrition/macros | `BACKEND_REQUIRED` | Route to DATA-M25/future recipe-data work if product requires it. |
| Saved Recipes favorites and user collections presentation | `FRONTEND_INTEGRATION_REQUIRED` | Retain `FavoritesContext` and `CollectionsContext`; no seeded IDs, mock collections, or local-only writes. |
| Teammate seeded favorites/collections and fake refresh | `UNSAFE_OR_FAKE` | Static counts and AsyncStorage domain state are forbidden. |
| Ingredient Studio canonical search and substitution results | `FRONTEND_INTEGRATION_REQUIRED` | Retain authenticated ingredient/substitution services and canonical ids. |
| Teammate local swap catalog and name-keyed matching | `UNSAFE_OR_FAKE` | `ingredientSwaps` and local ratios/notes are not production authority. |
| Ingredient Studio AI fallback | `DEFER` | AI Assistant and AI-generated swaps are explicitly deferred. |
| Swap Detail live source/substitute identity, contexts, and notes | `EXISTING_BACKEND_SUPPORTED` | Live WeCooked already has this route and an honest API-backed detail composition. The pinned teammate tree has no Swap Detail file. |
| Swap Detail pH/moisture/coagulation/function/confidence/images | `BACKEND_REQUIRED` | The current substitution contract has none of these fields. |
| Fabricated science values, confidence percentages, or implied unit conversion | `UNSAFE_OR_FAKE` | Do not infer them from the teammate mock ratio or presentation. |
| Apply substitute automatically to a recipe | `BACKEND_REQUIRED` | No consumer recipe-mutation contract exists; the current UI correctly reports that no recipe was changed. |
| Shopping List canonical items, checked state, removal, clear, and add-recipe | `FRONTEND_INTEGRATION_REQUIRED` | Retain the existing authenticated context/service and mutation guards. |
| Shopping manual add through canonical ingredient selection | `EXISTING_BACKEND_SUPPORTED` | Existing ingredient search plus shopping-list add supports this when a canonical ingredient, unit, and valid quantity are supplied. |
| Teammate arbitrary free-text items and guessed Produce/Meat/Pantry category | `UNSAFE_OR_FAKE` | Local generated ids and name heuristics cannot be persisted as real shopping-list records. |
| Arbitrary custom shopping items without a catalog ingredient | `BACKEND_REQUIRED` | Route to DATA-M25/future shopping-list schema work if required. |
| Profile name, email display, allergies/preferences, saved count, and cooked count | `FRONTEND_INTEGRATION_REQUIRED` | Retain `/users/me`, strict self-update, favorites, and cook-history authority; unavailable values remain `—`, not `0`. |
| Profile avatar, bio, cooking level, following, and self-service email edit | `BACKEND_REQUIRED` | No current self-profile contract supports these fields/actions. |
| Teammate seeded collection count and locally persisted profile fields | `UNSAFE_OR_FAKE` | Static `COLLECTIONS.length`, local profile identity, and local preference claims must not be ported. |
| Settings appearance controls and current account/support/legal navigation | `FRONTEND_INTEGRATION_REQUIRED` | Preserve current theme behavior, real routes, and real logout. Do not introduce dead rows. |
| Settings two-factor authentication claim | `BACKEND_REQUIRED` | No current 2FA contract exists; do not present the existing descriptive label as a working capability. |
| Granular push/email/digest/reminder preferences | `BACKEND_REQUIRED` | The current self-profile contract has one notification-enabled boolean, not separate channel or campaign settings. |
| Settings AI key/configuration surface | `DEFER` | No AI settings route, public key, or device-key storage may be added. |
| Admin Insights authoritative metrics/chart | `BACKEND_REQUIRED` | No pinned teammate implementation, mobile route, or authoritative aggregate API exists. Any future route must be capability-gated and separately audited. |
| Hard-coded Admin Insights cards, chart, growth, totals, or rankings | `UNSAFE_OR_FAKE` | The README claim is not implementation evidence and fabricated metrics are prohibited. |
| AI Assistant | `DEFER` | Keep the current honest unavailable shell; do not send, save, or generate messages in MOBILE-M27. |
| Teammate direct OpenAI request, public API key, device-stored key, and rule-based simulated answers | `UNSAFE_OR_FAKE` | Secrets must not ship in the client and generated/mock answers are outside approved authority. |

## EXACT IMPLEMENTATION ALLOWLIST

Only the following production files may be modified during MOBILE-M27 implementation:

1. `apps/mobile/src/screens/LoginScreen.js`
2. `apps/mobile/src/screens/RegisterScreen.js`
3. `apps/mobile/src/screens/DashboardScreen.js`
4. `apps/mobile/src/screens/DiscoverScreen.js`
5. `apps/mobile/src/screens/RecipeDetailScreen.js`
6. `apps/mobile/src/screens/SavedScreen.js`
7. `apps/mobile/src/screens/IngredientStudioScreen.js`
8. `apps/mobile/src/screens/ShoppingListScreen.js`
9. `apps/mobile/src/screens/ProfileScreen.js`
10. `apps/mobile/src/screens/SettingsScreen.js`
11. `apps/mobile/src/components/IngredientPickerModal.js` (Batch 5 accessibility remediation only)

`LandingScreen.js`, `SwapDetailScreen.js`, and `AssistantScreen.js` were verified but are not implementation-authorized: Landing already carries the audited onboarding composition, Swap Detail already renders the real supported contract honestly, and Assistant is deferred. Admin Insights has no production file to authorize.

No other component, context, service, utility, navigation, theme, asset, app config, native module, package manifest, lockfile, API, admin, staff, or shared-contract file is allowlisted. The sole component exception is `IngredientPickerModal.js`, and only for the Batch 5 accessibility semantics described in the controlled amendment above. If an adoption change cannot be completed in the files above while preserving their existing imports/contracts, stop and re-audit.

## EXACT TEST ALLOWLIST

Only these test files may be modified or created:

1. `apps/mobile/__tests__/authScreensStaticAudit.test.js`
2. `apps/mobile/__tests__/dashboardStaticAudit.test.js`
3. `apps/mobile/__tests__/discoverStaticAudit.test.js`
4. `apps/mobile/__tests__/recipeDetailStaticAudit.test.js`
5. `apps/mobile/__tests__/savedStaticAudit.test.js`
6. `apps/mobile/__tests__/ingredientStudioStaticAudit.test.js` (new, only if Ingredient Studio changes)
7. `apps/mobile/__tests__/shoppingListStaticAudit.test.js`
8. `apps/mobile/__tests__/profileStaticAudit.test.js`
9. `apps/mobile/__tests__/settingsStaticAudit.test.js`

The Register consistency extension is already covered by the existing `apps/mobile/__tests__/authScreensStaticAudit.test.js` edit allowlist. No additional test file is authorized for modification by that amendment. The Batch 5 picker accessibility amendment must use `apps/mobile/__tests__/shoppingListStaticAudit.test.js`; it does not authorize another test file. Existing read-only regression tests named below must still run; running a test does not add it to the edit allowlist.

All other tests are execution-only regressions. Test failures do not authorize editing non-allowlisted production or test files.

## SECURITY / AUTH INVARIANTS

1. Database role/status and backend capability checks remain authoritative.
2. Auth state comes only from the existing WeCooked session; no guest, demo, boolean, or client-selected role path is added.
3. Access tokens remain memory-only and native refresh tokens remain SecureStore-only.
4. `/users/me` remains the authoritative user hydration path.
5. Existing refresh rotation, single retry, session-expiry handling, identity reconciliation, sign-out, and sign-out-everywhere behavior remain unchanged.
6. Existing password, verification, reset, Google challenge/exchange, linking, and deep-link flows remain unchanged.
7. No provider client secret, API key, token, password, raw auth error, or private identity field is added to mobile source, config, storage, logs, or UI.
8. Screens never accept or send `userId`, role, capability, ownership, or status to obtain access.
9. Authenticated and unauthenticated navigation stacks remain mutually exclusive.
10. Unsupported controls must be absent or explicitly unavailable; they must not silently succeed locally.
11. Existing per-user context invalidation and stale-response guards must remain intact so one user's data cannot render under another session.

## DATA GAP MAPPING

| Gap | Missing authority | Required destination |
| --- | --- | --- |
| Trending/popularity/ranking and rating-sorted discovery | Aggregate/ranking definition and list endpoint/query | DATA-M25 or future analytics/catalog milestone |
| Vibe/recommendation/personalization | Canonical taxonomy, storage, and recommendation contract | DATA-M25 or future recommendation milestone |
| Nutrition/macros | Authoritative recipe nutrition schema and serializer | DATA-M25 or future recipe-data milestone |
| Substitution science/confidence/images | Canonical fields, validation, evidence/provenance, serializer | DATA-M25 or future substitutions milestone |
| Unit-safe substitution conversion and apply-to-recipe | Unit semantics plus authorized consumer recipe mutation | Future backend/product milestone |
| Arbitrary free-text shopping items | Shopping-list schema that does not require canonical ingredient ids | DATA-M25 or future shopping milestone |
| Avatar/bio/cooking level/following/email change | Self-profile schema, validation, storage, upload/verification, and privacy rules | Future identity/profile milestone |
| Notification feed/unread state/delivery history | User-scoped notification domain and delivery contract | Future notifications milestone |
| 2FA and granular notification channels | Authentication enrollment/recovery contract and per-channel preference schema | Future auth/notifications milestones |
| Admin Insights | Defined metrics, aggregate queries, capability-gated API, empty/error semantics | DATA-M25 or future admin analytics milestone |
| AI Assistant and AI-generated swaps | Server-side model boundary, secret handling, safety, privacy, data policy, and persistence policy | Future AI milestone; explicitly not MOBILE-M27 |

## TEST REQUIREMENTS

### Focused commands

Run from the repository root after each corresponding implementation slice:

```powershell
npm test --workspace=apps/mobile -- --runInBand __tests__/authScreensStaticAudit.test.js __tests__/registrationPasswordIntegrity.test.js __tests__/inputValidationUx.test.js
npm test --workspace=apps/mobile -- --runInBand __tests__/dashboardStaticAudit.test.js __tests__/discoverStaticAudit.test.js
npm test --workspace=apps/mobile -- --runInBand __tests__/recipeDetailStaticAudit.test.js __tests__/savedStaticAudit.test.js
npm test --workspace=apps/mobile -- --runInBand __tests__/ingredientStudioStaticAudit.test.js __tests__/substitutionService.test.js
npm test --workspace=apps/mobile -- --runInBand __tests__/shoppingListStaticAudit.test.js __tests__/profileStaticAudit.test.js __tests__/settingsStaticAudit.test.js
```

If `ingredientStudioStaticAudit.test.js` is not created because that screen does not change, omit that path and still run `substitutionService.test.js`.

### Required regression commands

```powershell
npm test --workspace=apps/mobile -- --runInBand __tests__/authServiceSessionEstablishment.test.js __tests__/authServiceForgotPassword.test.js __tests__/authServiceResetPassword.test.js __tests__/authServiceSocial.test.js __tests__/authServiceVerification.test.js
npm test --workspace=apps/mobile -- --runInBand __tests__/navigationShellStaticAudit.test.js __tests__/securityStaticAudit.test.js __tests__/pendingFeatureHonestyStaticAudit.test.js
npm test --workspace=apps/mobile -- --runInBand __tests__/recipeFreshnessLifecycle.test.js __tests__/collectionDetailStaticAudit.test.js __tests__/shoppingListStaticAudit.test.js
npm test --workspace=apps/mobile -- --runInBand
git diff --check
git status --short --branch
```

If a listed path does not exist at implementation time, stop and amend the milestone rather than silently substituting a different test. A sandbox `spawn EPERM` is an environment limitation, not passing product evidence; rerun focused tests sequentially or in an environment that supports Jest workers.

Tests must prove at minimum:

- no new production import of `mockData`, teammate local domain contexts, `useFakeRefresh`, or direct external AI/OAuth transports;
- real API/service/context ownership remains in place;
- auth actions and error/validation states are preserved;
- loading, empty, initial error, background error, refresh, pagination, and pending mutation states remain honest;
- unsupported metrics/features are absent or explicitly unavailable;
- navigation names and params remain compatible;
- light/dark/system theme and accessibility labels/roles are not dropped.

## RUNTIME REQUIREMENTS

Automated tests are not runtime acceptance. Before MOBILE-M27 may be declared complete, use a rebuilt current app against a reachable current API and verify:

1. Unauthenticated launch; Landing/Register/Login navigation; Register required/invalid name, email, and password states; live password-checklist transitions; keyboard and scrolling on supported small/large viewports; password registration failure and success; safe duplicate-email/server/network errors; no double submission from rapid taps; disabled editing, back/gesture, Login, and Google actions while a request is active; successful auth-state stack replacement; verification-email receipt and existing verify-email deep-link handling when delivery infrastructure is available; the unchanged Google sign-in entry/failure/success path; password login failure/success; forgot password; and logout return path. Do not claim verification delivery when the configured provider was not exercised.
2. Authenticated Dashboard initial load, search debounce, clear, refresh, navigation, slow network, offline failure, empty catalog, and stale-response behavior.
3. Discover filter changes, search, pagination/load-more, refresh, empty/error states, and recipe navigation.
4. Recipe Detail fresh-by-id loading, rating create/update, favorite toggle, collection action, shopping-list action, meal-plan action, substitutions, and Cook Mode entry.
5. Saved Recipes favorites/collections load, create, empty, error, refresh/focus, and collection navigation.
6. Ingredient Studio canonical search, zero results, substitution loading/error/empty/result, and Swap Detail navigation.
7. Shopping List load, check/uncheck, remove, clear, add recipe, canonical manual add, stale/unavailable ingredient behavior, mutation failure, and double-tap prevention.
8. Profile authoritative identity, saved/cooked unavailable/loading/real states, profile/account navigation, and sign-out.
9. Settings appearance modes, all live routes, back behavior, and real logout.
10. Swap Detail continues to show only source/substitute, contexts, notes, and honest unavailable science/apply behavior.
11. Assistant continues to state that it is unavailable; sending does not create, store, or transmit a message.
12. No Admin Insights route or fake metric surface appears.
13. Small and large supported phone viewports, keyboard-visible forms, screen-reader labels/focus order, light/dark/system appearance, no clipped controls, no redbox, and no unexpected console error.
14. Session expiry and account switch do not display prior-user favorites, collections, shopping items, profile, or cook stats.

Record platform, device/emulator, OS, build identifier, API target classification (never secrets), viewport/orientation, and console result. Do not claim iOS, Android, accessibility, responsive, dark-mode, or interaction verification for anything not actually exercised.

## STOP CONDITIONS

Stop implementation and return to audit if any of the following occurs:

- A file outside the production or test allowlists must change.
- A route, tab, deep link, context, service, API client, auth flow, package, lockfile, native module, config, asset, backend, admin, or shared contract must change.
- Teammate `main` is used without the pinned full SHA, or the requested design exists only outside the pin.
- A screen requires `mockData.js`, seeded domain data, local persistence for server-owned state, `useFakeRefresh`, Unsplash/hotlinked images, or a direct third-party secret/API call.
- A UI element requires unsupported analytics, ranking, nutrition, confidence, science, custom-item, profile, notification, admin, or AI data.
- An implementation would hide or remove existing real functionality to match the teammate demo.
- Auth, authorization, ownership, session, refresh, deep-link, or cross-user isolation behavior would change.
- An unsupported value would need to be displayed as `0`, a guessed number, a fabricated badge, or a fake success.
- Tests cannot assert behavior without weakening existing assertions.
- Required authenticated runtime verification cannot be performed or exposes a real regression.

## REMAINING WORK

1. Implement one allowlisted screen slice at a time, preserving existing data and action paths.
2. Add/adjust only the corresponding allowlisted tests.
3. Run the focused and required regression commands after each slice.
4. Perform an independent read-only diff review for scope creep, hidden mocks, auth/navigation drift, stale-state regressions, fake metrics, unsupported controls, and test weakness.
5. Complete the authenticated runtime checklist on the intended platforms.
6. Route every data gap in this document to DATA-M25 or the named future milestone before exposing it as real behavior.
7. Keep AI Assistant and Admin Insights out of implementation until separately authorized.
8. Stage, commit, or push only after explicit user instruction and only after the milestone verdict remains satisfied.

## EVIDENCE

### Live repository commands

- `git branch --show-current` -> `main`
- `git rev-parse HEAD` -> `2074c102783634c4df859d50c44161e583857db9`
- `git rev-parse main` -> `2074c102783634c4df859d50c44161e583857db9`
- `git merge-base HEAD main` -> `2074c102783634c4df859d50c44161e583857db9`
- `git rev-parse HEAD^` -> `53d83849264dccd7d920c3545558b95691b82ecc`
- `git status --short --branch` recorded the pre-existing untracked working state; no tracked application diff existed before this document.

### Teammate pin commands

- `git ls-remote --symref https://github.com/jofaerpeloup-debug/WECOOKEDD.git HEAD refs/heads/* refs/tags/*` -> `HEAD` is `refs/heads/main`; both resolve to `bae924b043f2761fd29b5df28d67b84fbb20d3be`.
- A depth-one temporary clone of `main` resolved `git rev-parse HEAD` to the same full SHA.
- `git ls-tree -r --name-only HEAD` confirmed the inspected screen tree and the absence of Landing, Swap Detail, and Admin Insights source files at the pin.

### Files inspected - live WeCooked

- Governance/state: `AGENTS.md`, root `package.json`, `apps/mobile/package.json`, `apps/mobile/jest.config.js`.
- App/navigation/auth: `apps/mobile/App.js`, `src/navigation/RootNavigator.js`, `src/navigation/MainTabs.js`, `src/context/AuthContext.js`, `src/api/client.js`, `src/api/authService.js`, `src/api/tokenStore.js`.
- Named screens: `LandingScreen.js`, `LoginScreen.js`, `RegisterScreen.js`, `DashboardScreen.js`, `DiscoverScreen.js`, `RecipeDetailScreen.js`, `SavedScreen.js`, `IngredientStudioScreen.js`, `SwapDetailScreen.js`, `ShoppingListScreen.js`, `ProfileScreen.js`, `SettingsScreen.js`, `AssistantScreen.js`.
- Mobile data paths: recipe, favorite, collection, ingredient, substitution, shopping-list, profile, review, cook-history, meal-plan, and community services/contexts identified through file and import tracing.
- API routing/contracts: `src/routes/v1.routes.js`; auth, users, recipes, ingredients, substitutions, favorites, shopping lists, reviews, cook history, moderator applications, and audit routes; relevant models, validations, and serializers.
- Existing mobile tests were inventoried under `apps/mobile/__tests__` to define the edit and regression allowlists.

### Files inspected - teammate pin

- `README.md`, `package.json`, `package-lock.json` presence, `App.js`, `src/navigation/RootNavigator.js`, and `src/navigation/MainTabs.js`.
- `src/screens/OnboardingScreen.js`, `LoginScreen.js`, `DashboardScreen.js`, `DiscoverScreen.js`, `RecipeDetailScreen.js`, `SavedScreen.js`, `IngredientStudioScreen.js`, `ShoppingListScreen.js`, `ProfileScreen.js`, `SettingsScreen.js`, and `AssistantScreen.js`.
- `src/data/mockData.js`; `AuthContext.js`, `ProfileContext.js`, `SavedRecipesContext.js`, `ShoppingListContext.js`, and `AiContext.js`; `useFakeRefresh.js`, `useGoogleSignIn.js`, and `aiChef.js`.
- Tree search confirmed that Landing, Swap Detail, and Admin Insights exist only as stale README claims or prior concepts, not as files in the pinned tree.
- Tree search also confirmed that the pin has no Register screen, Register route, or Sign Up screen/reference; only the audited teammate Login may inform the Register consistency direction.

### Audit execution boundary

- No application test suite, Metro bundle, device/emulator flow, or authenticated runtime was executed during this initialization audit because application code was read-only and no runtime behavior changed.
- Final `git diff --check` passed with no output.
- Final `git diff --stat` was empty because this document and the pre-existing milestone document are untracked; there was no tracked diff.
- Final `git status --short --branch --untracked-files=all` remained `## main...origin/main` and showed the same pre-existing untracked files plus `docs/milestones/MOBILE-M27-teammate-frontend-adoption.md`.
- No application test suite, bundle, runtime, staging, commit, or push was performed.

## VERDICT

**AUDIT PASS — FRONTEND ADOPTION SCOPE FROZEN**

Implementation may proceed only inside the exact allowlists and frozen decisions above. Backend/data gaps, Admin Insights, and AI Assistant are not authorized by this verdict.
