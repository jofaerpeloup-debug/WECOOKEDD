import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rechartsMock = {
  name: 'analytics-recharts-interaction-test',
  enforce: 'pre',
  resolveId(source) {
    return source === 'virtual:analytics-recharts-test' ? '\0analytics-recharts-test' : null;
  },
  load(id) {
    if (id !== '\0analytics-recharts-test') return null;
    return `
      import React from 'react';
      const chart = (kind) => ({ data, children }) => React.createElement('div', {
        'data-chart-kind': kind, 'data-points': JSON.stringify(data),
      }, children);
      const series = (kind) => ({ dataKey }) => React.createElement('span', {
        'data-series-kind': kind, 'data-series-key': dataKey,
      });
      export const ResponsiveContainer = ({ children }) => React.createElement('div', null, children);
      export const LineChart = chart('line');
      export const BarChart = chart('bar');
      export const PieChart = chart('pie');
      export const Line = series('line');
      export const Bar = series('bar');
      export const Pie = ({ data, dataKey, nameKey }) => React.createElement('span', {
        'data-series-kind': 'pie', 'data-points': JSON.stringify(data),
        'data-series-key': dataKey, 'data-name-key': nameKey,
      });
      export const CartesianGrid = () => null;
      export const Cell = () => null;
      export const Tooltip = () => null;
      export const XAxis = () => null;
      export const YAxis = ({ dataKey }) => React.createElement('span', {
        'data-axis-kind': 'y', 'data-axis-key': dataKey ?? '',
      });
    `;
  },
};
const server = await createServer({
  root: adminRoot, logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom',
  plugins: [rechartsMock],
  resolve: { alias: { recharts: 'virtual:analytics-recharts-test' } },
});
const { default: AnalyticsOverview, loadAnalyticsOverview, validOverview, selectedDailyBuckets } =
  await server.ssrLoadModule('/src/AnalyticsOverview.jsx');
test.after(async () => { await server.close(); });

const END = '2026-10-12T04:00:00.000Z';
function data() {
  const lastDate = new Date('2026-10-12T00:00:00.000Z');
  const buckets = Array.from({ length: 90 }, (_, index) => {
    const date = new Date(lastDate);
    date.setUTCDate(date.getUTCDate() - (89 - index));
    const next = new Date(date);
    next.setUTCDate(next.getUTCDate() + 1);
    return {
      localDate: date.toISOString().slice(0, 10),
      fromUtc: new Date(date.getTime() - 8 * 60 * 60 * 1000).toISOString(),
      toUtc: index === 89 ? END
        : new Date(next.getTime() - 8 * 60 * 60 * 1000).toISOString(),
      accountsRegistered: index === 5 || index === 88 ? 1 : 0,
      postsCreated: index === 70 || index === 88 ? 2 : 0,
    };
  });
  return {
    periodEndUtc: END,
    generatedAtUtc: '2026-10-12T04:00:01.000Z',
    timeZone: 'Asia/Manila',
    accounts: {
      total: 4, byRole: { user: 2, moderator: 1, admin: 1 },
      byStatus: { active: 3, suspended: 1 }, eligibleActive: 2,
    },
    communityPosts: { retainedTotal: 3 },
    periods: Object.fromEntries([7, 30, 90].map((days) => {
      const selected = buckets.slice(-days);
      return ['days' + days, {
        fromUtc: selected[0].fromUtc, toUtc: END,
        accountsRegistered: selected.reduce((total, bucket) => total + bucket.accountsRegistered, 0),
        postsCreated: selected.reduce((total, bucket) => total + bucket.postsCreated, 0),
      }];
    })),
    daily: { buckets },
  };
}

function markup(state) {
  return renderToStaticMarkup(React.createElement(AnalyticsOverview, { state }));
}

