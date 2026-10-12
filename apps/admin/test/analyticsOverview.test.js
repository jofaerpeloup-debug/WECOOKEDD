import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({
  root: adminRoot, logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom',
});
const { default: AnalyticsOverview, loadAnalyticsOverview } =
  await server.ssrLoadModule('/src/AnalyticsOverview.jsx');
test.after(async () => { await server.close(); });

const END = '2026-10-12T04:00:00.000Z';
function data() {
  return {
    periodEndUtc: END,
    generatedAtUtc: '2026-10-12T04:00:01.000Z',
    timeZone: 'Asia/Manila',
    accounts: {
      total: 4, byRole: { user: 2, moderator: 1, admin: 1 },
      byStatus: { active: 3, suspended: 1 }, eligibleActive: 2,
    },
    communityPosts: { retainedTotal: 3 },
    periods: Object.fromEntries([7, 30, 90].map((days) => [`days${days}`, {
      fromUtc: '2026-10-01T16:00:00.000Z', toUtc: END,
      accountsRegistered: 1, postsCreated: 2,
    }])),
  };
}

function markup(state) {
  return renderToStaticMarkup(React.createElement(AnalyticsOverview, { state }));
}

test('renders fixed current-retained and Manila period counts with precise labels', async () => {
  const state = await loadAnalyticsOverview(async () => data());
  assert.equal(state.status, 'ready');
  const html = markup(state);
  for (const label of [
    'Current retained records', 'Accounts', 'Active-status accounts',
    'Eligible active accounts', 'Retained community posts',
    'Last 7 Manila calendar days', 'Last 30 Manila calendar days',
    'Last 90 Manila calendar days', 'Retained accounts registered',
    'Retained posts created',
  ]) assert.match(html, new RegExp(label));
  assert.doesNotMatch(html, /Active users|DAU|MAU|forecast|prediction/i);
});

test('zero is displayed only after a successful response', async () => {
  const empty = data();
  empty.accounts = {
    total: 0, byRole: { user: 0, moderator: 0, admin: 0 },
    byStatus: { active: 0, suspended: 0 }, eligibleActive: 0,
  };
  empty.communityPosts.retainedTotal = 0;
  for (const period of Object.values(empty.periods)) {
    period.accountsRegistered = 0;
    period.postsCreated = 0;
  }
  assert.match(markup(await loadAnalyticsOverview(async () => empty)), /<strong>0<\/strong>/);
  for (const status of ['loading', 'denied', 'unsupported', 'error']) {
    assert.doesNotMatch(markup({ status, data: null }), /<strong>0<\/strong>/);
  }
});

test('malformed payload and failures clear all numbers into distinct states', async () => {
  const malformed = data();
  malformed.accounts.byRole.user = '2';
  assert.deepEqual(await loadAnalyticsOverview(async () => malformed), { status: 'error', data: null });
  for (const [status, code, expected] of [
    [401, 'AUTH_SESSION_INVALID', 'denied'],
    [403, 'FORBIDDEN', 'denied'],
    [422, 'ANALYTICS_UNSUPPORTED', 'unsupported'],
    [500, 'INTERNAL_SERVER_ERROR', 'error'],
  ]) {
    const state = await loadAnalyticsOverview(async () => { throw { status, code }; });
    assert.deepEqual(state, { status: expected, data: null });
    assert.doesNotMatch(markup(state), /<strong>\d+<\/strong>/);
  }
});
