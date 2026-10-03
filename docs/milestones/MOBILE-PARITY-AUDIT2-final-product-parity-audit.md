# MOBILE-PARITY-AUDIT2

**Status:** COMPLETE
**Baseline:** `main @ 15cdb5328548631f679b275ede03b3725f01c500`
**Teammate reference:** `4ffd47d176afcfb1f23ffa1be079f01791fae92e`
**Verdict:** `MOBILE-PARITY-AUDIT2 COMPLETE — REVISED ROADMAP READY`

> Repository-persisted roadmap authority for use across separate Codex/ChatGPT accounts.
> Future milestone audits should reference this file instead of relying on chat or project memory.

## 1. Baseline verification



- WeCooked: `main` at exact requested SHA `15cdb5328548631f679b275ede03b3725f01c500`.

- Latest commit: `15cdb53 MOBILE-COMM3 - Real Community Comments and Authoritative Comment Counts (#89)`.

- Teammate reference: exact Git object `4ffd47d176afcfb1f23ffa1be079f01791fae92e` exists locally and was inspected directly with `git show`/`git ls-tree`.

- The teammate checkout’s working branch remains stale at `14ce42d`; it was not used as authority.

- Read-only audit: no files, index, branches, database, dependencies, remotes, or stashes changed.

- No tests/builds were run; this was a source, contract, and roadmap audit.



Prior audit memory helped target known contract boundaries, but current conclusions were rechecked against the live baseline.



## 2. Teammate final-product screen inventory



The pinned tree contains 27 screen components:



- Entry: Onboarding, Login.

- Main tabs: Dashboard/Home, Community, Ingredient Studio/Swaps, Profile.

- Discovery: Discover/Search, Trending.

- Recipes: Recipe Detail, Recipe Ingredients, Cook Mode, Cooking History.

- Personal organization: Saved, Collection Detail, Meal Plan, Shopping/Grocery.

- Assistant: Assistant, AI Settings.

- Account: Account Details, Settings, Security, Notifications.

- Product/support: Help Center, About, Terms, Privacy, Licenses.



Not present at the pinned SHA:



- Standalone public-profile screen.

- Swap Detail screen.

- Landing screen.

- Admin Insights.



## 3. Current WeCooked screen inventory



The active navigation exposes 29 production screen components, including real additions absent from the teammate tree:



- Secure Landing/Login/Register, reset-password, and email-verification flows.

- Four-tab Home/Community/Swaps/Profile shell.

- Discover, Saved, Collection Detail, Assistant, Meal Plan, Shopping.

- Recipe Detail, Recipe Reviews, Cook Mode, Cooking History.

- Ingredient Studio and Swap Detail.

- Account Details, Settings, Security, Notifications.

- Help, About, Terms, Privacy, Licenses.



Current navigation is defined in [RootNavigator.js](C:/Users/Clein/OneDrive/Documents/Projects/wecooked/apps/mobile/src/navigation/RootNavigator.js:1) and [MainTabs.js](C:/Users/Clein/OneDrive/Documents/Projects/wecooked/apps/mobile/src/navigation/MainTabs.js:1).



## 4. Screen-by-screen parity



| Area | Classification | Current reality and remaining parity |

|---|---|---|

| Onboarding/Auth | COMPLETE | Secure registration, login, Google linking, reset, and verification exceed the teammate’s demo/local auth. |

| Dashboard/Home | PARTIAL | Real greeting, search, recents, daily feature, browse shortcuts and API recipes exist. Missing cart count, real notification dropdown, recently viewed, craving/category presentation, Trending preview and dedicated Trending screen. |

| Discover/Search | PARTIAL | DISC4 is complete: canonical Ingredient filter, real filters/sorts, pagination and favorites. Missing final inline composition, Discover-local shared recents, cuisine, mood, multi-dietary selection, total-time buckets, relevance and top-rated sorting. |

| Trending | BACKEND/API GAP + FRONTEND GAP | No current route/screen or authoritative ranking endpoint. |

| Recipe Detail | PARTIAL | Real recipe, ratings/reviews, cooked eligibility, favorites, collections, shopping, meal plan, sharing, substitutions and Cook Mode work. Nutrition remains unavailable and serving-based time changes lack an authoritative contract. |

