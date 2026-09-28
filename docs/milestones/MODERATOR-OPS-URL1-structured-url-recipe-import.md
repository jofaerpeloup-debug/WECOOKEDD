# MODERATOR-OPS-URL1 — Structured URL Recipe Import

Status: implementation and runtime verification complete — ready for repository finalization

Audit date: 2026-09-28

Audited branch: `main`

Audited commit: `ea2cdca186f6ea2724e62c93faa2984f86273160`

Application code status: read-only during this audit

## 1. Goal and verdict

Add the smallest safe Moderator-only helper that accepts one public recipe-page
URL, retrieves inert HTML on the API server, extracts exactly one unambiguous
Schema.org `Recipe` JSON-LD object, and returns that raw candidate to the Staff
Portal. The Staff Portal must pass the candidate into the existing M27
`parseRecipeIntake` Preview/Apply path. Import is not a Recipe mutation.

The current API can bind DNS validation to the real TLS connection using
`node:https.request`, a pre-resolved address, a request-local custom `lookup`
callback, normal TLS hostname verification/SNI, and a post-connect
`socket.remoteAddress` check. Therefore the deployment model does not trigger
the SSRF stop condition.

Verdict: **AUDIT PASS — READY FOR IMPLEMENTATION**.

## 2. Verified baseline

The required baseline commands produced:

```text
git status --short --branch
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

git rev-parse HEAD
ea2cdca186f6ea2724e62c93faa2984f86273160

git branch --show-current
main

git merge-base HEAD main
ea2cdca186f6ea2724e62c93faa2984f86273160

git rev-parse origin/main
ea2cdca186f6ea2724e62c93faa2984f86273160

git rev-list --left-right --count HEAD...origin/main
0  0

git log -1 --oneline
ea2cdca Merge pull request #69 from klaynn/feat/m27-moderator-structured-recipe-prefill
```

The untracked files pre-date this milestone and were not cleaned or modified.
The requested milestone file did not previously exist.

`ea2cdca186f6ea2724e62c93faa2984f86273160` is the audited HEAD and M27 merge
commit. Its parents are the prior `main` commit
`107523a633849edb8916d847612701afb57cf755` and the M27 implementation commit
`ccf0bbc42d60a29498163a0d28df2f2fb7e5562f`. The implementation commit is an
ancestor of HEAD, and its tree has no file delta from the merge result.

No baseline discrepancy triggers a stop.

## 3. Repository areas inspected

- Root `AGENTS.md`, Git branch/commit/remote relationship, workspace package
  manifests, lockfile, installed Node runtime, and API deployment assumptions.
- API application mounting, JSON request limits, central error envelope,
  validation middleware, authentication, capability enforcement, proxy trust,
  and rate-limiter implementation.
- Recipe routes, controller, validation, service architecture, route tests, and
  catalog-authority tests.
- `apps/api/src/shared/validation/public-https-url.js`; it is deliberately a
  string-only validator for stored display URLs and is not an SSRF fetch guard.
- Existing outbound Brevo transport and its five-second total timeout.
- Admin API client, `recipeApi.js`, `portalPolicy.js`, `RecipesTab`, the Recipe
  authoring wizard, M27 intake parser, Preview/Apply UI, authoring state/save
  lifecycle, styles, and focused tests.
- Current dependency tree for HTTP, HTML parsing, and IP classification.
- Official Node documentation for custom request lookup, streaming, DNS lookup,
  TLS server-name verification, plus current `parse5` and `ipaddr.js` package
  metadata. No package was installed or changed.

## 4. Current architecture and frozen M27 authority

The live architecture remains:

```text
Staff Portal Recipe authoring
  -> recipeApi / shared authenticated apiClient
  -> /api/v1/recipes
  -> authenticate -> validate -> requireCapability(catalog.write)
  -> recipe.controller -> recipe.service -> recipe.repository -> Recipe -> MongoDB
```

M27 added a client-local, 256 KiB maximum JSON-LD parser at
`apps/admin/src/recipeAuthoring/recipeIntake.js`. It accepts a direct object, an
array, or an `@graph` array; rejects zero or multiple Recipe candidates; maps
only safe scalar/instruction fields; leaves ingredient strings unresolved; and
applies only to blank form fields. Preview and Apply make no API call. The
existing explicit Draft save/PATCH/Publish lifecycle remains authoritative.

The live capability map gives `catalog.write` to Moderator and deliberately
withholds it from Admin. `RecipesTab` mounts the authoring wizard only when the
portal policy says `canWriteCatalog`; the API must independently enforce the
same capability.

