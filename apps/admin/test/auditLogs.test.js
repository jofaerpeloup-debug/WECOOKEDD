import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const auditCss = fs.readFileSync(path.join(adminRoot, 'src/styles/audit-logs.css'), 'utf8');
const server = await createServer({
  root: adminRoot,
  logLevel: 'silent',
  server: { middlewareMode: true },
  appType: 'custom',
  ssr: { external: ['@wecooked/contracts'] },
});

let AdminNavigation;
let ModeratorWorkspace;
let AuditLogsView;
let EMPTY_AUDIT_FILTERS;
let validateAuditFilters;
let nextAuditPage;
let localDateTimeToIso;
let createAuditLogsState;
let auditLogsStateTransition;
let isAuditAuthorityLoss;
let applyAuditFiltersState;
let resetAuditFiltersState;
let api;
let ApiError;
let buildAuditLogQuery;
let listAuditLogs;
let validateAuditLogResponse;

try {
  ({ AdminNavigation, ModeratorWorkspace } = await server.ssrLoadModule('/src/App.jsx'));
  ({
    AuditLogsView,
    EMPTY_AUDIT_FILTERS,
    validateAuditFilters,
    nextAuditPage,
    localDateTimeToIso,
    createAuditLogsState,
    auditLogsStateTransition,
    isAuditAuthorityLoss,
    applyAuditFiltersState,
    resetAuditFiltersState,
  } = await server.ssrLoadModule('/src/AuditLogsTab.jsx'));
  ({ api, ApiError } = await server.ssrLoadModule('/src/apiClient.js'));
  ({
    buildAuditLogQuery,
    listAuditLogs,
    validateAuditLogResponse,
  } = await server.ssrLoadModule('/src/auditLogApi.js'));
} catch (error) {
  await server.close();
  throw error;
}

test.after(async () => {
  await server.close();
});

const noop = () => {};
const baseViewProps = {
  draft: { ...EMPTY_AUDIT_FILTERS },
  filterError: '',
  onDraftChange: noop,
  onApplyFilters: noop,
  onResetFilters: noop,
  items: [],
  pagination: null,
  loading: false,
  error: null,
  onRetry: noop,
  onPageChange: noop,
};

function renderView(overrides = {}) {
  return renderToStaticMarkup(React.createElement(AuditLogsView, {
    ...baseViewProps,
    ...overrides,
  }));
}

const validRecord = Object.freeze({
  id: '507f1f77bcf86cd799439499',
  createdAt: '2026-09-24T01:02:03.000Z',
  eventType: 'admin.user.status_changed',
  actorUserId: '507f1f77bcf86cd799439401',
  actorRole: 'admin',
  targetType: 'user',
  targetId: '507f1f77bcf86cd799439402',
  outcome: 'success',
  reasonCode: null,
  metadata: Object.freeze({ fromStatus: 'active', toStatus: 'suspended' }),
});

function auditResponse(overrides = {}) {
  return {
    auditLogs: [validRecord],
    pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    ...overrides,
  };
}

test('Admin navigation exposes Audit Logs while Moderator navigation excludes it', () => {
  const adminMarkup = renderToStaticMarkup(React.createElement(AdminNavigation, {
    tab: 'audit-logs',
    setTab: noop,
  }));
  assert.match(adminMarkup, /Audit Logs/);
  assert.match(adminMarkup, /aria-current="page"/);

  const moderatorMarkup = renderToStaticMarkup(React.createElement(ModeratorWorkspace, {
    tab: 'moderator-home',
    setTab: noop,
    identity: { name: 'Moderator', email: 'moderator@example.test' },
    catalogPolicy: { canWriteCatalog: true, canUploadRecipeImage: true },
    onSignOut: noop,
    onAuthorityLost: noop,
  }));
  assert.doesNotMatch(moderatorMarkup, /Audit Logs/);
});

