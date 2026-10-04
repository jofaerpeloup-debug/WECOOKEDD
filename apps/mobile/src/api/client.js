// Shared authenticated WeCooked REST client for the mobile app.
//
// This is the ONLY place the app calls `fetch` for API data. It knows the base
// URL, the `{ success, data } / { success, error }` envelope, how the access
// token is attached, how backend errors are normalized, and how a single
// transparent refresh+retry works. Feature/auth services go through this;
// screens and contexts never call `fetch` directly.

import { API_BASE_URL } from './config';

/**
 * A failed API call. `kind` separates a transport failure ("network" — the
 * request never produced a well-formed HTTP response) from a structured
 * backend rejection ("api" — the server answered with the WeCooked error
 * envelope). `message` is always a safe string (the backend's own
 * `error.message` or one of ours), never a raw internal error or stack.
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
  get isRateLimited() {
    return this.status === 429;
  }
  get isValidationError() {
    return this.status === 400 && this.details.length > 0;
  }
}

// Registered by authService.js so this module never needs to know how tokens
// are stored or refreshed. Safe no-op defaults for unauthenticated calls.
let authAdapter = {
  getAccessToken: () => null,
  refreshAccessToken: async () => false,
};

export function setAuthAdapter(adapter) {
  authAdapter = { ...authAdapter, ...adapter };
}

function sessionBinding(token) {
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3 || typeof globalThis.atob !== 'function') throw new Error('opaque token');
    const encoded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(globalThis.atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')));
    if (payload?.sub && payload?.sessionId) return `${payload.sub}:${payload.sessionId}`;
  } catch {
    // Tests and development adapters may use opaque access tokens. Binding to
    // the whole value still fails closed if another session replaces it.
  }
  return `opaque:${token}`;
}

function staleSessionError() {
  return new ApiError('The authenticated session changed while the request was in progress.', {
    code: 'AUTH_SESSION_CHANGED',
    status: 401,
  });
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

/**
 * @param {string} path         path under /api/v1, e.g. "/auth/login"
 * @param {object} [opts]
 * @param {string} [opts.method="GET"]
 * @param {object} [opts.body]   JSON body (omit for none)
 * @param {Function} [opts.bodyFactory] builds a fresh request body for each attempt
 * @param {object} [opts.query]  querystring params
 * @param {boolean} [opts.auth=true]  attach the bearer token + allow refresh+retry
 */
async function request(path, {
  method = 'GET', body, bodyFactory, query, auth = true, _retried = false, _sessionBinding,
} = {}) {
  const requestBody = bodyFactory ? bodyFactory() : body;
  const headers = { Accept: 'application/json' };
  const isMultipart = typeof FormData !== 'undefined' && requestBody instanceof FormData;
  if (requestBody !== undefined && !isMultipart) headers['Content-Type'] = 'application/json';
  let requestToken = null;
  let initiatingSession = _sessionBinding;
  if (auth) {
    requestToken = authAdapter.getAccessToken();
    if (initiatingSession === undefined) initiatingSession = sessionBinding(requestToken);
    if (requestToken) headers.Authorization = `Bearer ${requestToken}`;
  }

  let res;
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: requestBody === undefined ? undefined : (isMultipart ? requestBody : JSON.stringify(requestBody)),
    });
  } catch (error) {
    if (error?.message === 'Unsupported FormDataPart implementation') {
      throw new ApiError('The selected file could not be prepared for upload.', {
        kind: 'local',
        code: 'MULTIPART_BODY_UNSUPPORTED',
        status: 0,
      });
    }
    throw new ApiError('Unable to reach WeCooked. Check your connection and try again.', {
      kind: 'network',
      code: 'NETWORK_ERROR',
      status: 0,
    });
  }

  const payload = await parseBody(res);

  // A single transparent refresh+retry. The access token is short-lived
  // (~15m), so an otherwise-valid session would start 401-ing mid-use.
  // `_retried` bounds this to exactly one retry; the refresh call itself is
  // made with `auth: false` (see authService), so a 401 from /auth/refresh
  // can never recurse back into here. If refresh fails, fall through to the
  // normal error path below — never loop.
  if (res.status === 401 && auth && !_retried) {
    const currentToken = authAdapter.getAccessToken();
    if (sessionBinding(currentToken) !== initiatingSession) throw staleSessionError();

    // Another request may already have refreshed this same session while this
    // response was in flight. Use its token once without rotating again.
    if (currentToken !== requestToken) {
      return request(path, {
        method, body, bodyFactory, query, auth, _retried: true, _sessionBinding: initiatingSession,
      });
    }

    let refreshed = false;
    try {
      refreshed = await authAdapter.refreshAccessToken();
    } catch {
      refreshed = false;
    }
    if (refreshed) {
      if (sessionBinding(authAdapter.getAccessToken()) !== initiatingSession) throw staleSessionError();
      return request(path, {
        method, body, bodyFactory, query, auth, _retried: true, _sessionBinding: initiatingSession,
      });
    }
  }

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