URL import attaches before M27 Preview/Apply:

```text
Moderator URL
  -> POST /api/v1/recipes/import-url
  -> authenticate -> require catalog.write -> endpoint rate limits
  -> validate URL -> resolve and classify every address
  -> TLS GET pinned to one validated address
  -> bounded inert HTML -> Recipe JSON-LD extraction
  -> { sourceUrl, candidate }
  -> existing M27 parseRecipeIntake(JSON.stringify(candidate))
  -> existing Preview -> Apply blank fields
  -> Moderator edits/resolves canonical Ingredients
  -> existing explicit Save Draft / PATCH / Publish
```

The import service must not call any repository, Recipe service mutation,
Ingredient service mutation, upload service, or publish service.

## 5. Endpoint and response contract

Freeze one endpoint:

```text
POST /api/v1/recipes/import-url
Content-Type: application/json

{ "url": "https://public.example/recipe" }
```

The body is strict and contains only `url`, trimmed and limited to 2,048
characters. The endpoint returns HTTP 200 only after safe retrieval and exact
candidate selection:

```json
{
  "success": true,
  "data": {
    "sourceUrl": "https://public.example/recipe",
    "candidate": { "@type": "Recipe", "name": "Example" }
  }
}
```

`candidate` is the raw parsed Recipe JSON-LD object, not a second WeCooked field
mapping. The backend must not normalize Recipe authoring fields. The Admin
serializes this one object and passes it to the existing M27 parser, which stays
authoritative for supported, invalid, unsupported, and unresolved fields.

`sourceUrl` is the final effective HTTPS URL after redirects, with its fragment
removed. It is returned only for Moderator display. It is not added to the
Recipe schema, sent in Draft/PATCH/Publish payloads, or otherwise persisted.

## 6. URL, DNS, and IP policy

### 6.1 URL validation

For the initial URL and every redirect target:

- Parse with the WHATWG `URL` class; reject parse failures.
- Permit `https:` only. Plain HTTP, FTP, file, data, gopher, custom schemes,
  and protocol-relative input are rejected.
- Permit only the default HTTPS port. An absent port and an explicit `:443`
  normalize to the same accepted destination; every other explicit port is
  rejected.
- Reject any username or password.
- Remove the fragment before resolution/request. Query strings are allowed but
  are never logged.
- Normalize the hostname through `URL`, lowercase it, remove one terminal DNS
  dot, and require a multi-label hostname.
- Reject `localhost`, `.localhost`, `.local`, `.internal`, and any IP literal.
  Rejecting all IPv4/IPv6 literals is an intentional v1 reduction of attack
  surface; public literal URLs are not a product requirement.
- Do not reuse `isPublicHttpsUrl` as the fetch decision. That helper explicitly
  does no DNS work and covers only a subset of non-public ranges because its
  current purpose is inert display-URL validation.

### 6.2 Resolution and address classification

- Resolve with `dns.lookup(hostname, { all: true, order: 'verbatim' })`, matching
  the operating-system resolution path used by Node connections.
- DNS failure or an empty answer set fails closed.
- Parse every returned address with the directly declared `ipaddr.js` package.
- For IPv4-mapped IPv6, convert to and classify the embedded IPv4 address.
- Accept only addresses classified as globally routable unicast. Reject
  unspecified, current-network, loopback, private, shared/CGNAT, link-local,
  multicast, broadcast, documentation, benchmarking, reserved, unique-local,
  IPv4-mapped private/non-public, and all other non-global ranges.
- If any answer is non-public, reject the hostname; do not select a public
  answer from a mixed public/private set. This closes mixed-answer rebinding and
  resolver-order ambiguity.
- Cloud metadata destinations are therefore blocked, including IPv4 link-local
  metadata addresses, IPv6 unique-local metadata addresses, CGNAT-style
  metadata addresses, and metadata hostnames resolving to a blocked address.

### 6.3 Validation-to-connection binding

After all answers pass, choose the first validated address from the frozen
answer set and issue the request with `https.request` using:

- the original hostname for the HTTP Host header, TLS SNI, and normal
  certificate hostname verification;
- `agent: false` so the request uses a fresh connection and cannot reuse a
  previously pooled socket;
- a request-local custom `lookup` callback that returns only the chosen,
  already-validated address and family; it must never call DNS again;
- no custom CA, no disabled certificate verification, and no permissive
  `checkServerIdentity`;
- a `secureConnect` check that parses `socket.remoteAddress`, confirms it is
  still public, and confirms it equals the pinned address after normalizing
  IPv4-mapped notation. Mismatch destroys the socket and fails closed.

