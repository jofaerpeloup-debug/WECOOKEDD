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

## Backend architecture (future)

`apps/api` is planned as a modular monolith following clean/layered
architecture principles — not microservices. This has not been implemented
yet; this migration only establishes the workspace and its dependency
baseline.

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

`apps/admin` currently talks to Firebase (Firebase Authentication + Firestore)
for its data and admin-account management, inherited as-is from
`ingredient-hub`. This is temporary legacy infrastructure. It is expected to
be replaced by the Express/MongoDB API in a later phase; that migration has
not started.

> The legacy Firebase rules authorize all authenticated users broadly and are
> not suitable as the final WeCooked authorization model. The future Express
> backend must enforce user/admin authorization server-side.

The existing `firestore.rules` (`allow read, write: if request.auth != null`)
grants any authenticated user full read/write access to every collection —
there is no admin-role check. This rule set was preserved as-is for reference
during migration and was not deployed or modified as part of this task.
