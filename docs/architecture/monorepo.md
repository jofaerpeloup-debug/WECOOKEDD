# WeCooked Monorepo

WeCooked is one product built from three applications, developed together in a
single Git repository:

- `apps/mobile` — the React Native / Expo mobile app.
- `apps/admin` — the React / Vite admin dashboard.
- `apps/api` — the Node / Express backend.

## Workspace tooling

The monorepo uses **npm workspaces** to manage the three apps and
`packages/contracts`. No additional orchestration tool (Nx, Turborepo, pnpm,
Yarn) has been introduced. This may be revisited later, but only with explicit
approval.

Each app remains independently deployable — the mobile app ships through
Expo/app stores, the admin app builds as a static Vite bundle, and the API
deploys as its own Node service. Sharing a repository does not mean sharing a
deployment pipeline.

## Communication

- `apps/mobile` and `apps/admin` talk to `apps/api` over REST only.
- Neither frontend connects directly to MongoDB, in the final architecture.
- `apps/api` is the only component that talks to MongoDB and to any external
  LLM provider. AI provider credentials live only in the backend.

## Backend architecture

`apps/api` is a modular monolith following clean/layered architecture
principles — not microservices. Its application foundation (config
validation, database lifecycle, security middleware, versioned router,
health check, standard error handling) is implemented; business feature
modules are not yet built. See
[docs/architecture/backend.md](./backend.md) for details.

## Frontend architecture

Frontends are organized by feature, with an MVVM-inspired separation using
React hooks/services rather than classical MVVM abstractions.

## packages/contracts

`packages/contracts` is reserved for deliberately shared, frontend-safe
values: API contracts, constants, enums, and validation schemas. It is not a
general-purpose `shared` package, and must never contain backend-only code,
database models, secrets, or AI integration logic.

## Relationship to the old repositories

`WECOOKEDD`, `ingredient-hub`, and `wecooked-api` (siblings of this
repository) are the historical/reference source projects this monorepo was
migrated from. They were not deleted and their own Git histories were not
merged into this repository — `wecooked` begins with a clean history.

## Firebase (admin app) — temporary legacy infrastructure

`apps/admin` was inherited from `ingredient-hub` talking to Firebase (Firebase
Authentication + Firestore) for all of its data and admin-account management.
The Firestore business-data migration onto the Express/MongoDB API is
**substantially complete**: ingredients, substitutions, recipes, and users all
run over REST, and the last Firestore code path (the legacy "Report a problem"
feature) was removed
([admin-remove-legacy-reporting.md](./admin-remove-legacy-reporting.md)).

Admin business data now flows:

```
React Admin → shared REST modules (apiClient / feature *Api.js) → Express → MongoDB
```

Firebase remains **only** for Firebase-Authentication-backed admin account
flows (sign-in, sign-up, password reset/change, profile/email edit, email
verification, account deletion). Moving those onto the backend is a later
auth-hardening phase.

> The legacy Firebase rules authorized all authenticated users broadly and are
> not suitable as the final WeCooked authorization model. Business-data
> authorization is now enforced server-side by the Express API.

The checked-in `firestore.rules` has been set to **deny-all**
(`allow read, write: if false`) now that no code needs Firestore. This is a
source change only — live enforcement on the Firebase project requires the
project owner to deploy it (`firebase deploy --only firestore:rules` from
`apps/admin`); until then the previously deployed rules
(`allow read, write: if request.auth != null`) remain in effect.