This removes the DNS validation-versus-connect gap: an attacker cannot change a
second DNS answer because there is no second lookup. Native `fetch` must not be
used for the importer unless a later audited implementation proves an
equivalent connection-pinning contract.

## 7. Redirect model

- Disable automatic redirects and handle only 301, 302, 303, 307, and 308.
- Allow at most three redirects. The fourth redirect returns the stable
  too-many-redirects error.
- Resolve relative `Location` values against the current URL.
- Run the complete URL, hostname, DNS, address, and pinned-connection checks for
  every hop. Redirects to HTTP, credentials, a non-default port, an IP literal,
  localhost/internal names, mixed DNS answers, or any non-public address fail
  as a blocked redirect before connecting.
- Never carry response cookies, Authorization, or any prior-hop header state to
  the next hop.
- Destroy redirect response bodies without buffering them.
- The five-second total deadline covers resolution, all redirects, connection,
  headers, and body; redirects do not restart it.

Three redirects are a deliberately conservative compatibility ceiling: it
allows ordinary canonical-host/path redirects while keeping DNS/connect work
bounded to four total destinations.

## 8. Outbound request and download policy

Freeze the following v1 policy:

| Control | Decision |
|---|---|
| Method | `GET` only; no request body |
| Protocol/port | HTTPS, default port 443 only |
| Connection timeout | 3 seconds per hop |
| Total timeout | 5 seconds across the complete operation, matching the existing API outbound-provider ceiling |
| Redirects | Manual; maximum 3; full revalidation each hop |
| Header limit | Explicit Node client `maxHeaderSize` of 16 KiB |
| Response body | Stream and stop at 1 MiB before retaining any additional chunk |
| JSON-LD text | Aggregate nonblank `application/ld+json` script text maximum 256 KiB, matching M27 intake |
| Returned candidate | `JSON.stringify(candidate)` must also be at most 256 KiB so M27 can accept it |
| Content types | `text/html` or `application/xhtml+xml`, parameters allowed |
| Character encoding | Missing charset or UTF-8/UTF8 only; decode with fatal UTF-8 and reject malformed bytes |
| Accept | `text/html, application/xhtml+xml;q=0.9` |
| Compression | Send `Accept-Encoding: identity`; accept absent/`identity` Content-Encoding only; do not decompress |
| User-Agent | `wecooked-recipe-importer/1.0` |
| Connection reuse | Disabled with `agent: false` and `Connection: close` |
| Cookies/auth | Never send `Cookie`, `Authorization`, CSRF/session data, internal tokens, or application secrets |
| Proxies | Do not construct a proxy agent and do not honor HTTP(S) proxy environment variables |
| Cache | No application or durable cache in v1 |

One MiB is the existing API request-body ceiling and is sufficient for inert
recipe-page markup while bounding parse memory. The separate 256 KiB limit is
the existing M27 intake contract. `Content-Length` greater than the limit may
reject early, but missing/false `Content-Length` never bypasses the streaming
counter. Because compressed encodings are rejected, compressed data cannot
expand past the decoded limit. A server that ignores `Accept-Encoding:
identity` fails closed rather than being decompressed.

Unexpected binary content, unsupported/missing media type, unsupported charset,
malformed UTF-8, oversized bodies, slow/stalled responses, TLS errors, login or
challenge HTML with no Recipe JSON-LD, and non-HTML redirects all produce safe
non-mutating errors. No remote scripts, styles, images, frames, or other
resources are requested.

## 9. HTML and JSON-LD extraction contract

Use `parse5` on the already bounded, decoded HTML. It provides a standards-
compliant inert HTML parse; it does not execute JavaScript or load resources.
Do not use regex as an HTML parser, `eval`, a DOM/browser runtime, or a headless
browser.

Extraction is deterministic:

1. Traverse parsed elements for `script` whose trimmed, case-insensitive media
   type before any `;` parameter is exactly `application/ld+json`.
2. Read text children only. Do not interpret markup or execute contents.
3. Ignore an empty/whitespace-only script. Enforce the aggregate 256 KiB limit
   before JSON parsing.
4. `JSON.parse` every nonblank JSON-LD block independently. If any such block
   is malformed, fail with `RECIPE_IMPORT_JSONLD_INVALID`; do not silently skip
   a block that might have contained another Recipe.
