# Admin — legacy "Report a problem" removal + final Firestore business-data retirement

Branch: `chore/admin-retire-firestore-business-data`

Removes the legacy Admin-only **"Report a problem"** feature outright. This was
the last Firestore code path in the admin app, so after this slice **Admin
source has zero Firestore reads or writes**. Firebase Authentication is
unaffected and remains active.

## Removed flow

```
ProfileMenu "Report a problem"  →  ReportModal  →  submitReport
  →  submitReportDoc  →  addDoc(collection(db, 'reports'), { description, contactEmail, submittedAt })
```

## Why remove rather than migrate

- **Write-only.** Nothing in Admin, mobile, the backend, or any Cloud Function
  ever read the `reports` collection — repo-wide grep for `getDocs` /
  `onSnapshot` / `query` against `reports` returns nothing.
- No product workflow consumes reports; there is no reports viewer or triage UI.
- Product decision: remove it. Do **not** build a backend Reports API, do
  **not** create `/api/v1/reports`, do **not** create a Report
  model/module/viewer, do **not** migrate existing Firestore reports to MongoDB.

## Code changes

| File | Change |
| --- | --- |
| `apps/admin/src/firestore.js` | **deleted** — it contained only `submitReportDoc` |
| `apps/admin/src/firebase.js` | removed `import { getFirestore }` and `export const db` — keeps `initializeApp` / `firebaseConfig` / `getAuth` / `auth` |
| `apps/admin/src/App.jsx` | removed the `submitReportDoc` import, `Flag` icon import, `reportOpen` state, `submitReport` handler, the `ProfileMenu` "Report a problem" launcher + `onOpenReport` wiring, the `<ReportModal>` render block, the `ReportModal` component, and the report-only CSS (`.wc-report-note`, `.wc-report-done`, `.wc-checkbox-row`); stale comments referring to "Report a problem" corrected to describe the Firebase-Auth account flows only |
| `apps/admin/firestore.rules` | catch-all rule changed to **deny-all** (`allow read, write: if false`) |

Shared UI (`.wc-textarea`, `.wc-field`, `.wc-modal*`, `.wc-btn-*`,
`.wc-auth-error`) and the lucide `Check` / `AlertCircle` / `X` icons are still
used elsewhere and were kept. `ProfileMenu` after removal: Settings & privacy /
Help & support / Display & accessibility / divider / Log out.

## Firestore retirement — source vs live

The checked-in `firestore.rules` now denies all client reads and writes. **This
is a source change only.** The live Firebase project (`wecooked-89a2f`) still
enforces the previously deployed rules (`allow read, write: if request.auth != null`)
until the project owner deploys the new file:

```
cd apps/admin
firebase deploy --only firestore:rules      # owner-operated release step — NOT run here
```

Before deploying, the owner should confirm no non-repo consumer (external
script, other app, Cloud Function) requires Firestore access. Repo evidence:
mobile has no Firebase, `apps/api` has no Firebase/Firestore, there are no
Cloud Functions and no CI deploy.

Until deployment, an authenticated Firebase user can still reach Firestore
directly using the public web config. Removing the client SDK code does not by
itself close the remote database.

## Firebase Auth retained

`apps/admin/src/auth.js` is unchanged. `firebase` and `firebase-tools` stay in
`apps/admin/package.json` (no dependency or lockfile changes). Firebase Auth
continues to back admin sign-in, sign-up, password reset/change, profile/email
edit, email verification, and account deletion. Deny-all **Firestore** rules do
not affect Firebase **Auth**.

## Remote report data

Existing `reports` documents remain orphaned in Firestore. No cleanup script,
no migration, no automated deletion. Some documents may contain a
`contactEmail` (the "include my email" checkbox defaulted on), so for data
minimization the project owner **may** manually delete the remote `reports`
collection from the Firebase console. This is an optional operational
follow-up, not part of this change.

## Out of scope

- Backend: `apps/api/**` untouched (baseline 659 passing). No Reports API,
  model, module, viewer, or endpoint.
- Mobile: `apps/mobile/**` untouched. The no-op "Report Recipe" action in
  `RecipeDetailScreen.js` is unrelated (no shared code, no Firebase) and
  remains separate future product debt — a proper user → moderation-report →
  admin-queue feature is not designed or built here.
- No dependency / `package.json` / `package-lock.json` / `.npmrc` / `.env`
  changes. No `firebase deploy`. No changes to `firebase.json`,
  `firestore.indexes.json`, `.firebaserc`, or the historical slice docs.