| Recipe Ingredients | FRONTEND GAP | Teammate’s Community CTA destination is absent. Existing Recipe Detail GET can support a dedicated view or safe Recipe Detail handoff. |

| Saved/Collections | PARTIAL | Real favorites and owner-scoped user collections are complete. Missing teammate smart collections such as Quick Meals, Weekend Cooking, Breakfast and equivalent safe definitions for “Healthy.” |

| Meal Plan | PARTIAL | MEAL2 remains valid: real date-based weeks, atomic moves, clear-week and grocery action. Missing drag/drop and cook reminders. |

| Shopping | PARTIAL | SHOP3 remains valid: real canonical rows, categories, quantity/unit edits, checking, delete and clear-all. Missing clear-checked, swipe delete, inline custom-item entry, source-recipe labels and checked/pending count treatment. |

| Community | PARTIAL | COMM3 remains valid: real posts, recipe attachments, likes, comments, counts and owner deletes. Missing follows, Following, Saved/bookmarks, Trending, For You, avatars, recipe CTA and full final feed navigation. |

| Profile | PARTIAL + DATA/SCHEMA GAP | Real identity, preferences, allergies, saved/collection/cooked counts and history exist. Missing avatar, bio and cooking-level fields. |

| Public profiles | PLACEHOLDER / NOT PRODUCT REQUIREMENT | No standalone public-profile screen or author-navigation flow exists at the pinned SHA. Public author IDs and avatars are still required for Community/follows. |

| Account Details | PARTIAL + SECURITY GAP | Real name/preferences updates exist. Avatar/bio are explicitly unavailable; email change requires a verified change workflow. |

| Settings | PARTIAL | Appearance and all safe routes work. Notification controls need per-event preferences. Client-held AI-key settings are not a requirement. |

| Notifications | BACKEND/API GAP + DATA/SCHEMA GAP | Only one server preference exists; the bell dropdown is an unavailable placeholder. No inbox, read state, tokens, delivery, jobs or deep links exist. |

| Ingredient Studio | PARTIAL | Real canonical search and directed substitutions are stronger than teammate mocks. Missing “add substitute to shopping” and secure Assistant fallback for no-match cases. |

| Swap Detail | PARTIAL, outside pinned parity | The pinned teammate tree has no Swap Detail. Current live screen is truthful about missing science, but its enabled “Apply Substitute” action only reports unavailability. |

| Cook Mode | PARTIAL + DATA/SCHEMA GAP | Real checklist, steps and completion history exist. Missing titles/durations/media, timers, pause/resume, keep-awake and resumable progress. |

| AI Assistant | PARTIAL | Secure server-side Assistant is complete. Teammate-visible conversation history/new-chat/open-chat persistence is missing. |

| Security | PARTIAL + SECURITY GAP | Real password change, verification, Google linking and global session revocation exceed the teammate. MFA remains missing. |

| Help/About/Legal | PARTIAL / RELEASE BLOCKER | Routes and presentation exist, but Help is stale, support is unconfigured, legal text explicitly says placeholder, privacy claims exceed implementation, licenses are static, and version is hardcoded. |



## 5. DISC4 follow-up gaps



DISC4 must not be reopened. Its canonical Ingredient picker, six approved sorts and guarded server paging remain correct.



Follow-up work:



- Move the final Search hierarchy onto one scroll surface, with title `Search`, shared recent-search chips, collapsible inline groups and final count/CTA treatment.

- Add controlled `cuisine` and `mood/vibe` recipe fields with approved vocabularies and catalog backfill.

- Add multi-select dietary query semantics.

- Define total cooking-time buckets rather than relabeling prep time.

- Add server relevance scoring, top-rated ordering and stable pagination tie-breakers.

- Preserve current favorites, request-generation guards, API navigation and accessibility.



## 6. MEAL2 follow-up gaps



MEAL2’s atomic `PATCH` move contract remains complete.



Remaining:



- Drag/drop as an additional interaction over the existing move endpoint.

- Reminder time editing and visible reminder state.

- Local notification permission and scheduling.

- Server-persisted reminder specification tied to owner, plan entry, date/timezone and concurrency state.

- Reconciliation when a meal is moved, removed, cleared, changed on another device or becomes unavailable.