5. From each parsed document, inspect a direct object, top-level array members,
   and objects in a top-level `@graph` array. A Recipe candidate has `@type`
   equal to `Recipe` or an array containing `Recipe`, matching M27 semantics.
   Unrelated Schema.org objects are ignored.
6. Count candidates across every script block. Do not pick the first candidate.
7. Zero candidates returns `RECIPE_IMPORT_NO_RECIPE`; exactly one returns that
   raw object; more than one returns `RECIPE_IMPORT_MULTIPLE_RECIPES`.
8. Before return, verify serialized candidate size is at most 256 KiB.

Partially malformed pages fail closed. A valid Recipe beside malformed JSON-LD
does not succeed because the malformed block is ambiguous. Unsupported remote
Recipe fields are retained in the raw candidate so M27 can report them as
unsupported; they do not become silently mapped server-side.

## 10. Authorization, rate limiting, and concurrency

Route middleware order is frozen:

```text
authenticate
  -> requireCapability(catalog.write)
  -> dedicated per-IP limiter
  -> dedicated per-user limiter
  -> strict body validation
  -> controller/import service
```

Admin has no `catalog.write`, so it receives 403 before URL validation or any
outbound request. User and unauthenticated callers likewise cannot turn this
into a public relay. Current database-backed role/session hydration remains
authoritative.

Reuse the current `express-rate-limit` wrapper and established 15-minute
budgets:

- per IP: 20 attempts per 15 minutes, matching the existing high-risk Google
  outbound/auth IP budget;
- per authenticated user: 10 attempts per 15 minutes, matching the existing
  authenticated high-risk per-user budget;
- process-wide outbound concurrency: one active URL import. A second concurrent
  attempt fails immediately with 503 `RECIPE_IMPORT_BUSY`; no unbounded queue.

Every attempt, including invalid/blocked URLs, consumes both endpoint budgets.
The existing app-wide 300/15-minute IP limit remains in addition. The one-slot
process-wide gate is deliberately conservative for the currently documented
single Render instance and bounds a compromised Moderator account to one live
outbound socket. It must be acquired immediately before URL resolution and
released in `finally` for every outcome.

The current stores and concurrency gate are process-local. Before scaling the
API beyond one instance, this feature requires a shared limiter/concurrency
design or an infrastructure egress gateway; do not claim fleet-wide limits
from the v1 implementation.

## 11. Error contract and logging

All client responses use the existing `{ success: false, error: { code,
message } }` envelope. Freeze these stable outcomes:

| HTTP | Code | Moderator-safe message/use |
|---:|---|---|
| 400 | `RECIPE_IMPORT_URL_INVALID` | Enter a valid absolute recipe URL. |
| 400 | `RECIPE_IMPORT_PROTOCOL_UNSUPPORTED` | Recipe import supports HTTPS URLs only. |
| 400 | `RECIPE_IMPORT_CREDENTIALS_NOT_ALLOWED` | Recipe URLs must not contain credentials. |
| 400 | `RECIPE_IMPORT_PORT_NOT_ALLOWED` | Recipe URLs must use the default HTTPS port. |
| 422 | `RECIPE_IMPORT_DESTINATION_BLOCKED` | This destination cannot be imported. |
| 502 | `RECIPE_IMPORT_DNS_FAILED` | The recipe website could not be resolved. |
| 422 | `RECIPE_IMPORT_REDIRECT_BLOCKED` | The recipe website redirected to a blocked destination. |
| 422 | `RECIPE_IMPORT_TOO_MANY_REDIRECTS` | The recipe website redirected too many times. |
| 504 | `RECIPE_IMPORT_TIMEOUT` | The recipe website took too long to respond. |
| 413 | `RECIPE_IMPORT_RESPONSE_TOO_LARGE` | The recipe page is too large to import. |
| 413 | `RECIPE_IMPORT_JSONLD_TOO_LARGE` | The page's structured recipe data is too large to import. |
| 415 | `RECIPE_IMPORT_CONTENT_TYPE_UNSUPPORTED` | The URL did not return a supported HTML page. |
| 415 | `RECIPE_IMPORT_CONTENT_ENCODING_UNSUPPORTED` | The recipe page used an unsupported content encoding. |
| 415 | `RECIPE_IMPORT_CHARSET_UNSUPPORTED` | The recipe page must use UTF-8 text. |
| 422 | `RECIPE_IMPORT_TEXT_INVALID` | The recipe page could not be decoded safely. |
| 502 | `RECIPE_IMPORT_REMOTE_FAILED` | The recipe website could not be retrieved. |
| 422 | `RECIPE_IMPORT_NO_RECIPE` | No Recipe JSON-LD was found on this page. |
| 422 | `RECIPE_IMPORT_JSONLD_INVALID` | The page contains invalid Recipe JSON-LD. |
| 422 | `RECIPE_IMPORT_MULTIPLE_RECIPES` | The page contains multiple Recipe candidates; paste one Recipe JSON-LD object instead. |
| 429 | existing `RATE_LIMIT_EXCEEDED` | Existing standard limiter response. |
| 503 | `RECIPE_IMPORT_BUSY` | Recipe import is busy. Try again shortly. |

