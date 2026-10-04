import { api, setAuthAdapter } from '../src/api/client';

const originalFetch = global.fetch;
const OriginalFormData = global.FormData;
class TestFormData { constructor() { this.parts = []; } append(...args) { this.parts.push(args); } }
const response = (status, data) => ({ ok: status >= 200 && status < 300, status, json: async () => ({ success: true, data }) });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const jwt = (sub, sessionId, nonce) => {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode({ sub, sessionId, nonce })}.signature`;
};

beforeEach(() => {
  global.FormData = TestFormData;
  setAuthAdapter({ getAccessToken: () => null, refreshAccessToken: async () => false });
});
afterEach(() => { global.fetch = originalFetch; global.FormData = OriginalFormData; });

it('keeps JSON encoding unchanged', async () => {
  global.fetch = jest.fn(async () => response(200, { ok: true }));
  await api.patch('/users/me', { body: { bio: 'hello' } });
  const options = global.fetch.mock.calls[0][1];
  expect(options.headers['Content-Type']).toBe('application/json');
  expect(options.body).toBe(JSON.stringify({ bio: 'hello' }));
});

it('sends FormData directly without a manual content type while retaining bearer auth', async () => {
  setAuthAdapter({ getAccessToken: () => 'access-token', refreshAccessToken: async () => false });
  global.fetch = jest.fn(async () => response(200, { ok: true }));
  const body = new TestFormData(); body.append('image', { uri: 'file://a.jpg' });
  await api.post('/users/me/avatar', { body });
  const options = global.fetch.mock.calls[0][1];
  expect(options.body).toBe(body);
  expect(options.headers['Content-Type']).toBeUndefined();
  expect(options.headers.Authorization).toBe('Bearer access-token');
});

it('bounds multipart refresh to one retry and rebuilds the body', async () => {
  const refreshAccessToken = jest.fn(async () => true);
  setAuthAdapter({ getAccessToken: () => 'token', refreshAccessToken });
  global.fetch = jest.fn()
    .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ success: false, error: { code: 'AUTH_TOKEN_INVALID' } }) })
    .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ success: false, error: { code: 'AUTH_TOKEN_INVALID' } }) });
  const bodies = [];
  const bodyFactory = jest.fn(() => {
    const body = new TestFormData();
    body.append('image', { bytes: jest.fn() });
    bodies.push(body);
    return body;
  });
  await expect(api.post('/users/me/avatar', { bodyFactory })).rejects.toMatchObject({ status: 401 });
  expect(refreshAccessToken).toHaveBeenCalledTimes(1);
  expect(global.fetch).toHaveBeenCalledTimes(2);
  expect(bodyFactory).toHaveBeenCalledTimes(2);
  expect(global.fetch.mock.calls[0][1].body).toBe(bodies[0]);
  expect(global.fetch.mock.calls[1][1].body).toBe(bodies[1]);
  expect(bodies[1]).not.toBe(bodies[0]);
  expect(bodies).toHaveLength(2);
  expect(bodies[0].parts).toHaveLength(1);
  expect(bodies[1].parts).toHaveLength(1);
  expect(bodies[0].parts[0][0]).toBe('image');
  expect(bodies[1].parts[0][0]).toBe('image');
  expect(global.fetch.mock.calls[0][1].headers['Content-Type']).toBeUndefined();
  expect(global.fetch.mock.calls[1][1].headers['Content-Type']).toBeUndefined();
});

it('does not classify the known local multipart incompatibility as a network failure', async () => {
  global.fetch = jest.fn(async () => { throw new Error('Unsupported FormDataPart implementation'); });
  await expect(api.post('/users/me/avatar', { body: new TestFormData() })).rejects.toMatchObject({
    code: 'MULTIPART_BODY_UNSUPPORTED', kind: 'local', status: 0,
  });
});

it('retries a normal same-session 401 with the refreshed access token', async () => {
  let token = jwt('account-a', 'session-a', 'old');
  const refreshAccessToken = jest.fn(async () => {
    token = jwt('account-a', 'session-a', 'new');
    return true;
  });
  setAuthAdapter({ getAccessToken: () => token, refreshAccessToken });
  global.fetch = jest.fn()
    .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ success: false, error: { code: 'AUTH_TOKEN_INVALID' } }) })
    .mockResolvedValueOnce(response(200, { updated: true }));

  await expect(api.patch('/users/me', { body: { bio: 'same session' } })).resolves.toEqual({ updated: true });

  expect(refreshAccessToken).toHaveBeenCalledTimes(1);
  expect(global.fetch).toHaveBeenCalledTimes(2);
  expect(global.fetch.mock.calls[1][1].headers.Authorization).toBe(`Bearer ${token}`);
});

it('never replays an old mutation after refresh yields to a different account session', async () => {
  let token = jwt('account-a', 'session-a', 'old');
  const refreshGate = deferred();
  const refreshStarted = deferred();
  const refreshAccessToken = jest.fn(() => {
    refreshStarted.resolve();
    return refreshGate.promise;
  });
  setAuthAdapter({ getAccessToken: () => token, refreshAccessToken });
  global.fetch = jest.fn()
    .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ success: false, error: { code: 'AUTH_TOKEN_INVALID' } }) })
    .mockResolvedValueOnce(response(200, { shouldNotRun: true }));

  const oldMutation = api.patch('/users/me', { body: { bio: 'belongs to A' } });
  await refreshStarted.promise;
  expect(refreshAccessToken).toHaveBeenCalledTimes(1);

  token = jwt('account-b', 'session-b', 'new');
  refreshGate.resolve(true);

  await expect(oldMutation).rejects.toMatchObject({ status: 401, code: 'AUTH_SESSION_CHANGED' });
  expect(global.fetch).toHaveBeenCalledTimes(1);
});