- Reminder deep link to the correct Meal Plan entry or recipe.



Week navigation, real date keys, clear-week and “add planned recipes to Grocery List” are COMPLETE.



## 7. SHOP3 follow-up gaps



SHOP3 quantity/unit editing remains complete.



Remaining:



- Bulk `clear checked` backend operation.

- Swipe-to-delete UI over the existing owner-scoped delete endpoint.

- Checked/remaining count and status presentation.

- Inline add interaction.

- Arbitrary custom shopping items, requiring a discriminated custom-label row rather than guessed Ingredient identity/category.

- Recipe-source provenance if the final “from recipe” label is retained.



Free-text items must never create fake Ingredient IDs or name-inferred categories.



## 8. COMM3 follow-up gaps



COMM3 comments and authoritative counts remain complete.



Remaining:



- Stable profile/avatar projection.

- Follow/unfollow relation and Following feed.

- Post bookmarks and Saved feed.

- Server-ranked Trending and defined For You feed.

- Four-mode feed navigation.

- Recipe CTA to a real recipe/ingredients destination.

- Avatar/media-rich cards and appropriate unavailable-recipe behavior.

- Notifications for new follower, likes and comments received.



## 9. Notification gaps



This is not one milestone.



Required layers:



1\. Preference and inbox layer:

   - Per-event preferences, not only `enabled`.

   - Notification records with actor, recipient, event type, timestamp, read state and allowlisted deep-link target.

   - List, mark-read/mark-all-read and clear/archive APIs.



2\. Native/device layer:

   - `expo-notifications` dependency and native configuration.

   - Permission lifecycle and denied/settings states.

   - Owner-bound device push-token registration, rotation and revocation.

   - Tap handling and validated deep links.



3\. Delivery layer:

   - Idempotent delivery jobs, retry policy, token invalidation and observability.

   - Respect current preference state at enqueue/delivery time.



4\. Product producers:

   - Meal reminders.

   - Saved recipe, Cook Mode completion and collection creation activity required by the teammate feed.

   - Community likes/comments/follows directed to the affected user.

   - Security/account events where appropriate.



Self-generated activity may belong in the inbox without creating a redundant push; that distinction should be explicit.



## 10. Backend/API gaps



- Recipe cuisine/mood/multi-dietary/total-time filters.

- Ranked relevance, top-rated and Trending recipe endpoints.

- Recently viewed persistence.

- Smart collection queries.

- Clear-checked and custom shopping-item APIs.

- Meal reminder create/update/cancel reconciliation.

- Profile avatar/bio/cooking-level and safe public-author projection.

- Follow, bookmark and scoped/ranked Community feeds.

- Notification inbox, preferences, tokens and delivery jobs.

- Authoritative nutrition ingestion/serialization.

- Structured Cook Mode timing/media contract.

- Assistant conversation CRUD.

- Verified email change.

- MFA enrollment, confirmation, challenge, recovery and disable flows.



## 11. Data/schema gaps



- Recipe cuisine, mood/vibe and sourced nutrition fields.

- Search/ranking aggregates or materialized/indexed query strategy.

- Recently viewed event model.

- Custom shopping row discriminator, label and optional recipe provenance.

- Meal reminder specification.

- User avatar, bio and cooking level.

- Follow relation and post-bookmark relation with compound uniqueness indexes.

- Notification preference taxonomy, inbox record and device-token models.

- Cook step title/duration/media fields.

- Assistant conversation/message models.

- Pending-email-change and MFA credential/recovery state.



## 12. Security/ownership gaps



- Derive all ownership from authenticated identity.

- Public profile serializers must expose only approved name/avatar/bio fields.

- Follows/bookmarks require opaque not-found behavior where privacy demands it and server-enforced uniqueness.

- Feed ranking must not leak private profiles or blocked/moderated content.

- Notification records and device tokens are recipient-owned; clients cannot choose recipient, actor, delivery status or timestamps.

- Custom shopping labels require strict length/control-character validation.

- Assistant history is private owner data with bounded retention.

- Email change requires proof of control and session-aware confirmation.

- MFA secrets require protected storage, one-time recovery codes and replay-safe challenge handling.

