import React, { useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { getAnalyticsOverview } from './analyticsApi.js';

const PERIODS = [7, 30, 90];
const BUCKET_KEYS = ['localDate', 'fromUtc', 'toUtc', 'accountsRegistered', 'postsCreated'];
const ROLE_COLORS = ['var(--viz-role-user)', 'var(--viz-role-moderator)', 'var(--viz-role-admin)'];

function validCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validIso(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

const manilaParts = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function localParts(instant) {
  return Object.fromEntries(manilaParts.formatToParts(new Date(instant))
    .filter(({ type }) => type !== 'literal').map(({ type, value }) => [type, value]));
}

function nextLocalDate(date) {
  const next = new Date(date + 'T00:00:00.000Z');
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

function sumCounts(buckets, field) {
  return buckets.reduce((total, bucket) => total + bucket[field], 0);
}

export function selectedDailyBuckets(data, days) {
  return PERIODS.includes(days) ? data.daily.buckets.slice(-days) : [];
}

export function validOverview(data) {
  if (!exactKeys(data, [
    'periodEndUtc', 'generatedAtUtc', 'timeZone', 'accounts', 'communityPosts', 'periods', 'daily',
  ]) || data.timeZone !== 'Asia/Manila'
    || !validIso(data.periodEndUtc) || !validIso(data.generatedAtUtc)) return false;

  const a = data.accounts;
  const p = data.periods;
  if (!exactKeys(a, ['total', 'byRole', 'byStatus', 'eligibleActive'])
    || !exactKeys(a.byRole, ['user', 'moderator', 'admin'])
    || !exactKeys(a.byStatus, ['active', 'suspended'])
    || !exactKeys(data.communityPosts, ['retainedTotal'])
    || !exactKeys(p, ['days7', 'days30', 'days90'])
    || !exactKeys(data.daily, ['buckets'])) return false;

  const snapshot = [a.total, a.byRole.user, a.byRole.moderator, a.byRole.admin,
    a.byStatus.active, a.byStatus.suspended, a.eligibleActive,
    data.communityPosts.retainedTotal];
  if (!snapshot.every(validCount)
    || a.total !== a.byRole.user + a.byRole.moderator + a.byRole.admin
    || a.total !== a.byStatus.active + a.byStatus.suspended
    || a.eligibleActive > a.byStatus.active) return false;

  const buckets = data.daily.buckets;
  if (!Array.isArray(buckets) || buckets.length !== 90) return false;
  for (let index = 0; index < buckets.length; index += 1) {
    const bucket = buckets[index];
    if (!exactKeys(bucket, BUCKET_KEYS)
      || !/^\d{4}-\d{2}-\d{2}$/.test(bucket.localDate)
      || !validIso(bucket.fromUtc) || !validIso(bucket.toUtc)
      || !validCount(bucket.accountsRegistered) || !validCount(bucket.postsCreated)) return false;
    const parts = localParts(bucket.fromUtc);
    if ([parts.year, parts.month, parts.day].join('-') !== bucket.localDate
      || parts.hour !== '00' || parts.minute !== '00' || parts.second !== '00'
      || new Date(bucket.fromUtc).getUTCMilliseconds() !== 0) return false;
    if (index > 0 && (buckets[index - 1].toUtc !== bucket.fromUtc
      || nextLocalDate(buckets[index - 1].localDate) !== bucket.localDate)) return false;
    if (index < 89 && Date.parse(bucket.fromUtc) >= Date.parse(bucket.toUtc)) return false;
    if (index === 89 && (bucket.toUtc !== data.periodEndUtc
      || Date.parse(bucket.fromUtc) > Date.parse(bucket.toUtc))) return false;
    if (index === 89 && bucket.fromUtc === bucket.toUtc
      && (bucket.accountsRegistered !== 0 || bucket.postsCreated !== 0)) return false;
  }
  const endParts = localParts(data.periodEndUtc);
  if ([endParts.year, endParts.month, endParts.day].join('-') !== buckets[89].localDate) return false;

  return PERIODS.every((days) => {
    const period = p['days' + days];
    const selected = buckets.slice(-days);
    const registrations = sumCounts(selected, 'accountsRegistered');
    const posts = sumCounts(selected, 'postsCreated');
    return exactKeys(period, ['fromUtc', 'toUtc', 'accountsRegistered', 'postsCreated'])
      && period.fromUtc === selected[0].fromUtc
      && period.toUtc === data.periodEndUtc
      && validCount(period.accountsRegistered) && validCount(period.postsCreated)
      && validCount(registrations) && validCount(posts)
      && period.accountsRegistered === registrations && period.postsCreated === posts;
  });
}

export async function loadAnalyticsOverview(request = getAnalyticsOverview) {
  try {
    const data = await request();
    return validOverview(data) ? { status: 'ready', data } : { status: 'error', data: null };
  } catch (error) {
    if (error?.status === 401 || error?.status === 403) return { status: 'denied', data: null };
    if (error?.status === 422 && error?.code === 'ANALYTICS_UNSUPPORTED') {
      return { status: 'unsupported', data: null };
    }
    return { status: 'error', data: null };
  }
}

function displayInstant(instant) {
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date(instant));
}

function DailyPanel({ title, dataKey, total, buckets, days, kind, color }) {
  const hasValues = buckets.some((bucket) => bucket[dataKey] > 0);
  return (
    <section className="wc-dashboard-chart-panel" aria-label={title}>
      <h4>{title}</h4>
      <p>Last {days} Manila calendar days: <strong>{total}</strong> retained records.</p>
      {!hasValues && <p role="status">No retained records were created in this window.</p>}
      <div className="wc-dashboard-chart-visual" aria-hidden="true">
        <ResponsiveContainer width="100%" height={220}>
          {kind === 'line' ? (
            <LineChart data={buckets} margin={{ top: 12, right: 12, bottom: 8, left: 0 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis dataKey="localDate" tickFormatter={(value) => value.slice(5)} minTickGap={25} />
              <YAxis allowDecimals={false} domain={[0, 'auto']} width={40} />
              <Tooltip labelFormatter={(value) => 'Manila ' + value}
                formatter={(value) => [value, 'Retained accounts registered']} />
              <Line type="linear" dataKey={dataKey} stroke={color} strokeWidth={2}
                dot={days <= 30} activeDot={{ r: 5 }} isAnimationActive={false} />
            </LineChart>
          ) : (
            <BarChart data={buckets} margin={{ top: 12, right: 12, bottom: 8, left: 0 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis dataKey="localDate" tickFormatter={(value) => value.slice(5)} minTickGap={25} />
              <YAxis allowDecimals={false} domain={[0, 'auto']} width={40} />
              <Tooltip labelFormatter={(value) => 'Manila ' + value}
                formatter={(value) => [value, 'Retained posts created']} />
              <Bar dataKey={dataKey} fill={color} isAnimationActive={false} />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
      <details className="wc-dashboard-chart-details">
        <summary>View daily data table ({days} days)</summary>
        <div className="wc-dashboard-chart-table-wrap">
          <table>
            <caption>{title}, last {days} Manila calendar days</caption>
            <thead><tr><th scope="col">Manila date</th><th scope="col">Retained count</th></tr></thead>
            <tbody>{buckets.map((bucket) => (
              <tr key={bucket.localDate}><th scope="row">{bucket.localDate}</th><td>{bucket[dataKey]}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

function DistributionPanel({ title, rows, kind, empty }) {
  return (
    <section className="wc-dashboard-chart-panel" aria-label={title}>
      <h4>{title}</h4>
      {empty ? <p role="status">No retained accounts to show.</p> : (
        <div className="wc-dashboard-chart-visual" aria-hidden="true">
          <ResponsiveContainer width="100%" height={220}>
            {kind === 'pie' ? (
              <PieChart>
                <Pie data={rows} dataKey="value" nameKey="name" cx="50%" cy="50%"
                  outerRadius="75%" isAnimationActive={false}>
                  {rows.map((row, index) => <Cell key={row.name} fill={ROLE_COLORS[index]} />)}
                </Pie>
                <Tooltip formatter={(value) => [value, 'Current retained accounts']} />
              </PieChart>
            ) : (
              <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 14, bottom: 8, left: 0 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis type="number" allowDecimals={false} domain={[0, 'auto']} />
                <YAxis type="category" dataKey="name" width={125} />
                <Tooltip formatter={(value) => [value, 'Current retained accounts']} />
                <Bar dataKey="value" fill="var(--viz-status)" isAnimationActive={false} />
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
      <div className="wc-dashboard-chart-table-wrap">
        <table>
          <caption>{title}: current retained accounts</caption>
          <thead><tr><th scope="col">Category</th><th scope="col">Accounts</th></tr></thead>
          <tbody>{rows.map((row) => (
            <tr key={row.name}><th scope="row">{row.name}</th><td>{row.value}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}

export default function AnalyticsOverview({ state }) {
  const [selectedDays, setSelectedDays] = useState(30);
  const displayStatus = state.status === 'ready' && !validOverview(state.data)
    ? 'error' : state.status;
  if (displayStatus !== 'ready') {
    const message = {
      idle: 'Analytics has not loaded yet.',
      loading: 'Loading analytics…',
      denied: 'Analytics access is no longer available.',
      unsupported: 'Analytics is unavailable because source data coverage is unsupported.',
      error: 'Analytics could not be loaded.',
    }[displayStatus] || 'Analytics could not be loaded.';
    return <section className="wc-dashboard-analytics" aria-label="Analytics overview"><p role="status">{message}</p></section>;
  }

  const { accounts, communityPosts, periods, generatedAtUtc } = state.data;
  const buckets = selectedDailyBuckets(state.data, selectedDays);
  const selectedPeriod = periods['days' + selectedDays];
  const roles = [
    { name: 'User', value: accounts.byRole.user },
    { name: 'Moderator', value: accounts.byRole.moderator },
    { name: 'Admin', value: accounts.byRole.admin },
  ];
  const statuses = [
    { name: 'Active-status accounts', value: accounts.byStatus.active },
    { name: 'Suspended accounts', value: accounts.byStatus.suspended },
  ];

  return (
    <section className="wc-dashboard-analytics" aria-label="Analytics overview">
      <h2>Current retained records</h2>
      <p>As of {displayInstant(generatedAtUtc)} (Asia/Manila). Counts across collections can differ during concurrent changes.</p>
      <div className="wc-dashboard-analytics-grid">
        <div><span>Accounts</span><strong>{accounts.total}</strong><small>All roles and statuses, including deactivated accounts</small></div>
        <div><span>Active-status accounts</span><strong>{accounts.byStatus.active}</strong><small>Current status; this does not measure usage</small></div>
        <div><span>Suspended accounts</span><strong>{accounts.byStatus.suspended}</strong><small>Current status</small></div>
        <div><span>Eligible active accounts</span><strong>{accounts.eligibleActive}</strong><small>Active status and not deactivated; this does not measure usage</small></div>
        <div><span>Retained community posts</span><strong>{communityPosts.retainedTotal}</strong><small>Deleted posts are excluded</small></div>
      </div>
      <p>Current account roles: {accounts.byRole.user} user, {accounts.byRole.moderator} moderator, {accounts.byRole.admin} admin.</p>
      <h3>Retained records created</h3>
      <p>Each window includes the current partial Manila day. Deleted records leave earlier counts; these are not lifetime events or usage activity.</p>
      <div className="wc-dashboard-periods">
        {PERIODS.map((days) => {
          const period = periods['days' + days];
          return (
            <div key={days}>
              <h4>Last {days} Manila calendar days</h4>
              <p>{displayInstant(period.fromUtc)} to {displayInstant(period.toUtc)}</p>
              <p>Retained accounts registered: <strong>{period.accountsRegistered}</strong></p>
              <p>Retained posts created: <strong>{period.postsCreated}</strong></p>
            </div>
          );
        })}
      </div>
      <div className="wc-dashboard-chart-heading">
        <div><h3>Daily retained records</h3><p>Created from {displayInstant(selectedPeriod.fromUtc)} to {displayInstant(selectedPeriod.toUtc)} (Asia/Manila). The current day is partial; at midnight it is empty.</p></div>
        <div className="wc-dashboard-chart-period-control" role="group" aria-label="Daily chart reporting period">
          {PERIODS.map((days) => (
            <button key={days} type="button" aria-pressed={selectedDays === days}
              onClick={() => setSelectedDays(days)}>{days} days</button>
          ))}
        </div>
      </div>
      <div className="wc-dashboard-chart-grid">
        <DailyPanel title="Retained accounts registered per Manila calendar day" dataKey="accountsRegistered"
          total={selectedPeriod.accountsRegistered} buckets={buckets} days={selectedDays}
          kind="line" color="var(--viz-registration)" />
        <DailyPanel title="Retained posts created per Manila calendar day" dataKey="postsCreated"
          total={selectedPeriod.postsCreated} buckets={buckets} days={selectedDays}
          kind="bar" color="var(--viz-posts)" />
      </div>
      <div className="wc-dashboard-chart-grid">
        <DistributionPanel title="Current retained accounts by role" rows={roles} kind="pie"
          empty={accounts.total === 0} />
        <DistributionPanel title="Current retained accounts by status" rows={statuses} kind="bar"
          empty={accounts.total === 0} />
      </div>
    </section>
  );
}
