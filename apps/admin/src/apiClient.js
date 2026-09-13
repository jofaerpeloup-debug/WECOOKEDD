// Shared WeCooked REST API client for the admin app.
//
// One place that knows the API base URL, the request/response envelope, how
// the access token is attached, and how backend errors are normalized. Feature
// services (see ingredientApi.js) and the backend-auth layer (backendAuth.js)
// go through this — components never call `fetch` directly.

// The API URL is not a secret (see docs/architecture/admin-api-integration.md).
// It defaults to the standard local backend (apps/api listens on PORT 5000 and
// mounts everything under /api/v1); override with VITE_API_BASE_URL for other
// environments.
const DEFAULT_DEV_BASE_URL = 'http://localhost:5000/api/v1';

export const API_BASE_URL = String(
  import.meta.env.VITE_API_BASE_URL || DEFAULT_DEV_BASE_URL,
).replace(/\/+$/, '');

/**
 * A failed API call. `kind` separates a transport failure ("network" — the
 * request never got a well-formed HTTP response) from a structured backend
 * rejection ("api" — the server answered with the WeCooked error envelope).
 * `code`/`message`/`details` mirror the backend's stable error contract; the
 * message is always a backend-safe string (or one of ours), never a raw
 * internal error.
 */
export class ApiError extends Error {
  constructor(message, { code = 'UNKNOWN', status = 0, details = [], kind = 'api' } = {}) {
    super(message || 'Something went wrong.');
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = Array.isArray(details) ? details : [];
    this.kind = kind;
  }

  get isNetworkError() {
    return this.kind === 'network';
  }
  get isUnauthorized() {
    return this.status === 401;
  }
  get isForbidden() {
    return this.status === 403;
  }
  get isNotFound() {
    return this.status === 404;
  }
  get isConflict() {
    return this.status === 409;
  }
  get isValidationError() {
    return this.status === 400 && this.details.length > 0;
  }
}

// Registered by backendAuth.js so this module never needs to know how tokens
// are stored or refreshed. Defaults are safe no-ops for unauthenticated calls.
let authAdapter = {
  getAccessToken: () => null,
  refreshAccessToken: async () => false,
};

export function setAuthAdapter(adapter) {
  authAdapter = { ...authAdapter, ...adapter };
}

function buildUrl(path, query) {
  const url = `${API_BASE_URL}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.append(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

async function parseBody(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function request(path, { method = 'GET', body, query, auth = true, _retried = false } = {}) {
  const headers = {};
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  // Never set multipart Content-Type ourselves: the browser supplies its
  // generated boundary. Existing JSON calls keep their original behavior.
  if (body !== undefined && !isFormData) headers['Content-Type'] = 'application/json';
  if (auth) {
    const token = authAdapter.getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let res;
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: body !== undefined ? (isFormData ? body : JSON.stringify(body)) : undefined,
    });
  } catch {
    throw new ApiError(
      'Unable to reach the WeCooked API. Check your connection and that the server is running.',
      { kind: 'network', code: 'NETWORK_ERROR', status: 0 },
    );
  }

  const payload = await parseBody(res);

  // A single transparent refresh+retry: the access token is short-lived
  // (~15m), so an otherwise-valid session would otherwise start 401-ing
  // mid-use. `_retried` bounds this to exactly one retry; the refresh call
  // itself uses `auth: false`, so a 401 from /auth/refresh can never recurse
  // back into here. If the refresh fails, fall through to the normal error.
  if (res.status === 401 && auth && !_retried) {
    let refreshed = false;
    try {
      refreshed = await authAdapter.refreshAccessToken();
    } catch {
      refreshed = false;
    }
    if (refreshed) {
      return request(path, { method, body, query, auth, _retried: true });
    }
  }

  // 204 No Content is a valid success with a deliberately empty body — not a
  // malformed response. (No current endpoint returns it, but be explicit.)
  if (res.ok && res.status === 204) {
    return undefined;
  }

  if (!res.ok || !payload || payload.success === false) {
    const err = (payload && payload.error) || {};
    throw new ApiError(err.message || 'The request could not be completed.', {
      kind: 'api',
      status: res.status,
      code: err.code || `HTTP_${res.status}`,
      details: err.details || [],
    });
  }

  return payload.data;
}

export const api = {
  request,
  get: (path, opts) => request(path, { ...opts, method: 'GET' }),
  post: (path, opts) => request(path, { ...opts, method: 'POST' }),
  patch: (path, opts) => request(path, { ...opts, method: 'PATCH' }),
  del: (path, opts) => request(path, { ...opts, method: 'DELETE' }),
};