test('audit API uses the shared authenticated client and only approved query keys', async () => {
  const calls = [];
  const originalGet = api.get;
  api.get = async (...args) => {
    calls.push(args);
    return auditResponse({
      pagination: { page: 2, limit: 20, total: 25, totalPages: 2 },
    });
  };

  try {
    const result = await listAuditLogs({
      eventType: 'admin.user.status_changed',
      actorUserId: '507f1f77bcf86cd799439401',
      targetType: 'user',
      targetId: '507f1f77bcf86cd799439402',
      outcome: 'success',
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-09-24T00:00:00.000Z',
      page: 2,
      limit: 20,
      search: 'unsupported',
      actorRole: 'admin',
    });

    assert.deepEqual(result, {
      auditLogs: [validRecord],
      pagination: { page: 2, limit: 20, total: 25, totalPages: 2 },
    });
    assert.deepEqual(calls, [[
      '/admin/audit-logs',
      {
        query: {
          eventType: 'admin.user.status_changed',
          actorUserId: '507f1f77bcf86cd799439401',
          targetType: 'user',
          targetId: '507f1f77bcf86cd799439402',
          outcome: 'success',
          from: '2026-09-01T00:00:00.000Z',
          to: '2026-09-24T00:00:00.000Z',
          page: 2,
          limit: 20,
        },
      },
    ]]);
  } finally {
    api.get = originalGet;
  }
});

test('audit response validation accepts complete records and legitimate empty results', () => {
  const populated = auditResponse();
  assert.equal(validateAuditLogResponse(populated), populated);

  const empty = {
    auditLogs: [],
    pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
  };
  assert.equal(validateAuditLogResponse(empty), empty);
  assert.equal(validateAuditLogResponse(populated).auditLogs[0].reasonCode, null);
});

test('audit response validation rejects missing, null, and non-array auditLogs', () => {
  for (const malformed of [
    { pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } },
    auditResponse({ auditLogs: null }),
    auditResponse({ auditLogs: {} }),
  ]) {
    assert.throws(() => validateAuditLogResponse(malformed), /Invalid audit log response/);
  }
});

test('audit response validation rejects malformed authoritative pagination', () => {
  for (const pagination of [
    null,
    { page: 0, limit: 20, total: 1, totalPages: 1 },
    { page: 1, limit: 0, total: 1, totalPages: 1 },
    { page: 1, limit: 101, total: 1, totalPages: 1 },
    { page: 1, limit: 20, total: -1, totalPages: 0 },
    { page: 1, limit: 20, total: 21, totalPages: 1 },
    { page: 1, limit: 20, total: 0, totalPages: 0 },
  ]) {
    assert.throws(
      () => validateAuditLogResponse(auditResponse({ pagination })),
      /Invalid audit log response/,
    );
  }
});

test('audit response validation rejects malformed individual records', () => {
  for (const record of [
    { ...validRecord, actorUserId: null },
    { ...validRecord, createdAt: 'not-a-timestamp' },
    { ...validRecord, eventType: 'admin.user.deleted' },
    { ...validRecord, reasonCode: '' },
    { ...validRecord, metadata: {} },
  ]) {
    assert.throws(
      () => validateAuditLogResponse(auditResponse({ auditLogs: [record] })),
      /Invalid audit log response/,
    );
  }
});

test('query construction omits empty and invalid pagination values', () => {
  assert.deepEqual(buildAuditLogQuery({ page: 0, limit: 'bad', eventType: '' }), {
    eventType: undefined,
    actorUserId: undefined,
    targetType: undefined,
    targetId: undefined,
    outcome: undefined,
    from: undefined,
    to: undefined,
    page: undefined,
    limit: undefined,
  });
});