// Match the existing Admin component-test pattern: mount real React state in a
// small DOM, while the Recharts test double exposes the exact rendered props.
class TestNode {
  constructor(nodeType, nodeName, ownerDocument, nodeValue = '') {
    this.nodeType = nodeType;
    this.nodeName = nodeName;
    this.tagName = nodeType === 1 ? nodeName : undefined;
    this.ownerDocument = ownerDocument;
    this.nodeValue = nodeValue;
    this.parentNode = null;
    this.childNodes = [];
    this.attributes = new Map();
    this.style = { setProperty(name, value) { this[name] = value; } };
    this.listeners = new Map();
  }
  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
  get textContent() {
    return this.nodeType === 3 ? this.nodeValue
      : this.childNodes.map((child) => child.textContent).join('');
  }
  set textContent(value) {
    if (this.nodeType === 3) this.nodeValue = String(value);
    else {
      this.childNodes = [];
      if (value !== '') this.appendChild(this.ownerDocument.createTextNode(String(value)));
    }
  }
  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    this.childNodes.push(child);
    child.parentNode = this;
    return child;
  }
  insertBefore(child, before) {
    if (child.parentNode) child.parentNode.removeChild(child);
    const index = this.childNodes.indexOf(before);
    if (index === -1) throw new Error('insertBefore target is not a child');
    this.childNodes.splice(index, 0, child);
    child.parentNode = this;
    return child;
  }
  removeChild(child) {
    const index = this.childNodes.indexOf(child);
    if (index === -1) throw new Error('removeChild target is not a child');
    this.childNodes.splice(index, 1);
    child.parentNode = null;
    return child;
  }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  setAttribute(name, value) { this.attributes.set(String(name).toLowerCase(), String(value)); }
  removeAttribute(name) { this.attributes.delete(String(name).toLowerCase()); }
  getAttribute(name) { return this.attributes.get(String(name).toLowerCase()) ?? null; }
}

class TestDocument extends TestNode {
  constructor() {
    super(9, '#document', null);
    this.ownerDocument = this;
    this.activeElement = null;
    this.documentElement = this.createElement('html');
    this.body = this.createElement('body');
    this.documentElement.appendChild(this.body);
    this.appendChild(this.documentElement);
  }
  createElement(name) { return new TestNode(1, String(name).toUpperCase(), this); }
  createElementNS(_namespace, name) { return this.createElement(name); }
  createTextNode(value) { return new TestNode(3, '#text', this, String(value)); }
  createComment(value) { return new TestNode(8, '#comment', this, String(value)); }
}

function descendants(root, predicate) {
  const matches = [];
  for (const child of root.childNodes || []) {
    if (predicate(child)) matches.push(child);
    matches.push(...descendants(child, predicate));
  }
  return matches;
}

function first(root, predicate, description) {
  const node = descendants(root, predicate)[0];
  assert.ok(node, `Expected ${description}`);
  return node;
}

function reactProps(node) {
  const key = Object.keys(node).find((candidate) => candidate.startsWith('__reactProps$'));
  assert.ok(key, `Expected React props on ${node.nodeName}`);
  return node[key];
}

