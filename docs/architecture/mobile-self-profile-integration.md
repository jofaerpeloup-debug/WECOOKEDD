# Self-Profile & Preferences — Mobile Integration (Phase B)

Status: implemented on `feat/mobile-self-profile-preferences`.
Backend companion: **Phase A** — `docs/architecture/self-profile-backend-api.md`
(`GET` / `PATCH /api/v1/users/me`), already merged.

## Purpose

Move the mobile self-profile/settings surfaces off mock/local-only state and
onto the backend self-profile REST API. No backend change.

## Authority

| Concern | Source |
|---|---|
| Read identity / preferences | `useAuth().user` (the `toPublicUser` payload from `GET /users/me`) |
| Write identity / preferences | `profileService.updateProfile(patch)` → `PATCH /api/v1/users/me` |
| Install the authoritative response into context | `useAuth().syncUser(updatedUser)` |

### `profileService` (`apps/mobile/src/api/profileService.js`)

Write-only, one function:

```js
updateProfile(patch) // -> api.patch('/users/me', { body: patch }).then(d => d.user)
```

Goes through the shared `api` client (bearer token + one transparent
refresh+retry already handled there). No `fetch`, no token logic, no
`getProfile()` (reads stay in `authService.fetchCurrentUser`), no error mapper,
no normalization. Returns `data.user` — the same shape `GET /users/me` returns.

### `AuthContext.syncUser` (`apps/mobile/src/context/AuthContext.js`)

```js
const syncUser = useCallback((nextUser) => {
  if (!mountedRef.current) return;
  setUser((prev) => (prev && nextUser && prev.id === nextUser.id ? nextUser : prev));
}, []);
```

`PATCH /users/me` already returns the authoritative updated public user, so
there is **no follow-up `GET` and no `refreshUser()` call** in the write flow —
that would only add a redundant round-trip and a "saved but the refresh failed"
window.

`syncUser` is **not** a general-purpose setter. The functional update installs
the payload only when it belongs to the **same still-authenticated user**, so a
profile write that resolves after a sign-out or a user switch is ignored. Raw
`setUser` is not exposed. `restoreSession`, `signIn`, `signUp`, `signOut`,
`signOutEverywhere`, `refreshUser`, and `onSessionExpired` are unchanged.

## ProfileScreen

- `name` / `email` render directly from `useAuth().user`.
- Avatar: a neutral `Ionicons name="person"` glyph in a circular `View`
  (backend has no avatar field). No photo, no initials helper, no edit
  affordance, no new asset, no new component.
- The full-screen mock-avatar viewer (`Modal` + `viewerOpen` + dead styles) is
  removed.
- `chef` import removed. Menu list and navigation are otherwise unchanged.

## AccountDetailScreen

- Local form state is **seeded once on mount** from `user` (`useState`
  initializers). No `useEffect([user])` re-sync — that would clobber unsaved
  edits if context changed under the screen. The screen is a fresh native-stack
  push each visit, so mount-time seeding is sufficient.
- **Name** — editable `Input`, `maxLength={100}`, trimmed on save. Empty /
  whitespace-only name shows `Name is required.` and disables Save. No internal
  whitespace collapsing, no Unicode normalization.
- **Email** — a visibly read-only static row (label + `user.email`) plus the
  caption *"Email changes aren't available yet."* No local state, no
  `onChangeText`, never a PATCH key.
- **Dietary Preferences** and **Allergies** — two separate sections, each bound
  to its own backend array (`preferences.dietaryPreferences` /
  `preferences.allergies`). The old conflated `chef.dietary` list (which mixed
  `Nut Allergy` into dietary) is gone; nothing is migrated. Empty arrays render
  an empty section (`None yet.`).
- Both sections use one local `PreferenceSection` component (defined in the
  screen file — not a new file). Removable chips + an inline `TextInput` + Add
  button; keyboard "done" also adds.
- The Password field / "Change Password" shortcut to `SecurityScreen` is
  removed — that screen has no backend implementation and claims success
  locally. `SecurityScreen.js`, `SettingsScreen.js`, and navigation are
  untouched.
- The `MASTER EATER` title badge (`chef.title`) is removed and **not** replaced
  with `role`.