test('filter validation checks identifiers and date ranges before requesting', () => {
  assert.match(validateAuditFilters({
    ...EMPTY_AUDIT_FILTERS,
    actorUserId: 'not-an-object-id',
  }).error, /Actor ID/);
  assert.match(validateAuditFilters({
    ...EMPTY_AUDIT_FILTERS,
    targetId: 'not-an-object-id',
  }).error, /Target ID/);
  assert.match(validateAuditFilters({
    ...EMPTY_AUDIT_FILTERS,
    from: '2026-09-24T12:00',
    to: '2026-09-23T12:00',
  }).error, /end date/);

  const valid = validateAuditFilters({
    ...EMPTY_AUDIT_FILTERS,
    eventType: 'admin.staff.moderator_approved',
    actorUserId: '507f1f77bcf86cd799439401',
    from: '2026-09-01T08:30',
  });
  assert.equal(valid.error, '');
  assert.equal(valid.filters.eventType, 'admin.staff.moderator_approved');
  assert.equal(valid.filters.actorUserId, '507f1f77bcf86cd799439401');
  assert.equal(valid.filters.from, new Date('2026-09-01T08:30').toISOString());
});

test('local datetime conversion rejects normalized calendar dates and preserves valid local time', () => {
  assert.equal(localDateTimeToIso('2026-09-24T08:30'), new Date(2026, 8, 24, 8, 30).toISOString());
  assert.equal(localDateTimeToIso('2024-02-29T12:34'), new Date(2024, 1, 29, 12, 34).toISOString());
  for (const invalid of [
    '2025-02-29T12:34',
    '2026-02-31T12:34',
    '2026-04-31T12:34',
    '2026-13-01T12:34',
    '2026-01-01T24:00',
  ]) {
    assert.equal(localDateTimeToIso(invalid), null, `expected ${invalid} rejected`);
  }
});

test('filter state transitions reset submitted and cleared filters to page one', () => {
  const applied = applyAuditFiltersState({
    ...EMPTY_AUDIT_FILTERS,
    outcome: 'success',
  });
  assert.equal(applied.filterError, '');
  assert.equal(applied.page, 1);
  assert.deepEqual(applied.filters, {
    eventType: undefined,
    actorUserId: undefined,
    targetType: undefined,
    targetId: undefined,
    outcome: 'success',
    from: undefined,
    to: undefined,
  });

  const reset = resetAuditFiltersState();
  assert.equal(reset.page, 1);
  assert.deepEqual(reset.filters, {});
  assert.deepEqual(reset.draft, EMPTY_AUDIT_FILTERS);
});

test('request transitions clear replacement data and ignore stale responses', () => {
  let state = {
    ...createAuditLogsState(),
    generation: 1,
    items: [validRecord],
    pagination: auditResponse().pagination,
    loading: false,
  };
  state = auditLogsStateTransition(state, { type: 'request-started', generation: 2 });
  assert.deepEqual(state.items, []);
  assert.equal(state.pagination, null);
  assert.equal(state.loading, true);

  const afterStale = auditLogsStateTransition(state, {
    type: 'request-succeeded',
    generation: 1,
    response: auditResponse(),
  });
  assert.equal(afterStale, state);

  const newest = auditResponse({
    auditLogs: [{ ...validRecord, id: '507f1f77bcf86cd799439498' }],
  });
  state = auditLogsStateTransition(state, {
    type: 'request-succeeded',
    generation: 2,
    response: newest,
  });
  assert.equal(state.items[0].id, '507f1f77bcf86cd799439498');
});

test('401 and 403 failures clear records and signal existing authority refresh behavior', () => {
  for (const status of [401, 403]) {
    const loaded = {
      ...createAuditLogsState(),
      generation: 1,
      items: [validRecord],
      pagination: auditResponse().pagination,
      loading: false,
    };
    const error = new ApiError('safe', { status });
    const failed = auditLogsStateTransition(loaded, {
      type: 'request-failed',
      generation: 1,
      error,
    });
    assert.deepEqual(failed.items, []);
    assert.equal(failed.pagination, null);
    assert.equal(failed.error.kind, status === 401 ? 'unauthorized' : 'forbidden');
    assert.equal(isAuditAuthorityLoss(error), true);
  }
});

test('malformed successful responses produce unavailable state, never an empty-history state', () => {
  let malformedError;
  try {
    validateAuditLogResponse(auditResponse({ auditLogs: null }));
  } catch (error) {
    malformedError = error;
  }
  const loading = auditLogsStateTransition(createAuditLogsState(), {
    type: 'request-started',
    generation: 1,
  });
  const failed = auditLogsStateTransition(loading, {
    type: 'request-failed',
    generation: 1,
    error: malformedError,
  });
  const markup = renderView(failed);
  assert.match(markup, /Audit Logs unavailable/);
  assert.doesNotMatch(markup, /No audit records found/);
});

