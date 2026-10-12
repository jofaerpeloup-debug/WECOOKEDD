import React from 'react';
import { getAnalyticsOverview } from './analyticsApi.js';

const PERIODS = [7, 30, 90];

function validCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validIso(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

export function validOverview(data) {
  if (!data || data.timeZone !== 'Asia/Manila'
    || !validIso(data.periodEndUtc) || !validIso(data.generatedAtUtc)) return false;
  const a = data.accounts;
  const p = data.periods;
  if (!a || !a.byRole || !a.byStatus || !data.communityPosts || !p) return false;
  const snapshot = [a.total, a.byRole.user, a.byRole.moderator, a.byRole.admin,
    a.byStatus.active, a.byStatus.suspended, a.eligibleActive,
    data.communityPosts.retainedTotal];
  if (!snapshot.every(validCount)
    || a.total !== a.byRole.user + a.byRole.moderator + a.byRole.admin
    || a.total !== a.byStatus.active + a.byStatus.suspended
    || a.eligibleActive > a.byStatus.active) return false;
  return PERIODS.every((days) => {
    const period = p[`days${days}`];
    return period && validIso(period.fromUtc) && period.toUtc === data.periodEndUtc
      && Date.parse(period.fromUtc) < Date.parse(period.toUtc)
      && validCount(period.accountsRegistered) && validCount(period.postsCreated);
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

export default function AnalyticsOverview({ state }) {
  if (state.status !== 'ready') {
    const message = {
      idle: 'Analytics has not loaded yet.',
      loading: 'Loading analytics…',
      denied: 'Analytics access is no longer available.',
      unsupported: 'Analytics is unavailable because source data coverage is unsupported.',
      error: 'Analytics could not be loaded.',
    }[state.status] || 'Analytics could not be loaded.';
    return <section className="wc-dashboard-analytics" aria-label="Analytics overview"><p role="status">{message}</p></section>;
  }

  const { accounts, communityPosts, periods, generatedAtUtc } = state.data;
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
          const period = periods[`days${days}`];
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
    </section>
  );
}
