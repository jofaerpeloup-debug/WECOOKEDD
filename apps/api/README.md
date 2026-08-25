# wecooked-api

The WeCooked backend: Node.js + Express 5 + MongoDB/Mongoose. Currently
implements the application foundation only (config, database lifecycle,
security middleware, versioned router, health check, standard error format).
See [docs/architecture/backend.md](../../docs/architecture/backend.md) for
the architecture behind it.

## Local setup

1. Copy the example environment file and fill in local values:

   ```bash
   cp .env.example .env
   ```

   | Variable        | Required | Notes                                                        |
   | --------------- | -------- | ------------------------------------------------------------ |
   | `NODE_ENV`      | no       | `development` \| `test` \| `production` (default `development`) |
   | `PORT`          | no       | HTTP port (default `5000`)                                   |
   | `MONGODB_URI`   | yes      | `mongodb://` or `mongodb+srv://` connection string            |
   | `CORS_ORIGINS`  | no       | Comma-separated allowlist of browser origins                 |

   `.env` is git-ignored and must never contain real credentials in this
   repo; `.env.example` only holds non-secret example values.

2. Install dependencies from the monorepo root (this workspace uses
   `install-strategy=nested`, so always install via the root):

   ```bash
   npm install
   ```

## Running the API

From the monorepo root:

```bash
npm run dev --workspace=apps/api    # nodemon, auto-restarts on changes
npm run start --workspace=apps/api  # plain node
```

A MongoDB instance reachable at `MONGODB_URI` must be running — the server
connects to MongoDB before it starts listening, and exits non-zero if either
configuration is invalid or the connection fails.

## Tests

```bash
npm test --workspace=apps/api
```

Uses Node's built-in test runner (`node --test`) plus `supertest` for HTTP
assertions. Tests do not require a real MongoDB instance — `app.js` never
connects to the database, so it can be built and exercised in isolation.

## Health check

```
GET /api/v1/health
```

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "service": "wecooked-api",
    "timestamp": "2026-08-25T00:00:00.000Z"
  }
}
```
