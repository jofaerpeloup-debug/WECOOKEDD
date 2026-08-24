# WeCooked

Monorepo for the WeCooked product: a mobile app, an admin dashboard, and a
backend API, managed together with npm workspaces.

```text
apps/
  mobile/   React Native / Expo app
  admin/    React / Vite admin dashboard
  api/      Node / Express backend (dependency baseline only — not yet implemented)
packages/
  contracts/  shared, frontend-safe API contracts/constants (empty for now)
docs/
  architecture/  architecture decisions
```

See [docs/architecture/monorepo.md](docs/architecture/monorepo.md) for the
architecture decisions behind this structure.

## Getting started

```bash
npm install
npm run mobile   # starts the Expo dev server for apps/mobile
npm run admin    # starts the Vite dev server for apps/admin
```

`apps/api` has no implementation yet — it currently only declares its
intended dependencies.