- Automatic substitution must not mutate global canonical recipes; it needs a separate owner-scoped recipe/formula decision.



## 13. Frontend-only gaps



These can reuse current backend contracts:



- DISC5 layout, shared recent-search UI and title/hierarchy.

- Meal Plan drag/drop over MEAL2’s atomic move API.

- Shopping swipe delete and count/status presentation.

- Dashboard cart badge.

- Ingredient Studio “add substitute to shopping.”

- Secure Assistant handoff for an unmatched Ingredient.

- Community recipe CTA to Recipe Detail or a focused ingredients screen.

- Minor final-card spacing, animation and haptic treatment.



## 14. Placeholder/nonrequirements



Source evidence supports rejecting these implementation details:



- Guest/demo authentication and local login flags.

- Client-held OpenAI keys, `EXPO_PUBLIC_OPENAI_*`, BYO-key AI settings.

- Mock arrays, fake refresh, fabricated counts and client-side ranking.

- Display-name identity and client-generated server IDs/timestamps.

- Guessed shopping categories.

- Heuristic nutrition, pH/moisture/confidence or cook-time scaling.

- AsyncStorage as domain authority.

- Standalone public profiles, Swap Detail and Admin Insights as teammate-pinned requirements—they are absent from the pinned tree.



Gestures and visible product behavior represented by those mocks remain requirements when listed elsewhere.



## 15. Dependency graph



```text

Profile fields/public author projection

└─> Follows

    └─> Following feed

        └─> For You ranking



Post bookmarks

└─> Saved Community feed

    └─> For You ranking



Recipe taxonomy + nutrition

├─> Final Discover filters

└─> Safe smart collections



Ranking foundation

├─> Top Rated Discover

├─> Trending recipes

└─> Community Trending / For You



Notification inbox/preferences

└─> Device registration/push plumbing

    ├─> Meal reminders

    └─> Community and core-activity delivery



Structured recipe steps

└─> Cook timers/resume/keep-awake



Current MEAL2 move API

└─> Meal drag/drop



Current shopping mutation API

└─> Swipe delete / substitute-to-shopping

```



## 16. Revised ordered milestone roadmap



The count below is 23 coherent product-parity slices, not 23 individual controls.



| # | Milestone and visible goal | Likely frontend files | Backend/data/security | Dependencies | Size |

|---:|---|---|---|---|---|

| 1 | **MOBILE-PROFILE2 — Avatar, bio and cooking level.** Real profile identity and Community avatars. | `ProfileScreen`, `AccountDetailScreen`, `CommunityScreen`, `profileService` | User fields, upload contract, public-author serializer; privacy allowlist and owner-only mutation. | None | LARGE |

| 2 | **MOBILE-DISC5 — Final Search interaction shell.** Inline hierarchy, shared recents and final Search composition over existing contracts. | `DiscoverScreen`, `DiscoverFiltersSheet`, `DashboardScreen`, shared history helper | No new domain data; preserve canonical filter/query allowlists. | None | MEDIUM |

| 3 | **MOBILE-DISC6 — Cuisine, mood and multi-filter taxonomy.** Final teammate filter families with real server semantics. | Discover filter/screen/options files | Recipe fields, enums, filters, indexes and content backfill; no inferred classifications. | None | LARGE |

| 4 | **MOBILE-HOME2 — Dashboard activity parity.** Cart badge, craving rail and Recently Viewed. | `DashboardScreen`, `TopBar`, new history service | Owner-scoped recent-view events/list; bounded retention. | None | MEDIUM |

| 5 | **MOBILE-RANK1 — Relevance, Top Rated and Trending.** Real ranked search plus dedicated Trending screen. | `DashboardScreen`, `DiscoverScreen`, new `TrendingScreen`, navigation | Aggregation/query contracts, tie-breakers and indexes; no client ranking. | DISC6 for complete search fields | LARGE |

| 6 | **MOBILE-SHOP4 — Completed-item cleanup and gesture parity.** Clear checked, swipe delete and counts. | `ShoppingListScreen`, context/service | Atomic owner-scoped clear-checked endpoint; existing delete reused. | SHOP3 complete | MEDIUM |