Do not include raw DNS/TLS/socket error text, IP addresses, ports, redirect
targets, or upstream bodies in client responses.

Internal structured logs may contain event code, duration, byte count,
redirect count, normalized hostname, and the selected public address. Never log
the URL query/fragment, request body, returned JSON-LD, response body,
Authorization/Cookie headers, session data, or application secrets. Development
Morgan logging already records only the local API request path, not the posted
URL body.

## 12. Persistence, caching, and schema decision

- No `Import`, `RecipeDraft`, or `IngredientDraft` model.
- No Recipe schema/API field for source URL in this milestone.
- No database write, Draft creation, PATCH, publish, Ingredient creation,
  Substitution mutation, upload, or image download during import.
- No durable or cross-user cache. It would add stale remote content,
  provenance, storage, invalidation, and leakage questions without evidence of
  need.
- The only transient state is bounded request data and the process-wide
  concurrency slot, released after each request.

## 13. Package and runtime decision

Node core is sufficient for URL parsing, DNS lookup, TLS/HTTPS, custom lookup
pinning, streaming, timers/abort, byte counting, and UTF-8 decoding. It is not
appropriate to hand-roll comprehensive IP-range classification or HTML token
parsing.

Add exactly two direct API runtime dependencies during implementation:

- `ipaddr.js@2.5.0`: zero-dependency IPv4/IPv6 parsing, mapped-address handling,
  CIDR/range classification, and explicit rejection of non-global ranges. The
  repository currently has only an undeclared transitive 1.x copy under
  Express; production code must not import a transitive dependency.
- `parse5@8.0.1`: standards-compliant inert HTML parsing. The API is CommonJS,
  so load the ESM package through a bounded async `import()` path in the import
  service/extractor rather than changing the API module system.

Pin these audited versions exactly in `apps/api/package.json`; the root lockfile
records their integrity/dependency tree. Both packages are narrowly scoped and
avoid a general HTTP client, browser engine, DOM runtime, or scraping stack.
They add maintenance/security review obligations and must be covered by the
normal dependency-review gate before release.

Also declare `engines.node: ">=20.19.0"` in the API manifest. This does not
raise the effective live dependency floor: installed Mongoose 9.9.3 already
requires Node 20.19 or newer. It makes the API runtime assumption explicit for
the DNS/request behavior. No environment variable, secret, database migration,
or deployment setting is required.

Do not install dependencies during this audit. If implementation cannot use
the pinned lookup/remote-address model with the deployed Node runtime, stop and
return **AUDIT BLOCKED — DO NOT IMPLEMENT** rather than substituting native
`fetch` or a client with automatic DNS/redirect behavior.

## 14. Exact production allowlist

Backend:

```text
apps/api/src/modules/recipes/recipe.routes.js                         (modify)
apps/api/src/modules/recipes/recipe.controller.js                     (modify)
apps/api/src/modules/recipes/recipe.validation.js                     (modify)
apps/api/src/modules/recipes/recipe-url-import.service.js             (new)
apps/api/src/modules/recipes/recipe-url-fetcher.js                    (new)
apps/api/src/modules/recipes/recipe-jsonld-extractor.js               (new)
apps/api/src/middleware/rate-limiter.js                               (modify)
```

Admin:

```text
apps/admin/src/recipeApi.js                                           (modify)
apps/admin/src/recipeAuthoring/recipeUrlImport.js                     (new)
apps/admin/src/recipeAuthoring/RecipeAuthoringSteps.jsx               (modify)
apps/admin/src/recipeAuthoring/recipeAuthoring.css                    (modify)
```

Shared/config required by the audited dependency/runtime decision:

```text
apps/api/package.json                                                 (modify)
package-lock.json                                                     (modify)
```

No model, repository, serializer, environment file, shared contract, mobile
file, deployment file, or existing M27 parser/state/save file is allowlisted.
If implementation needs any other production file, stop and amend this audit
before editing it.

## 15. Exact test allowlist

Backend:

