import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  RotateCcw,
  ShieldAlert,
} from 'lucide-react';
import { ApiError } from './apiClient.js';
import {
  AUDIT_EVENT_TYPES,
  AUDIT_OUTCOMES,
  AUDIT_TARGET_TYPES,
  listAuditLogs,
  validateAuditLogResponse,
} from './auditLogApi.js';
import ManagementPagination from './ManagementPagination.jsx';

const PAGE_LIMIT = 20;
const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

const EVENT_LABELS = Object.freeze({
  'admin.user.status_changed': 'User status changed',
  'admin.staff.moderator_approved': 'Moderator approved',
  'admin.staff.application_rejected': 'Application rejected',
  'admin.staff.moderator_demoted': 'Moderator demoted',
});

const TARGET_LABELS = Object.freeze({
  user: 'User',
  moderator_application: 'Moderator application',
});

export const EMPTY_AUDIT_FILTERS = Object.freeze({
  eventType: '',
  actorUserId: '',
  targetType: '',
  targetId: '',
  outcome: '',
  from: '',
  to: '',
});

const LOCAL_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;

export function localDateTimeToIso(value) {
  if (!value) return undefined;
  const match = LOCAL_DATE_TIME_PATTERN.exec(value);
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText = '0', fraction = ''] = match;
  const expected = {
    year: Number(yearText),
    month: Number(monthText) - 1,
    day: Number(dayText),
    hour: Number(hourText),
    minute: Number(minuteText),
    second: Number(secondText),
    millisecond: Number(fraction.padEnd(3, '0')),
  };
  if (expected.year < 1) return null;

  const parsed = new Date(0);
  parsed.setFullYear(expected.year, expected.month, expected.day);
  parsed.setHours(expected.hour, expected.minute, expected.second, expected.millisecond);

  if (
    Number.isNaN(parsed.getTime())
    || parsed.getFullYear() !== expected.year
    || parsed.getMonth() !== expected.month
    || parsed.getDate() !== expected.day
    || parsed.getHours() !== expected.hour
    || parsed.getMinutes() !== expected.minute
    || parsed.getSeconds() !== expected.second
    || parsed.getMilliseconds() !== expected.millisecond
  ) {
    return null;
  }
  return parsed.toISOString();
}

export function validateAuditFilters(draft) {
  const actorUserId = draft.actorUserId.trim();
  const targetId = draft.targetId.trim();
  if (actorUserId && !OBJECT_ID_PATTERN.test(actorUserId)) {
    return { error: 'Actor ID must be a 24-character identifier.', filters: null };
  }
  if (targetId && !OBJECT_ID_PATTERN.test(targetId)) {
    return { error: 'Target ID must be a 24-character identifier.', filters: null };
  }

  const from = localDateTimeToIso(draft.from);
  const to = localDateTimeToIso(draft.to);
  if (from === null || to === null) {
    return { error: 'Enter a valid date and time.', filters: null };
  }
  if (from && to && new Date(from) > new Date(to)) {
    return { error: 'The end date must be at or after the start date.', filters: null };
  }

  return {
    error: '',
    filters: {
      eventType: draft.eventType || undefined,
      actorUserId: actorUserId || undefined,
      targetType: draft.targetType || undefined,
      targetId: targetId || undefined,
      outcome: draft.outcome || undefined,
      from,
      to,
    },
  };
}

export function nextAuditPage(currentPage, requestedPage, totalPages) {
  if (!Number.isSafeInteger(requestedPage) || requestedPage < 1) return currentPage;
  if (!Number.isSafeInteger(totalPages) || totalPages < 1) return currentPage;
  return Math.min(requestedPage, totalPages);
}

function safeErrorState(error) {
  if (error instanceof ApiError) {
    if (error.isForbidden) {
      return {
        kind: 'forbidden',
        message: 'Your account does not have permission to view Audit Logs.',
      };
    }
    if (error.isUnauthorized) {
      return {
        kind: 'unauthorized',
        message: 'Your session has ended. Please sign in again.',
      };
    }
    if (error.isNetworkError) {
      return {
        kind: 'error',
        message: 'Audit Logs could not be reached. Check your connection and try again.',
      };
    }
  }
  return { kind: 'error', message: 'Audit Logs could not be loaded. Please try again.' };
}

export function createAuditLogsState() {
  return {
    generation: 0,
    items: [],
    pagination: null,
    loading: true,
    error: null,
  };
}

export function auditLogsStateTransition(state, action) {
  if (action.type === 'request-started') {
    if (!Number.isSafeInteger(action.generation) || action.generation <= state.generation) {
      return state;
    }
    return {
      generation: action.generation,
      items: [],
      pagination: null,
      loading: true,
      error: null,
    };
  }
  if (action.generation !== state.generation) return state;
  if (action.type === 'request-succeeded') {
    return {
      generation: state.generation,
      items: action.response.auditLogs,
      pagination: action.response.pagination,
      loading: false,
      error: null,
    };
  }
  if (action.type === 'request-failed') {
    return {
      generation: state.generation,
      items: [],
      pagination: null,
      loading: false,
      error: safeErrorState(action.error),
    };
  }
  return state;
}