| 7 | **MOBILE-SHOP5 — Inline custom items and provenance.** Add arbitrary rows without fake Ingredient identity. | Shopping screen/context/service/modal replacement | Discriminated item schema, custom-label validation, optional recipe-source relation. | SHOP4 | LARGE |

| 8 | **MOBILE-MEAL3 — Drag/drop rescheduling.** Drag meals between real calendar days. | `MealPlanScreen`, move utilities/tests | Existing MEAL2 PATCH only; preserve stale-write protection. | MEAL2 complete | MEDIUM |

| 9 | **MOBILE-ING2 — Studio action parity.** Add a substitute to Shopping and securely ask Assistant when none exists. | `IngredientStudioScreen`, `SwapDetailScreen`, Assistant navigation | Existing substitution, shopping and Assistant APIs; no client key. | None | SMALL |

| 10 | **MOBILE-RECIPE4 — Authoritative nutrition.** Sourced per-serving nutrition in Recipe Detail. | `RecipeDetailScreen`, recipe service | Nutrition schema, provenance/versioning, validation, serializer and backfill; no estimates. | None | LARGE |

| 11 | **MOBILE-SAVED2 — Safe smart collections.** Quick, Breakfast, Dinner, Weekend and approved health collection semantics. | `SavedScreen`, `CollectionDetailScreen` | Server-defined smart collection queries; “Healthy” requires approved nutrition/dietary definition. | DISC6, RECIPE4 | LARGE |

| 12 | **MOBILE-NOTIF1 — Preferences and in-app inbox.** Real bell feed, unread/read state and deep-link payloads. | `TopBar`, `NotificationsScreen`, new context/service | Preference taxonomy and notification-record model/APIs; recipient ownership. | None | LARGE |

| 13 | **MOBILE-NOTIF2 — Native delivery foundation.** Permissions, device tokens and push plumbing. | app config, app bootstrap, notification service | Token registry, send adapter, invalid-token cleanup; tokens owner/device-bound. | NOTIF1 | LARGE |

| 14 | **MOBILE-MEAL4 — Cook reminders.** Set, edit, cancel and receive reminders for dated plan entries. | `MealPlanScreen`, time picker, notification service | Reminder fields/API and reconciliation; local OS schedule with validated deep link. | NOTIF1, NOTIF2, MEAL3 | LARGE |

| 15 | **MOBILE-COMM4 — Follow graph and Following feed.** Follow authors and browse followed posts. | `CommunityScreen`, community service | Follow model/APIs/feed scope; authenticated actor, uniqueness and privacy/moderation rules. | PROFILE2 | LARGE |

| 16 | **MOBILE-COMM5 — Post bookmarks and Saved feed.** Persist saved Community posts. | `CommunityScreen`, service | Bookmark relation/APIs with owner-scoped uniqueness. | Existing posts | MEDIUM |

| 17 | **MOBILE-COMM6 — Recipe CTA and final post cards.** Avatars, real recipe CTA and unavailable attachment treatment. | `CommunityScreen`, navigation; optionally new `RecipeIngredientsScreen` | Existing recipe detail/public-author data; media remains validated server data. | PROFILE2 | MEDIUM |

| 18 | **MOBILE-COMM7 — Trending and For You feeds.** Server-ranked feed modes. | `CommunityScreen`, service | Frozen score/window, stable pagination and moderation filtering. | COMM4, COMM5, RANK1 | LARGE |

| 19 | **MOBILE-NOTIF3 — Product event delivery.** Community, saved, collection and cooking events populate inbox/push. | Notification consumers and deep-link routing | Idempotent event producers/jobs, recipient preference checks and retries. | NOTIF2, COMM4–7 | LARGE |

| 20 | **MOBILE-COOK2 — Structured timers and resumable Cook Mode.** Titles, duration, pause/resume, keep-awake and safe progress. | `CookModeScreen`, recipe utilities, app config | Step metadata/schema/backfill; progress ownership decision; completion remains server-authoritative. | NOTIF1; protected stash disposition | LARGE |

| 21 | **MOBILE-AI2 — Private Assistant history.** New/open/delete conversations across sessions. | `AssistantScreen`, `assistantState`, service | Owner-scoped conversations/messages, retention and transcript bounds. | AI1A/B complete | LARGE |