```text
apps/api/test/recipe-url-fetcher.test.js                              (new)
apps/api/test/recipe-jsonld-extractor.test.js                         (new)
apps/api/test/recipe-url-import-service.test.js                       (new)
apps/api/test/recipe-url-import-routes.test.js                        (new)
```

Admin:

```text
apps/admin/test/recipeUrlImport.test.js                               (new)
apps/admin/test/recipeIntakeIntegration.test.js                       (modify)
```

`recipeIntakeIntegration.test.js` was added to the exact test allowlist during
findings-fix review. The change replaces broad serialized-string absence checks
with direct assertions that the replacement source remains preview-only and
that conflict reload adopts authoritative server fields. It does not change
M27 production behavior. Other existing tests below remain regression commands
only and are not allowlisted for modification.

## 16. Required automated coverage

### 16.1 Security and transport

Use dependency injection for resolver/request primitives; never contact the
public internet in tests. Tests must exercise the real URL parser, real
`ipaddr.js` classification, real redirect orchestration, byte counters, and
custom lookup construction rather than stubbing the final allow/deny result.
A fake request primitive may capture options and invoke the supplied custom
lookup to prove that it returns only the frozen address and performs no second
DNS resolution.

Cover at least:

- malformed/relative URL, HTTP and other schemes, credentials, non-443 port,
  fragments, IP literals, localhost and internal suffixes;
- IPv4 loopback/private/link-local/CGNAT/reserved/documentation/multicast and
  metadata addresses;
- IPv6 loopback/unspecified/link-local/unique-local/reserved/multicast,
  IPv4-mapped IPv6, and public IPv4/IPv6 controls;
- DNS failure, empty answers, all-public answers, mixed public/private answers,
  chosen-address pinning, TLS hostname/SNI preservation, remote-address
  equality check, and no proxy/agent reuse;
- redirect-to-private/internal/HTTP/credentials/non-default-port, relative
  redirects, per-hop re-resolution, and the exact redirect ceiling;
- connection and total timeout, stalled response, Content-Length precheck,
  streaming overflow without Content-Length, exact size boundary, and early
  stream destruction;
- allowed/rejected content types, charsets, malformed UTF-8, rejected
  compression, exact outbound headers, and absence of Authorization/Cookie;
- authorization required, current Moderator capability accepted, User/Admin
  rejected before transport, per-IP/per-user rate behavior, and global
  single-flight rejection/release after success and failure;
- no Recipe/Ingredient/Substitution/upload repository or mutation call.

### 16.2 Extraction

Cover one Recipe object, string/array `@type`, top-level arrays, `@graph`,
multiple script tags, unrelated Schema.org objects, empty scripts, no Recipe,
multiple Recipes within/across scripts, malformed JSON-LD, a malformed block
beside a valid block, aggregate JSON-LD boundary, serialized-candidate boundary,
and HTML that contains scripts/styles/images without executing or requesting
them.

### 16.3 Admin integration

Cover URL submission through the authenticated `recipeApi` client; loading,
success, API error, and retry UI; source URL display only; returned candidate
serialization into the existing M27 parser; existing mapped/invalid/
unsupported/unresolved preview; blank-only Apply; ingredient strings remaining
unresolved; and zero create/PATCH/publish/upload calls until the Moderator uses
the existing explicit authoring controls. Prove Admin has no rendered authoring
entry point and the backend remains the final authorization gate.

## 17. Exact test commands

Focused new backend tests:

```text
node --test --test-isolation=none apps/api/test/recipe-url-fetcher.test.js apps/api/test/recipe-jsonld-extractor.test.js apps/api/test/recipe-url-import-service.test.js apps/api/test/recipe-url-import-routes.test.js
```

Focused Admin test plus the complete M27 parser/integration regression:

```text
node --test --test-isolation=none apps/admin/test/recipeUrlImport.test.js apps/admin/test/recipeIntake.test.js apps/admin/test/recipeIntakeIntegration.test.js
```

Authorization, limiter, API error, and authoring regression:

```text
node --test --test-isolation=none apps/api/test/rate-limiter.test.js apps/api/test/catalog-authority-routes.test.js apps/api/test/recipe-routes.test.js apps/api/test/error-middleware.test.js
node --test --test-isolation=none apps/admin/test/portalPolicy.test.js apps/admin/test/recipeAuthoringApiContract.test.js apps/admin/test/recipeAuthoringModel.test.js apps/admin/test/recipeAuthoringState.test.js apps/admin/test/recipeAuthoringAcknowledgement.test.js apps/admin/test/recipeCatalogFreshness.test.js
```