export function isAuditAuthorityLoss(error) {
  const kind = safeErrorState(error).kind;
  return kind === 'forbidden' || kind === 'unauthorized';
}

export function applyAuditFiltersState(draft) {
  const validated = validateAuditFilters(draft);
  return validated.filters
    ? { filterError: '', filters: validated.filters, page: 1 }
    : { filterError: validated.error, filters: null, page: null };
}

export function resetAuditFiltersState() {
  return {
    draft: { ...EMPTY_AUDIT_FILTERS },
    filterError: '',
    filters: {},
    page: 1,
  };
}

function useAuditLogs({ filters, page, request, onAuthorityLost }) {
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState(createAuditLogsState);
  const generationRef = useRef(0);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    // Clear records immediately so old-filter data is never presented as the
    // result for a newly submitted filter or page.
    setState((current) => auditLogsStateTransition(current, {
      type: 'request-started',
      generation,
    }));

    request({ ...filters, page, limit: PAGE_LIMIT })
      .then(validateAuditLogResponse)
      .then((response) => {
        if (cancelled || generation !== generationRef.current) return;
        setState((current) => auditLogsStateTransition(current, {
          type: 'request-succeeded',
          generation,
          response,
        }));
      })
      .catch((error) => {
        if (cancelled || generation !== generationRef.current) return;
        setState((current) => auditLogsStateTransition(current, {
          type: 'request-failed',
          generation,
          error,
        }));
        if (isAuditAuthorityLoss(error)) {
          onAuthorityLost();
        }
      });

    return () => {
      cancelled = true;
    };
  }, [filters, nonce, onAuthorityLost, page, request]);

  return { ...state, reload };
}

function formatTimestamp(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Unavailable';
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(parsed);
}