| 22 | **MOBILE-ACCOUNT2 — Verified email change.** Change email without weakening verification/session guarantees. | `AccountDetailScreen`, auth/profile service | Pending address/token workflow, uniqueness, expiry, replay safety and notification of old address. | None | LARGE |

| 23 | **MOBILE-SEC2 — Real MFA.** Authenticator enrollment, login challenge, recovery and disable. | `SecurityScreen`, auth screens/context | Encrypted secret state, recovery codes, challenge/session contract and rate limits. | None | LARGE |



The current Swap Detail “apply” workflow is not counted because it is absent from the pinned teammate product. It still needs resolution as a release-facing dead control.



## 17. Parallelizable milestones



Safe independent lanes:



- Discovery: DISC5 → DISC6 → RANK1.

- Shopping: SHOP4 → SHOP5.

- Meal/notifications: NOTIF1 → NOTIF2; MEAL3 can run independently, then MEAL4.

- Community/profile: PROFILE2 first; COMM5 can run independently; then COMM4/COMM6 → COMM7.

- Recipe: RECIPE4 independently; SAVED2 afterward.

- Account: AI2, ACCOUNT2 and SEC2 are independent of the product-feed lanes.

- ING2 is a small independent frontend slice.



Do not run milestones touching the same screen/module concurrently without explicit file ownership.



## 18. Product parity remaining count



**23 product-parity milestones remain.**



Completed milestones DISC4, MEAL2, SHOP3 and COMM3 are preserved and excluded from this count. Release/legal gates and deferred technical debt are also excluded.



## 19. Release blockers



- Terms and Privacy explicitly identify themselves as placeholder text.

- Privacy/Terms make unsupported claims about AI personalization, substitution ratios, nutrition, retention and account deletion.

- Help Center says Assistant, Community, Meal Plan, Reviews, Collections and Cook History are unavailable even though they are built.

- Support contact/action is not configured.

- Licenses are a static mock list rather than a generated/verified bill of materials.

- About version is hardcoded.

- Notification bell exposes a visible unavailable feed.

- Swap Detail exposes an enabled CTA that cannot apply anything.

- Onboarding/product copy such as “thousands of recipes” needs catalog evidence.

- Required authenticated device/runtime, accessibility and native-notification gates remain unverified.



## 20. Deferred technical debt



- Dormant mobile mock data and unused local Community context remain in-tree and increase authority-confusion risk.

- Collection list/detail totals may include unusable memberships.

- Some recipe sorts lack deterministic `_id` tie-breakers.

- Recipe paging permits very large skips.

- Full device and screen-reader coverage remains deferred across several completed mobile milestones.

- Stale comments still describe older milestone states and missing features.



## 21. Polish/nonblocking work



- Staggered card fades and richer haptics.

- Exact spacing and icon-size matching.

- Consistent “Shopping List” versus “Grocery List” terminology.

- More precise loading skeletons.

- Final dark-mode tuning for imported presentation.

- Animation quality for drag/drop, filter collapse and notification dropdown.



## 22. Git status



```text

## main...origin/main

?? AGENTS.md

?? app.json

?? apps/api/audit-result.json

?? apps/mobile/.tmp-expo-config-error.txt

?? docs/WeCooked_Android_Dev_Build_Setup.md

?? docs/WeCooked_Local_Development_Startup.md

?? docs/architecture/WeCooked_Full_Project_Handoff.md

?? docs/architecture/frontend-migration-m2-screen-audit.md

?? docs/milestones/M25-email-verification.md

```



No tracked diff exists. The untracked set was present at the opening status and remained unchanged.



## 23. Stash status



```text

stash@{0}: On feat/cook-mode-timer-ui: WIP cook mode timer UI

```



It was not inspected, applied, dropped or modified.



## 24. Blockers



The audit itself is not blocked.



Implementation dependencies requiring decisions or external capability:



- Approved cuisine/mood/health/nutrition definitions and catalog backfills.

- Push provider credentials, native builds and device verification.

- Legal/privacy/support text approval.

- Disposition or later reconciliation of the protected Cook Mode stash before COOK2.

- Product decision for current Swap Detail’s nonfunctional apply CTA.



## 25. Verdict



**MOBILE-PARITY-AUDIT2 COMPLETE — REVISED ROADMAP READY**