test('pagination accepts only real server-bounded page moves', () => {
  assert.equal(nextAuditPage(2, 3, 4), 3);
  assert.equal(nextAuditPage(2, 99, 4), 4);
  assert.equal(nextAuditPage(2, 0, 4), 2);
  assert.equal(nextAuditPage(2, 3, 0), 2);

  const markup = renderView({
    items: [{
      id: 'log-1',
      createdAt: '2026-09-24T01:02:03.000Z',
      eventType: 'admin.user.status_changed',
      actorUserId: '507f1f77bcf86cd799439401',
      actorRole: 'admin',
      targetType: 'user',
      targetId: '507f1f77bcf86cd799439402',
      outcome: 'success',
      reasonCode: null,
    }],
    pagination: { page: 1, limit: 20, total: 21, totalPages: 2 },
  });
  assert.match(markup, /Page 1 of 2/);
  assert.match(markup, /21 total records/);
  assert.match(markup, /disabled=""[^>]*>.*Previous/s);
  assert.doesNotMatch(markup, /disabled=""[^>]*>Next/);
});

test('loading, empty, error, and access-denied states remain distinct', () => {
  const loading = renderView({ loading: true });
  assert.match(loading, /Loading audit records/);
  assert.match(loading, /type="submit"[^>]*disabled=""/);
  assert.match(renderView(), /No audit records found/);
  assert.match(renderView({
    error: { kind: 'error', message: 'Audit Logs could not be loaded. Please try again.' },
  }), /Try again/);
  const forbidden = renderView({
    error: { kind: 'forbidden', message: 'Your account does not have permission to view Audit Logs.' },
  });
  assert.match(forbidden, /Access denied/);
  assert.doesNotMatch(forbidden, /Try again/);
});

test('record rendering uses approved fields and never renders raw metadata', () => {
  const record = {
    id: '507f1f77bcf86cd799439499',
    createdAt: '2026-09-24T01:02:03.000Z',
    eventType: 'admin.user.status_changed',
    actorUserId: '507f1f77bcf86cd799439401',
    actorRole: 'admin',
    targetType: 'user',
    targetId: '507f1f77bcf86cd799439402',
    outcome: 'partial_failure',
    reasonCode: 'SESSION_REVOCATION_FAILED',
    metadata: {
      fromStatus: 'active',
      toStatus: 'suspended',
      password: 'never-render-this-password',
      token: 'never-render-this-token',
      requestBody: 'never-render-this-body',
    },
  };
  const markup = renderView({
    items: [record],
    pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
  });

  for (const expected of [
    'User status changed',
    record.eventType,
    record.actorUserId,
    record.targetId,
    'Partial Failure',
    'SESSION REVOCATION FAILED',
  ]) {
    assert.match(markup, new RegExp(expected.replaceAll('.', '\\.')));
  }
  for (const forbidden of [
    'never-render-this-password',
    'never-render-this-token',
    'never-render-this-body',
    'fromStatus',
    'toStatus',
    'sample@example.com',
    'Sample Admin',
  ]) {
    assert.doesNotMatch(markup, new RegExp(forbidden));
  }
});

test('audit log styling is scoped, responsive, dark-mode compatible, and token based', () => {
  assert.match(auditCss, /^\.wc-admin \.wc-audit/m);
  assert.match(auditCss, /@media \(max-width: 980px\)/);
  assert.match(auditCss, /@media \(max-width: 800px\)/);
  assert.match(auditCss, /@media \(max-width: 520px\)/);
  assert.match(auditCss, /var\(--surface\)/);
  assert.match(auditCss, /var\(--text-primary\)/);
  assert.doesNotMatch(auditCss, /#[0-9a-f]{3,8}/i);
  assert.doesNotMatch(auditCss, /^button\s*\{/m);
});
