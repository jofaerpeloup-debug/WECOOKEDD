# WeCooked

Monorepo for the WeCooked product: a mobile app, an admin dashboard, and a
backend API, managed together with npm workspaces.

```text
apps/
  mobile/   React Native / Expo app
  admin/    React / Vite admin dashboard
  api/      Node / Express backend (foundation implemented; feature modules not yet built)
packages/
  contracts/  shared, frontend-safe API contracts/constants (empty for now)
docs/
  architecture/  architecture decisions
```

See [docs/architecture/monorepo.md](docs/architecture/monorepo.md) for the
architecture decisions behind this structure, and
[docs/architecture/backend.md](docs/architecture/backend.md) for the API
foundation specifically.

## Getting started

```bash
npm install
npm run mobile   # starts the Expo dev server for apps/mobile
npm run admin    # starts the Vite dev server for apps/admin
npm run dev --workspace=apps/api   # starts the API (requires MongoDB, see apps/api/README.md)
```

`apps/api` currently implements only its application foundation (config
validation, database lifecycle, security middleware, versioned router, a
health check, and standard error handling) — no business features yet. See
[apps/api/README.md](apps/api/README.md).
