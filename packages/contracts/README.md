# @wecooked/contracts

Reserved for safe, frontend-accessible values that legitimately need to be shared
across `apps/mobile`, `apps/admin`, and `apps/api` — API request/response contracts,
shared constants, enums, and validation schemas.

This package must never contain backend-only code: database models, secrets,
AI/LLM integration code, or server infrastructure.

Empty for now. No cross-application contract has been defined yet; this package
exists only so the workspace can reference it once one is needed.