- `chef`, `loadJSON`, `saveJSON` imports removed. No read/write of
  `wecooked:profile` (see Local storage).

### Client-side add validation (UX only — backend stays authoritative)

| Case | Behaviour |
|---|---|
| empty / whitespace-only | Add disabled; no-op |
| `> 50` chars after trim | rejected, hint `Keep entries under 50 characters` |
| 21st entry | rejected, hint `Up to 20 entries` |
| exact duplicate (case-sensitive) | rejected, hint `Already added` |

`"Vegan"` and `"vegan"` are distinct entries. Duplicates are **not** silently
deduped and **not** allowed as duplicate chips — the backend permits duplicates
but no legitimate UX needs two identical chips, and removal is by value.

### Save body

```jsonc
{
  "name": "<trimmed>",
  "preferences": {
    "dietaryPreferences": [...],
    "allergies": [...]
  }
}
```

`notifications` is deliberately omitted — the backend leaves omitted preference
leaves untouched, so including it here could clobber a change made on the
Notifications screen. `email` / `role` / `status` / `id` / anything else are
never sent.

On success: `syncUser(updated)` → `navigation.goBack()`. ProfileScreen reflects
the new name immediately (it reads `user` from context).

### Mutation lock

`savingRef` (synchronous `useRef`) **and** `saving` state. `handleSave` returns
early if `savingRef.current` is set; `savingRef` is set/cleared synchronously,
`saving` drives `Button` `loading` / `disabled` (`disabled={saving ||
nameInvalid}`). No request queue.

### Error UX

`getAuthErrorMessage(err)` (from `apps/mobile/src/api/errorMessages.js`,
unchanged) → inline `formError` text above Save, cleared before each attempt.
Section-level hints for add validation. No raw backend body / stack. No
screen-level logout — the shared client + `onSessionExpired` remain
authoritative for session death.

## NotificationsScreen

- `notificationSettings` import and the five local mock toggles removed.
- One row: **Allow notifications** / *Turn WeCooked notifications on or off.*
- The `Switch` value is derived **directly** from
  `user.preferences.notifications.enabled` — no local boolean mirror.
- **Pessimistic** mutation: `savingRef` + `saving`; `Switch` is
  `disabled={saving}` and does not move until the PATCH response updates
  context. Body: `{ preferences: { notifications: { enabled: next } } }`. On
  success `syncUser(updated)` flips the switch to the authoritative value; on
  error an inline message shows and nothing needs reverting (the switch never
  moved). No optimistic update, no toggle queue.

## TopBar

The bell dropdown (`NotificationDropdown`) previously rendered five fake
settings-style `Switch` rows — a second, contradictory "notification settings"
surface once the real screen became a single toggle. Those rows, the
`notificationSettings` import, and the local toggle state are removed and
replaced with a static empty state (`You're all caught up.`). The bell, the
dropdown shell / popover animation, the bell dot, and all other TopBar
behaviour are unchanged. No feed, no persistence, no link to profile
preferences.

## Local storage

`wecooked:profile` had exactly one reader and one writer, both in
`AccountDetailScreen`. Both are removed. The key is **not** deleted (no
`removeItem`, no `storage.js` change) — after Phase B nothing reads it, so the
stale value is inert. Matches the existing `wecooked:shoppingList` precedent in
`ShoppingListContext`.

## Mock boundary

- `ProfileScreen`, `AccountDetailScreen` — no `chef` import.
- `NotificationsScreen`, `TopBar` — no `notificationSettings` import.
- `apps/mobile/src/data/mockData.js` is **unchanged**: `chef` stays (Community
  still uses it in `CommunityContext` / `CommunityScreen`), and
  `notificationSettings` stays exported even though it now has no consumer.

## Dependencies / navigation

None added. No `package.json` / lockfile / `.npmrc` change. No navigation change
— `Profile → AccountDetails` and `Settings` (personal / dietary) →
`AccountDetails` remain valid.

## Out of scope

Password change, 2FA, account deletion, `emailVerified`, email change, avatar
upload / storage / schema, granular per-channel notification categories, a
notification feed, Community migration, any controlled dietary/allergy
taxonomy.