Build and final checks:

```text
npm run build --workspace=apps/admin
git diff --check
git diff --stat
git status --short --branch
```

## 18. Future runtime verification plan

Do not claim runtime completion from mocked tests. After implementation, in a
controlled environment with request logs/devtools and known test pages:

1. Sign in as a Moderator, open Add Recipe, paste a known safe public HTTPS
   Recipe URL, and confirm one server import request succeeds.
2. Confirm the returned candidate enters the existing M27 preview with mapped,
   invalid, unsupported, and unresolved sections as appropriate.
3. Apply and confirm only blank allowlisted fields change locally; no Recipe
   POST/PATCH/publish/upload occurs.
4. Confirm imported ingredient strings remain guidance and canonical IDs still
   come only from the existing picker.
5. Use explicit Save Draft and verify the existing create/PATCH lifecycle is
   still required; use explicit Publish and confirm its validation and
   acknowledgement are unchanged.
6. Verify localhost, private IPv4, IPv6 loopback, metadata-style, credentials,
   HTTP, and non-default-port URLs fail without an outbound connection.
7. Verify a controlled public redirect to a blocked private target is rejected
   before the redirected connection, where the environment can test this
   safely.
8. Verify oversized, compressed, binary/non-HTML, malformed UTF-8, invalid
   JSON-LD, no-Recipe, multiple-Recipe, timeout, and excessive-redirect pages
   fail with the frozen safe messages.
9. Confirm User and Admin receive no import/write UI; direct Admin endpoint use
   returns 403 and makes no outbound request.
10. Confirm rate-limit and busy responses recover, browser console is clean,
    focus/keyboard behavior remains usable, and the displayed source URL never
    enters Draft/PATCH/Publish payloads.
11. Review server logs to confirm no query strings, JSON-LD/body content,
    credentials, cookies, tokens, or raw internal socket errors were logged.

No runtime verification was performed during this read-only application audit.

## 19. Blockers, stop conditions, and deferred work

There is no present implementation blocker. Stop implementation and amend this
audit if:

- the deployed Node/runtime cannot supply the pinned custom lookup and
  post-connect address verification exactly as frozen;
- an HTTP client/browser/proxy layer would resolve or redirect outside the
  audited code path;
- safe implementation needs another production/test file outside the exact
  allowlists;
- raw candidate return cannot feed M27 without duplicating or changing its
  mapping authority;
- schema/migration/storage, unrelated auth redesign, or uncontrolled browser
  execution becomes necessary;
- dependency review rejects either required package or materially changes the
  package/runtime scope;
- deployment changes from the documented single process without shared abuse
  controls.

Deferred:

- source URL persistence and provenance history;
- caching, queued/background imports, batch imports, and a durable import model;
- AI/LLM or arbitrary plain-text extraction;
- JavaScript-rendered/headless-browser scraping and challenge bypass;
- HTTP URLs, non-default ports, compressed response support, non-UTF-8 pages,
  public IP-literal URLs, and authenticated/cookie-gated sources;
- external image download, nutrition services, canonical Ingredient
  auto-matching/creation, controlled-classification inference, Recipe
  auto-save/publish, Substitution automation, community submissions, generic
  review queues, mobile work, and analytics;
- multi-instance shared rate/concurrency storage and infrastructure egress
  firewalling. An egress firewall denying private/link-local/metadata networks
  is recommended defense in depth, but application-layer connection pinning is
  sufficient for this single-instance v1 audit verdict.

## 20. Evidence summary

- Audit-time focused Admin regressions passed: 24 tests, 0 failed
  (`recipeIntake`, `recipeIntakeIntegration`, `portalPolicy`, and
  `recipeAuthoringApiContract`).
- Audit-time focused API regressions passed: 64 tests, 0 failed
  (`rate-limiter`, `catalog-authority-routes`, `recipe-routes`, and
  `error-middleware`). Expected 4xx-path `AppError` diagnostics were printed by
  the test environment; the command exited successfully.
- `recipeIntake.js` fixes the M27 input ceiling at 256 KiB, selects one direct,
  array, or `@graph` Recipe, maps only the approved fields, and retains imported
  ingredients as unresolved strings.
- `RecipeAuthoringSteps.jsx` mounts M27 intake only for a new unsaved Recipe and
  exposes explicit Preview and Apply actions.
- `recipeIntakeIntegration.test.js` proves Preview/Apply are local-only and the
  explicit Draft/PATCH lifecycle preserves working form state.
