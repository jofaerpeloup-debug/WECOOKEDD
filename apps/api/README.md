# wecooked-api

The WeCooked backend: Node.js + Express 5 + MongoDB/Mongoose. Implements the
application foundation (config, database lifecycle, security middleware,
versioned router, health check, standard error format) plus users, sessions,
and local email/password authentication. See
[docs/architecture/backend.md](../../docs/architecture/backend.md) for the
general backend architecture and
[docs/architecture/authentication-security.md](../../docs/architecture/authentication-security.md)
for how authentication/sessions work.

## Local setup

1. Copy the example environment file and fill in local values:

   ```bash
   cp .env.example .env
   ```

   | Variable                 | Required | Notes                                                             |
   | ------------------------ | -------- | ------------------------------------------------------------------ |
   | `NODE_ENV`               | no       | `development` \| `test` \| `production` (default `development`)    |
   | `PORT`                   | no       | HTTP port (default `5000`)                                         |
   | `MONGODB_URI`            | yes      | `mongodb://` or `mongodb+srv://` connection string                 |
   | `CORS_ORIGINS`           | no       | Comma-separated allowlist of browser origins                       |
   | `JWT_ACCESS_SECRET`      | yes      | Access-token signing secret, **>= 32 characters**, no default      |
   | `JWT_ACCESS_TTL`         | no       | Access token lifetime (default `15m`)                              |
   | `REFRESH_TOKEN_TTL_DAYS` | no       | Absolute refresh-session lifetime in days (default `30`)           |
   | `BCRYPT_ROUNDS`          | no       | bcrypt work factor for password hashing (default `12`)             |

   `.env` is local, git-ignored configuration and **may** contain real
   development secrets (e.g. your own Atlas connection string) — it must
   never be committed or printed. `.env.example` holds only non-secret
   placeholder values, safe to commit.

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

## Authentication

Local email/password authentication with short-lived access JWTs and opaque,
rotating refresh-token sessions. See
[docs/architecture/authentication-security.md](../../docs/architecture/authentication-security.md)
for the full design.

| Method | Path                       | Auth required | Notes                                          |
| ------ | -------------------------- | -------------- | ----------------------------------------------- |
| POST   | `/api/v1/auth/register`    | no             | Creates a `role: "user"` account; returns tokens |
| POST   | `/api/v1/auth/login`       | no             | Returns tokens                                  |
| POST   | `/api/v1/auth/refresh`     | no (refresh token in body) | Rotates the refresh token             |
| POST   | `/api/v1/auth/logout`      | yes (access token) | Revokes the current session               |
| POST   | `/api/v1/auth/logout-all`  | yes (access token) | Revokes all of the user's sessions        |
| GET    | `/api/v1/users/me`         | yes (access token) | Returns the current user                  |

`register`/`login`/`refresh` responses include `accessToken` and
`refreshToken` in the JSON body — for Phase 2 backend/mobile testing only.
Send the access token as `Authorization: Bearer <accessToken>` on
authenticated requests.

`register`/`login`/`refresh` are rate-limited more strictly than the rest of
the API; exceeding the limit returns the standard `429 RATE_LIMIT_EXCEEDED`
envelope.