async function mountAnalytics(state) {
  const document = new TestDocument();
  const window = {
    document, Node: TestNode, HTMLElement: TestNode,
    HTMLIFrameElement: class extends TestNode {}, getComputedStyle: () => ({}),
  };
  document.defaultView = window;
  const names = ['document', 'window', 'Node', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(names.map((name) => [name, globalThis[name]]));
  Object.assign(globalThis, {
    document, window, Node: TestNode, HTMLElement: TestNode,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => { root.render(React.createElement(AnalyticsOverview, { state })); });
  } catch (error) {
    await act(async () => { root.unmount(); });
    container.parentNode?.removeChild(container);
    for (const [name, value] of previous) {
      if (value === undefined) delete globalThis[name];
      else globalThis[name] = value;
    }
    throw error;
  }
  return {
    container,
    async update(nextState) {
      await act(async () => { root.render(React.createElement(AnalyticsOverview, { state: nextState })); });
    },
    async unmount() {
      await act(async () => { root.unmount(); });
      container.parentNode?.removeChild(container);
      for (const [name, value] of previous) {
        if (value === undefined) delete globalThis[name];
        else globalThis[name] = value;
      }
    },
  };
}

test('renders unchanged KPIs and all four truthful chart/table mappings', async () => {
  const state = await loadAnalyticsOverview(async () => data());
  assert.equal(state.status, 'ready');
  const html = markup(state);
  for (const label of [
    'Current retained records', 'Accounts', 'Active-status accounts',
    'Eligible active accounts', 'Retained community posts',
    'Last 7 Manila calendar days', 'Last 30 Manila calendar days',
    'Last 90 Manila calendar days', 'Retained accounts registered',
    'Retained posts created',
    'Retained accounts registered per Manila calendar day',
    'Retained posts created per Manila calendar day',
    'Current retained accounts by role', 'Current retained accounts by status',
    'Manila date', 'Retained count',
  ]) assert.match(html, new RegExp(label));
  assert.match(html, /aria-pressed="true">30 days/);
  assert.match(html, /aria-pressed="false">7 days/);
  assert.match(html, /<th scope="row">Moderator<\/th><td>1<\/td>/);
  assert.match(html, /<th scope="row">Active-status accounts<\/th><td>3<\/td>/);
  assert.match(html, /<summary>View daily data table \(30 days\)<\/summary>/);
  assert.match(html, /aria-hidden="true"/);
  assert.deepEqual([7, 30, 90].map((days) => selectedDailyBuckets(state.data, days).length),
    [7, 30, 90]);
  assert.deepEqual(selectedDailyBuckets(state.data, 7).map((bucket) => bucket.localDate),
    state.data.daily.buckets.slice(-7).map((bucket) => bucket.localDate));
  assert.doesNotMatch(html, /Active users|DAU|MAU|forecast|prediction/i);
});

test('zero is displayed only after a successful response', async () => {
  const empty = data();
  empty.accounts = {
    total: 0, byRole: { user: 0, moderator: 0, admin: 0 },
    byStatus: { active: 0, suspended: 0 }, eligibleActive: 0,
  };
  empty.communityPosts.retainedTotal = 0;
  for (const bucket of empty.daily.buckets) {
    bucket.accountsRegistered = 0;
    bucket.postsCreated = 0;
  }
  for (const period of Object.values(empty.periods)) {
    period.accountsRegistered = 0;
    period.postsCreated = 0;
  }
  const html = markup(await loadAnalyticsOverview(async () => empty));
  assert.match(html, /<strong>0<\/strong>/);
  assert.match(html, /No retained accounts to show/);
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

test('rejects broken daily shape, date boundaries, totals and unsafe counts', async () => {
  for (const corrupt of [
    (value) => { value.daily.buckets.pop(); },
    (value) => { value.daily.buckets[89].fromUtc = '2026-10-11T15:59:59.999Z'; },
    (value) => { value.daily.buckets[88].localDate = '2026-10-10'; },
    (value) => { value.daily.buckets[89].toUtc = '2026-10-12T04:00:01.000Z'; },
    (value) => { value.daily.buckets[20].accountsRegistered = '1'; },
    (value) => { value.daily.buckets[20].postsCreated = Number.MAX_SAFE_INTEGER + 1; },
    (value) => { value.periods.days30.postsCreated += 1; },
    (value) => { value.daily.buckets[89].extra = 1; },
  ]) {
    const malformed = data();
    corrupt(malformed);
    assert.equal(validOverview(malformed), false);
    assert.deepEqual(await loadAnalyticsOverview(async () => malformed), { status: 'error', data: null });
  }
});

function midnightData() {
  const midnight = data();
  midnight.periodEndUtc = midnight.daily.buckets[89].fromUtc;
  midnight.daily.buckets[89].toUtc = midnight.periodEndUtc;
  midnight.generatedAtUtc = midnight.periodEndUtc;
  for (const period of Object.values(midnight.periods)) period.toUtc = midnight.periodEndUtc;
  return midnight;
}

test('accepts an empty current-day bucket exactly at Manila midnight', () => {
  const midnight = midnightData();
  assert.equal(midnight.daily.buckets[89].accountsRegistered, 0);
  assert.equal(midnight.daily.buckets[89].postsCreated, 0);
  assert.equal(validOverview(midnight), true);
});

test('rejects positive registration or post counts in an empty midnight bucket', async () => {
  for (const field of ['accountsRegistered', 'postsCreated']) {
    const midnight = midnightData();
    midnight.daily.buckets[89][field] = 1;
    for (const period of Object.values(midnight.periods)) period[field] += 1;
    assert.equal(midnight.daily.buckets[89].fromUtc, midnight.daily.buckets[89].toUtc);
    assert.equal(validOverview(midnight), false);
    assert.deepEqual(await loadAnalyticsOverview(async () => midnight),
      { status: 'error', data: null });
    assert.doesNotMatch(markup({ status: 'ready', data: midnight }), /<strong>4<\/strong>/);
  }
});

test('mounted selector changes both chart series, tables and period labels without a refetch', async () => {
  const payload = data();
  let requestCount = 0;
  const state = await loadAnalyticsOverview(async () => {
    requestCount += 1;
    return payload;
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { requestCount += 1; throw new Error('Unexpected Analytics refetch'); };
  let mounted;
  try {
    mounted = await mountAnalytics(state);
    const checkPeriod = (days) => {
      const selected = payload.daily.buckets.slice(-days);
      const period = payload.periods[`days${days}`];
      const buttons = descendants(mounted.container, (node) => node.tagName === 'BUTTON'
        && [7, 30, 90].some((value) => node.textContent === `${value} days`));
      assert.equal(buttons.length, 3);
      for (const button of buttons) {
        assert.equal(button.getAttribute('aria-pressed'),
          String(button.textContent === `${days} days`));
      }
      const heading = first(mounted.container,
        (node) => node.getAttribute?.('class') === 'wc-dashboard-chart-heading',
        'daily chart heading');
      const format = (instant) => new Intl.DateTimeFormat('en-PH', {
        timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short',
      }).format(new Date(instant));
      assert.ok(heading.textContent.includes(format(period.fromUtc)));
      assert.ok(heading.textContent.includes(format(period.toUtc)));
      for (const [title, kind, field] of [
        ['Retained accounts registered per Manila calendar day', 'line', 'accountsRegistered'],
        ['Retained posts created per Manila calendar day', 'bar', 'postsCreated'],
      ]) {
        const panel = first(mounted.container,
          (node) => node.getAttribute?.('aria-label') === title, title);
        assert.ok(panel.textContent.includes(`Last ${days} Manila calendar days:`));
        assert.ok(panel.textContent.includes(String(period[field])));
        const chart = first(panel, (node) => node.getAttribute?.('data-chart-kind') === kind,
          `${kind} chart`);
        assert.deepEqual(JSON.parse(chart.getAttribute('data-points')), selected);
        const series = first(chart, (node) => node.getAttribute?.('data-series-kind') === kind,
          `${kind} series`);
        assert.equal(series.getAttribute('data-series-key'), field);
        const table = first(panel, (node) => node.tagName === 'TABLE', `${title} table`);
        assert.ok(table.textContent.includes(`${title}, last ${days} Manila calendar days`));
        const rows = descendants(table, (node) => node.tagName === 'TR');
        assert.equal(rows.length, days + 1);
        for (let index = 0; index < selected.length; index += 1) {
          const cells = descendants(rows[index + 1],
            (node) => node.tagName === 'TH' || node.tagName === 'TD');
          assert.deepEqual(cells.map((cell) => cell.textContent),
            [selected[index].localDate, String(selected[index][field])]);
        }
      }
    };

    checkPeriod(30);
    for (const days of [7, 30, 90]) {
      const button = first(mounted.container,
        (node) => node.tagName === 'BUTTON' && node.textContent === `${days} days`,
        `${days}-day selector`);
      await act(async () => { reactProps(button).onClick(); });
      checkPeriod(days);
      assert.equal(requestCount, 1);
    }
  } finally {
    if (mounted) await mounted.unmount();
    if (originalFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = originalFetch;
  }
});

test('mounted role pie and status bars retain exact current snapshot mappings across periods', async () => {
  const payload = data();
  payload.accounts = {
    total: 16,
    byRole: { user: 9, moderator: 5, admin: 2 },
    byStatus: { active: 13, suspended: 3 },
    eligibleActive: 11,
  };
  assert.equal(validOverview(payload), true);
  const mounted = await mountAnalytics({ status: 'ready', data: payload });
  try {
    const tableRows = (panel) => {
      const table = first(panel, (node) => node.tagName === 'TABLE', 'distribution table');
      return descendants(table, (node) => node.tagName === 'TR').slice(1).map((row) =>
        descendants(row, (node) => node.tagName === 'TH' || node.tagName === 'TD')
          .map((cell) => cell.textContent));
    };
    const checkSnapshots = () => {
      const roles = first(mounted.container,
        (node) => node.getAttribute?.('aria-label') === 'Current retained accounts by role',
        'role panel');
      const pieChart = first(roles,
        (node) => node.getAttribute?.('data-chart-kind') === 'pie', 'role pie chart');
      const pie = first(pieChart,
        (node) => node.getAttribute?.('data-series-kind') === 'pie', 'role pie series');
      assert.deepEqual(JSON.parse(pie.getAttribute('data-points')), [
        { name: 'User', value: 9 },
        { name: 'Moderator', value: 5 },
        { name: 'Admin', value: 2 },
      ]);
      assert.equal(pie.getAttribute('data-series-key'), 'value');
      assert.equal(pie.getAttribute('data-name-key'), 'name');
      assert.deepEqual(tableRows(roles), [
        ['User', '9'], ['Moderator', '5'], ['Admin', '2'],
      ]);

      const statuses = first(mounted.container,
        (node) => node.getAttribute?.('aria-label') === 'Current retained accounts by status',
        'status panel');
      const barChart = first(statuses,
        (node) => node.getAttribute?.('data-chart-kind') === 'bar', 'status bar chart');
      assert.deepEqual(JSON.parse(barChart.getAttribute('data-points')), [
        { name: 'Active-status accounts', value: 13 },
        { name: 'Suspended accounts', value: 3 },
      ]);
      const bar = first(barChart,
        (node) => node.getAttribute?.('data-series-kind') === 'bar', 'status bar series');
      assert.equal(bar.getAttribute('data-series-key'), 'value');
      const categoryAxis = first(barChart,
        (node) => node.getAttribute?.('data-axis-kind') === 'y', 'status category axis');
      assert.equal(categoryAxis.getAttribute('data-axis-key'), 'name');
      assert.deepEqual(tableRows(statuses), [
        ['Active-status accounts', '13'], ['Suspended accounts', '3'],
      ]);
    };

    checkSnapshots(); // Default 30-day daily view must leave current snapshots intact.
    for (const days of [7, 30, 90]) {
      const button = first(mounted.container,
        (node) => node.tagName === 'BUTTON' && node.textContent === `${days} days`,
        `${days}-day selector`);
      await act(async () => { reactProps(button).onClick(); });
      assert.equal(button.getAttribute('aria-pressed'), 'true');
      checkSnapshots();
    }
  } finally {
    await mounted.unmount();
  }
});

test('mounted zero series stay valid and a missing daily response clears prior KPIs', async () => {
  const zero = data();
  for (const bucket of zero.daily.buckets) {
    bucket.accountsRegistered = 0;
    bucket.postsCreated = 0;
  }
  for (const period of Object.values(zero.periods)) {
    period.accountsRegistered = 0;
    period.postsCreated = 0;
  }
  const mounted = await mountAnalytics({ status: 'ready', data: zero });
  try {
    assert.equal(validOverview(zero), true);
    assert.equal(descendants(mounted.container,
      (node) => node.textContent === 'No retained records were created in this window.').length >= 2,
    true);
    assert.equal(descendants(mounted.container,
      (node) => node.getAttribute?.('data-chart-kind') === 'line').length, 1);
    const withoutDaily = { ...zero };
    delete withoutDaily.daily;
    await mounted.update({ status: 'ready', data: withoutDaily });
    assert.ok(mounted.container.textContent.includes('Analytics could not be loaded.'));
    assert.ok(!mounted.container.textContent.includes('Current retained records'));
    assert.equal(descendants(mounted.container,
      (node) => node.getAttribute?.('data-chart-kind') !== null
        && node.getAttribute?.('data-chart-kind') !== undefined).length, 0);
  } finally {
    await mounted.unmount();
  }
});
