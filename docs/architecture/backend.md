# Backend architecture

This document covers `apps/api` only: the decisions already made and
implemented for the backend foundation. See
[docs/architecture/monorepo.md](./monorepo.md) for how the API fits into the
rest of the WeCooked monorepo.

## Modular monolith

`apps/api` is a single Node/Express service, not a set of microservices.
Features are organized feature-first as modules under `src/modules/`
(e.g. `src/modules/health/`). There is no message bus, no CQRS, no dependency
injection container, and no repository-interface layer — these are
deliberately avoided as unnecessary for the project's scale.

## Request flow

Each feature module is expected to follow the same layered flow:

```
Route -> validation/middleware -> Controller -> Service -> Repository -> Mongoose Model -> MongoDB
```

- **Route** — wires an HTTP verb + path to middleware/controller.
- **Validation/middleware** — request-shape and auth checks (Zod schemas).
- **Controller** — translates HTTP in/out; no business logic.
- **Service** — business logic, orchestration.
- **Repository** — the only layer that talks to a Mongoose Model.
- **Model** — the Mongoose schema/collection definition.

Only the `health` module exists so far, and it is simple enough not to need
every layer (it has no persistence). Future modules should add the layers
they actually need — don't create empty placeholder files for layers a
module doesn't use yet.

## Cross-module boundaries

Modules communicate through each other's **service** layer, never by
reaching directly into another module's repository or Mongoose model. This
keeps persistence details private to the module that owns them.

## `app.js` vs `server.js`

- **`src/app.js`** exports `createApp()`, which builds and configures the
  Express application (middleware, routes, error handling) and returns it.
  It never calls `app.listen()` and never connects to MongoDB. This makes it
  safe to `require` and test without a running server or a live database.
- **`src/server.js`** owns the process lifecycle: it loads/validates config,
  connects to MongoDB, then — only once that succeeds — builds the app and
  starts listening. It also owns graceful shutdown (`SIGINT`/`SIGTERM`):
  stop accepting new connections, close the HTTP server, disconnect from
  MongoDB, then exit.

## Configuration

All environment variables are read in one place, `src/config/env.js`, using
`dotenv` + `zod`. Nothing else in the codebase reads `process.env` directly.
`parseEnv()` is a pure function (raw env object in, validated config out or
a thrown `Error`) so it can be unit tested without side effects; `loadEnv()`
wraps it with `dotenv.config()` and caches the result. Invalid or missing
configuration throws a clear, descriptive error, which `server.js` turns
into a logged failure and a non-zero exit — the process never starts
accepting HTTP traffic on bad config.

## Database lifecycle

`src/config/database.js` owns the Mongoose connection: `connectDatabase()`
and `disconnectDatabase()`. No other file calls `mongoose.connect()` or
`mongoose.disconnect()`.

## Central error handling

- `src/shared/errors/app-error.js` defines `AppError`, a small carrier for
  an HTTP status, a stable string `code`, a safe message, and optional
  `details`. Business/validation code throws `AppError` for expected failure
  cases.
- `src/middleware/error.middleware.js` is the single Express error handler.
  Known `AppError`s are serialized as-is; anything else becomes a generic
  `500 INTERNAL_SERVER_ERROR` with a safe, static message — internal error
  details are never leaked to the client. Unexpected/internal errors are
  always logged server-side, including in production, for operational
  debugging; expected `AppError`s are only logged outside production, since
  in production they're expected traffic rather than a bug signal.
- `src/middleware/not-found.middleware.js` handles any request that reaches
  the end of the router without matching a route, returning a standard
  `404 ROUTE_NOT_FOUND`.
- `src/shared/http/response.js` provides `sendSuccess`/`sendError` helpers so
  every endpoint returns the same `{ success, data }` /
  `{ success: false, error: { code, message } }` envelope shape.

## Versioned REST API

Routes are mounted under `/api/v1` (`src/routes/v1.routes.js`), which
delegates to per-module routers. A new API version, if ever needed, would be
added as a sibling `v2.routes.js` rather than by changing `v1` in place.

## No direct database access from frontends (target architecture)

`apps/mobile` and `apps/admin` are intended to talk to `apps/api` over REST
only, with neither frontend ever connecting to MongoDB directly and MongoDB
credentials living only in the API's environment configuration. This is the
target end state, not yet the current state of every frontend.

`apps/admin` talks to `apps/api` over REST for all business data
(ingredients, substitutions, recipes, users); it no longer reads or writes
Firestore. It still carries an inherited Firebase **Authentication**
compatibility layer as temporary legacy infrastructure from the pre-monorepo
migration (see [docs/architecture/monorepo.md](./monorepo.md)). Moving the
Firebase-Auth-backed admin account flows onto `apps/api` is future work; it is
not performed as part of the backend foundation.

The end state remains: neither frontend connects to MongoDB directly, and
all backend/domain data access goes through `apps/api`.