function optionLabel(value) {
  return value
    .split(/[._]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function AuditLogsView({
  draft,
  filterError,
  onDraftChange,
  onApplyFilters,
  onResetFilters,
  items,
  pagination,
  loading,
  error,
  onRetry,
  onPageChange,
}) {
  return (
    <div className="wc-audit wc-management-page">
      <header className="wc-audit-header">
        <div>
          <p className="wc-audit-eyebrow">Monitoring</p>
          <h1>Audit Logs</h1>
          <p>Review recorded administrative activity. Results are read-only and newest first.</p>
        </div>
      </header>

      <form className="wc-audit-filters" onSubmit={onApplyFilters} aria-label="Audit log filters">
        <div className="wc-audit-filter-grid">
          <label>
            <span>Event</span>
            <select value={draft.eventType} onChange={(event) => onDraftChange('eventType', event.target.value)}>
              <option value="">All events</option>
              {AUDIT_EVENT_TYPES.map((value) => (
                <option key={value} value={value}>{EVENT_LABELS[value]}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Outcome</span>
            <select value={draft.outcome} onChange={(event) => onDraftChange('outcome', event.target.value)}>
              <option value="">All outcomes</option>
              {AUDIT_OUTCOMES.map((value) => (
                <option key={value} value={value}>{optionLabel(value)}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Target type</span>
            <select value={draft.targetType} onChange={(event) => onDraftChange('targetType', event.target.value)}>
              <option value="">All target types</option>
              {AUDIT_TARGET_TYPES.map((value) => (
                <option key={value} value={value}>{TARGET_LABELS[value]}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Actor ID</span>
            <input
              value={draft.actorUserId}
              onChange={(event) => onDraftChange('actorUserId', event.target.value)}
              placeholder="24-character ID"
              autoComplete="off"
            />
          </label>
          <label>
            <span>Target ID</span>
            <input
              value={draft.targetId}
              onChange={(event) => onDraftChange('targetId', event.target.value)}
              placeholder="24-character ID"
              autoComplete="off"
            />
          </label>
          <label>
            <span>From</span>
            <input
              type="datetime-local"
              value={draft.from}
              onChange={(event) => onDraftChange('from', event.target.value)}
            />
          </label>
          <label>
            <span>To</span>
            <input
              type="datetime-local"
              value={draft.to}
              onChange={(event) => onDraftChange('to', event.target.value)}
            />
          </label>
        </div>
        {filterError && <p className="wc-audit-filter-error" role="alert">{filterError}</p>}
        <div className="wc-audit-filter-actions">
          <button type="submit" className="wc-audit-primary" disabled={loading}>Apply filters</button>
          <button type="button" className="wc-audit-secondary" onClick={onResetFilters}>
            <RotateCcw size={15} aria-hidden="true" /> Reset
          </button>
        </div>
      </form>

      <section className="wc-audit-results" aria-live="polite" aria-busy={loading}>
        {loading ? (
          <div className="wc-audit-state" role="status">Loading audit records…</div>
        ) : error ? (
          <div className={`wc-audit-state wc-audit-state-${error.kind}`} role={error.kind === 'error' ? 'alert' : 'status'}>
            {error.kind === 'forbidden' || error.kind === 'unauthorized'
              ? <ShieldAlert size={24} aria-hidden="true" />
              : <AlertCircle size={24} aria-hidden="true" />}
            <strong>{error.kind === 'forbidden' ? 'Access denied' : 'Audit Logs unavailable'}</strong>
            <span>{error.message}</span>
            {error.kind === 'error' && <button type="button" onClick={onRetry}>Try again</button>}
          </div>
        ) : items.length === 0 ? (
          <div className="wc-audit-state">
            <strong>No audit records found</strong>
            <span>No records match the current filters.</span>
          </div>
        ) : (
          <>
            <ManagementPagination pagination={pagination} noun="record" onPageChange={onPageChange} />
            <div className="wc-audit-table-wrap">
              <table className="wc-audit-table">
                <caption>Administrative audit records, newest first</caption>
                <thead>
                  <tr>
                    <th scope="col">Time</th>
                    <th scope="col">Event</th>
                    <th scope="col">Actor</th>
                    <th scope="col">Target</th>
                    <th scope="col">Outcome</th>
                    <th scope="col">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((record) => (
                    <tr key={record.id}>
                      <td data-label="Time">
                        <time dateTime={record.createdAt}>{formatTimestamp(record.createdAt)}</time>
                      </td>
                      <td data-label="Event">
                        <strong>{EVENT_LABELS[record.eventType] || optionLabel(record.eventType)}</strong>
                        <code>{record.eventType}</code>
                      </td>
                      <td data-label="Actor">
                        <span className="wc-audit-id">{record.actorUserId || 'System'}</span>
                        <span className="wc-audit-detail">{optionLabel(record.actorRole || 'unknown role')}</span>
                      </td>
                      <td data-label="Target">
                        <span>{TARGET_LABELS[record.targetType] || optionLabel(record.targetType)}</span>
                        <span className="wc-audit-id">{record.targetId || 'Unavailable'}</span>
                      </td>
                      <td data-label="Outcome">
                        <span className={`wc-audit-outcome wc-audit-outcome-${record.outcome}`}>
                          {record.outcome === 'success'
                            ? <CheckCircle2 size={14} aria-hidden="true" />
                            : <AlertCircle size={14} aria-hidden="true" />}
                          {optionLabel(record.outcome)}
                        </span>
                      </td>
                      <td data-label="Reason">{record.reasonCode ? optionLabel(record.reasonCode) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

export default function AuditLogsTab({ onAuthorityLost, request = listAuditLogs }) {
  const [draft, setDraft] = useState({ ...EMPTY_AUDIT_FILTERS });
  const [filters, setFilters] = useState({});
  const [filterError, setFilterError] = useState('');
  const [page, setPage] = useState(1);

  const authorityLostRef = useRef(onAuthorityLost);
  useEffect(() => {
    authorityLostRef.current = onAuthorityLost;
  }, [onAuthorityLost]);
  const notifyAuthorityLost = useCallback(() => {
    if (typeof authorityLostRef.current === 'function') authorityLostRef.current();
  }, []);

  const { items, pagination, loading, error, reload } = useAuditLogs({
    filters,
    page,
    request,
    onAuthorityLost: notifyAuthorityLost,
  });

  const updateDraft = useCallback((field, value) => {
    setDraft((current) => ({ ...current, [field]: value }));
  }, []);

  const applyFilters = useCallback((event) => {
    event.preventDefault();
    const next = applyAuditFiltersState(draft);
    setFilterError(next.filterError);
    if (!next.filters) return;
    setPage(next.page);
    setFilters(next.filters);
  }, [draft]);

  const resetFilters = useCallback(() => {
    const next = resetAuditFiltersState();
    setDraft(next.draft);
    setFilterError(next.filterError);
    setPage(next.page);
    setFilters(next.filters);
  }, []);

  const changePage = useCallback((requestedPage) => {
    setPage((current) => nextAuditPage(current, requestedPage, pagination?.totalPages));
  }, [pagination?.totalPages]);

  return (
    <AuditLogsView
      draft={draft}
      filterError={filterError}
      onDraftChange={updateDraft}
      onApplyFilters={applyFilters}
      onResetFilters={resetFilters}
      items={items}
      pagination={pagination}
      loading={loading}
      error={error}
      onRetry={reload}
      onPageChange={changePage}
    />
  );
}