- `capabilities.js` gives `catalog.write` only to Moderator; `portalPolicy.js`
  and `RecipesTab.jsx` keep Admin read-only.
- `authenticate.middleware.js` refreshes role/session authority from MongoDB;
  `require-capability.middleware.js` enforces server-side capability checks.
- `rate-limiter.js` supplies standard error behavior, per-user keys, established
  15-minute budgets, and documents the current single Render instance.
- `app.js` supplies the global 300/15-minute IP limiter and 1 MiB JSON body
  ceiling.
- `email.service.js` establishes a five-second API outbound timeout and the
  existing `wecooked-api/1.0` User-Agent convention.
- `public-https-url.js` explicitly states that it does no DNS or fetching; it
  cannot be promoted into an SSRF guard.
- The API has no direct outbound HTTP, HTML parsing, or IP-classification
  dependency suitable for this feature. The current local runtime is Node
  24.12.0, while installed Mongoose already declares Node `>=20.19.0`.

## 21. Final implementation evidence

The implementation follows the audited request path and boundaries:

- `POST /api/v1/recipes/import-url` runs authentication, current
  `catalog.write` capability enforcement, dedicated per-IP and per-user rate
  limiters, strict body validation, and the import controller.
- The fetcher validates every initial and redirect URL, resolves and classifies
  every address, pins one validated address into a fresh HTTPS connection,
  verifies the connected peer, bounds redirects/time/headers/body, and accepts
  only inert UTF-8 HTML.
- The extractor uses `parse5`, enforces aggregate and returned-candidate limits,
  fails closed on malformed JSON-LD, and returns exactly one raw Recipe object.
- The import service is non-persistent and single-flight. Route tests prove no
  Recipe, Ingredient, Substitution, or upload mutation boundary is invoked.
- The Staff Portal uses the shared authenticated API client, serializes the raw
  candidate into the existing M27 parser, shows loading/error/retry/source
  states, and leaves Preview/Apply local-only. Existing explicit Draft, PATCH,
  upload, and publish controls remain authoritative.
- `ipaddr.js@2.5.0` and `parse5@8.0.1` are pinned as direct API runtime
  dependencies, with Node `>=20.19.0` recorded in the API manifest and lockfile.

The complete URL1 repository-finalization set is the 13 production/config
files from section 14, the six test files from section 15, and this milestone
document. No model, repository, schema, migration, environment, mobile,
deployment, or protected documentation file is included.

## 22. Independent review and findings-fix evidence

The independent read-only review inspected the actual tracked and untracked
implementation, the full diff, authorization ordering, SSRF and redirect
controls, mutation boundaries, M27 parser authority, UI reachability, test
coverage, dependency changes, and exact file scope.

One narrow test-quality finding was resolved: the existing M27 source-change
regression used broad serialized-string absence checks. The assertion was made
field-specific so it now proves both sides of the contract: Source B remains
available only in preview, while conflict reload replaces the working form with
server-authoritative fields. Section 15 records the required allowlist
amendment. No production behavior was changed by this fix.

Final review of the findings-fix and complete diff found no remaining BLOCKER,
MAJOR, MEDIUM, or MINOR finding. Frozen authorization, SSRF, non-persistence,
candidate-size, parser-authority, blank-only Apply, and explicit-save
invariants remain intact.

## 23. Final automated verification

Finalization verification on 2026-09-28 produced:

```text
Focused URL1 API:                         24 passed, 0 failed
Focused URL1 + M27 Admin:                25 passed, 0 failed
API authorization/limiter/error regressions: 64 passed, 0 failed
Admin authoring/policy regressions:      36 passed, 0 failed
Admin production build:                 PASS
git diff --check:                        PASS
```

Expected controlled 4xx-path `AppError` diagnostics appeared in API test
output. The first sandboxed Vite-dependent Admin test/build attempts hit the
Windows `spawn EPERM` environment boundary; the identical commands passed when
rerun outside that sandbox. The successful build emitted non-blocking existing
chunk-size and dynamic-import warnings.

## 24. Runtime evidence

Runtime verification was completed before repository finalization. The supplied
runtime result is:

```text
RUNTIME PASS — READY FOR COMMIT/PUSH
```

This milestone records that runtime result without substituting automated test
coverage for the completed runtime exercise.

## 25. Finalization verdict

**IMPLEMENTATION PASS — RUNTIME PASS — READY FOR REPOSITORY FINALIZATION**

The exact URL1 file set may now be staged by path, verified, committed on its
feature branch, and pushed with upstream tracking. It must not be merged to
`main` as part of this finalization step.
