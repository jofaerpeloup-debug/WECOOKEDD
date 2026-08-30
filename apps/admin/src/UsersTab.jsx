import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Search, Users, AlertCircle, Check,
  ChevronLeft, ChevronRight, Ban, RotateCcw,
} from 'lucide-react';
import { ApiError } from './apiClient.js';
import { listUsers, updateUser } from './userApi.js';
import {
  USER_ROLE_FILTERS, USER_STATUS_FILTERS, USER_SORTS, ROLE_LABELS, STATUS_LABELS,
} from './userOptions.js';

// Admin Users tab — REST-backed, consistent with IngredientsTab /
// SubstitutionsTab / RecipesTab.
//
//   UsersTab / useUsers -> userApi -> apiClient -> /api/v1/users -> MongoDB
//
// This component MUST NOT import backendAuth / useBackendAuth — App.jsx owns the
// only backend-auth hook instance. It receives:
//   currentUserId   — the acting admin's canonical Mongo user id (String(_id))
//   onAuthorityLost — called when a Users request fails with FORBIDDEN, so App
//                     can refresh /users/me and re-gate an admin who was
//                     demoted elsewhere.
//
// Supported V1 actions: suspend / reactivate ANOTHER user's account. Account
// status is the ONLY thing this UI mutates. Role is displayed and filterable
// but never changed from here — `PATCH /api/v1/users/:userId` technically
// accepts `role` (Phase A backend), but Admin Users V1 deliberately exposes
// status transitions only. Also not exposed: create user, delete user, edit
// name / email, password operations, emailVerified mutation, preferences /
// profile editing. The self row's status control is omitted here as UX only —
// the backend's ADMIN_CANNOT_MODIFY_SELF is authoritative.

const PAGE_LIMIT = 20;

// ISO-safe date formatter. The backend serializer sends full ISO timestamps
// (createdAt / updatedAt), so this deliberately does NOT reuse App.jsx's
// date-only helper (which appends 'T00:00:00' and cannot parse a full
// timestamp).
function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Turns any thrown error into one safe, human sentence. Same helper shape as
// IngredientsTab / SubstitutionsTab / RecipesTab. Backend AppError messages are
// already safe to show (Mongo internals are mapped to stable codes first); our
// ApiError network message is ours; anything else collapses to a generic line.
function toMessage(err) {
  if (err instanceof ApiError) {
    if (err.isNetworkError) return err.message;
    if (err.isUnauthorized) return 'Your session has expired. Please sign in again.';
    if (err.isForbidden) return err.message || 'Your account does not have permission to do that.';
    // VALIDATION_ERROR / USER_NOT_FOUND / ADMIN_CANNOT_MODIFY_SELF / rate limit
    // all carry a safe backend message.
    return err.message;
  }
  return 'Something went wrong. Please try again.';
}

function errorCode(err) {
  return err instanceof ApiError ? err.code : null;
}

// The two supported account-status actions, each with the LOCKED user-facing
// copy (see docs/architecture/admin-users-integration.md). Wording is
// deliberately "signs the user out" / "must sign in again" — never
// "immediately" / "instantly" / "kills every session". There is no role
// action here by product decision.
const ACTIONS = {
  suspend: {
    verb: 'Suspend account',
    note: 'Signs the user out and blocks access until reactivated.',
    patch: { status: 'suspended' },
  },
  reactivate: {
    verb: 'Reactivate account',
    note: 'Reactivates the account. The user must sign in again.',
    patch: { status: 'active' },
  },
};

// ---------------------------------------------------------------------------
// Data hook — server-owned search / filter / sort / pagination
// ---------------------------------------------------------------------------
function useUsers(onListForbidden) {
  const [filters, setFilters] = useState({
    search: '',
    role: '',
    status: '',
    sort: 'newest',
    page: 1,
  });
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState({ items: [], pagination: null, loading: true, error: null });

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const patchFilters = useCallback((patch) => {
    setFilters((f) => {
      const next = { ...f, ...patch };
      // Any filter change other than an explicit page move resets to page 1.
      if (!('page' in patch)) next.page = 1;
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));

    const run = async () => {
      try {
        const { users, pagination } = await listUsers({
          search: filters.search.trim() || undefined,
          role: filters.role || undefined,
          status: filters.status || undefined,
          sort: filters.sort,
          page: filters.page,
          limit: PAGE_LIMIT,
        });
        // Cancelled-effect guard: a superseded request can never write state —
        // every filters/nonce change tears down this closure. Same stale-response
        // pattern as the shipped REST tabs; no request-generation framework.
        if (!cancelled) setState({ items: users, pagination, loading: false, error: null });
      } catch (err) {
        if (cancelled) return;
        // A FORBIDDEN on the list itself means this admin lost admin authority
        // elsewhere — let App refresh /users/me and re-gate.
        if (errorCode(err) === 'FORBIDDEN') onListForbidden();
        // Keep the previous items in state (a later Retry may succeed); the tab
        // shows the error banner instead of the table while `error` is set.
        setState((s) => ({ ...s, loading: false, error: toMessage(err) }));
      }
    };

    // Debounce so typing in the search box doesn't fire a request per keystroke.
    const timer = setTimeout(run, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [filters, nonce, onListForbidden]);

  return { filters, patchFilters, ...state, reload };
}

// ---------------------------------------------------------------------------
// Tab
// ---------------------------------------------------------------------------
export default function UsersTab({ currentUserId, onAuthorityLost }) {
  // onAuthorityLost is passed as a fresh inline arrow from App on every render;
  // hold it in a ref so it never re-triggers the list effect.
  const authorityLostRef = useRef(onAuthorityLost);
  useEffect(() => {
    authorityLostRef.current = onAuthorityLost;
  }, [onAuthorityLost]);
  const notifyAuthorityLost = useCallback(() => {
    if (typeof authorityLostRef.current === 'function') authorityLostRef.current();
  }, []);

  const { filters, patchFilters, items, pagination, loading, error, reload } = useUsers(notifyAuthorityLost);

  const [confirm, setConfirm] = useState(null); // { id, action } | null
  const [rowError, setRowError] = useState(null); // { id, message } | null
  const [notice, setNotice] = useState(null); // string | null — cross-cutting, survives a reload
  const [busyRowId, setBusyRowId] = useState(null);
  // Synchronous single-flight lock: busyRowId is React state and a stale closure
  // could let a phantom double-click fire a second PATCH before the re-render.
  // Same guard as RecipesTab.
  const rowBusyRef = useRef(false);

  const totalPages = pagination?.totalPages ?? 1;
  const hasFilters = Boolean(filters.search || filters.role || filters.status);
  const anyBusy = Boolean(busyRowId);

  const runAction = async (user, actionKey) => {
    if (rowBusyRef.current || busyRowId) return;
    const action = ACTIONS[actionKey];
    if (!action) return;
    rowBusyRef.current = true;
    setRowError(null);
    setNotice(null);
    setBusyRowId(user.id);
    try {
      await updateUser(user.id, action.patch);
      setConfirm(null);
      reload(); // authoritative refetch — never an optimistic row mutation
    } catch (err) {
      const code = errorCode(err);
      if (code === 'FORBIDDEN') {
        // This admin lost admin authority elsewhere. Surface it and let App
        // refresh /users/me and re-gate.
        setConfirm(null);
        setNotice(toMessage(err));
        notifyAuthorityLost();
      } else if (code === 'USER_NOT_FOUND') {
        // The list is stale — the row is gone server-side. Reload it.
        setConfirm(null);
        setNotice('That user no longer exists — the list has been refreshed.');
        reload();
      } else {
        // ADMIN_CANNOT_MODIFY_SELF, VALIDATION_ERROR, rate limit, 5xx, network —
        // safe inline message on the row. NOT treated as authority loss.
        setRowError({ id: user.id, message: toMessage(err) });
      }
    } finally {
      rowBusyRef.current = false;
      setBusyRowId(null);
    }
  };

  const openConfirm = (userId, actionKey) => {
    setRowError(null);
    setConfirm({ id: userId, action: actionKey });
  };

  const renderActions = (user, isSelf) => {
    if (isSelf) {
      // Self row: no status action (UX only — backend ADMIN_CANNOT_MODIFY_SELF
      // is authoritative). The "You" chip is on the name cell.
      return <span className="wc-usr-muted">—</span>;
    }
    if (rowError && rowError.id === user.id) {
      return (
        <div className="wc-confirm-row">
          <span style={{ color: 'var(--clay)' }}>{rowError.message}</span>
          <button className="wc-confirm-no" onClick={() => setRowError(null)}>Dismiss</button>
        </div>
      );
    }
    if (confirm && confirm.id === user.id) {
      const action = ACTIONS[confirm.action];
      const busy = busyRowId === user.id;
      return (
        <div className="wc-usr-confirm">
          <div className="wc-usr-confirm-q">{action.verb}?</div>
          <div className="wc-usr-confirm-note">{action.note}</div>
          <div className="wc-confirm-row">
            <button
              className="wc-confirm-yes"
              disabled={busy}
              onClick={() => runAction(user, confirm.action)}
            >
              {busy ? 'Working…' : 'Confirm'}
            </button>
            <button className="wc-confirm-no" disabled={busy} onClick={() => setConfirm(null)}>
              Cancel
            </button>
          </div>
        </div>
      );
    }
    const statusAction = user.status === 'suspended' ? 'reactivate' : 'suspend';
    return (
      <div className="wc-row-actions">
        <button
          className={`wc-icon-btn ${statusAction === 'suspend' ? 'danger' : ''}`}
          disabled={anyBusy}
          title={ACTIONS[statusAction].verb}
          aria-label={`${ACTIONS[statusAction].verb} — ${user.name}`}
          onClick={() => openConfirm(user.id, statusAction)}
        >
          {statusAction === 'suspend' ? <Ban size={15} /> : <RotateCcw size={15} />}
        </button>
      </div>
    );
  };

  return (
    <div>
      <style>{`
        .wc-usr-filters { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
        .wc-usr-select {
          padding: 9px 10px; border-radius: 8px;
          border: 1px solid var(--stone-light);
          background: var(--parchment); color: var(--ink); font-size: 13px;
        }
        .wc-usr-status-line {
          padding: 40px 20px; text-align: center; color: var(--stone); font-size: 13.5px;
        }
        .wc-usr-error {
          display: flex; align-items: center; gap: 8px;
          background: #E9D3CB; color: var(--clay);
          border-radius: 10px; padding: 10px 14px; font-size: 13px; margin-bottom: 16px;
        }
        .wc-usr-muted { color: var(--stone); font-size: 13.5px; }
        .wc-usr-name { color: var(--ink); }
        .wc-usr-you {
          display: inline-block; margin-left: 8px; padding: 1px 7px;
          border-radius: 999px; font-size: 10.5px; font-weight: 700;
          text-transform: uppercase; letter-spacing: 0.04em;
          background: var(--sage-light); color: var(--sage-deep);
        }
        .wc-usr-verified { color: var(--sage-mid); vertical-align: middle; }
        .wc-pill.wc-usr-admin { background: var(--saffron); color: #fff; }
        .wc-pill.wc-usr-user { background: var(--stone-light); color: var(--ink); }
        .wc-usr-actions-cell { min-width: 190px; }
        .wc-usr-confirm { display: flex; flex-direction: column; gap: 5px; align-items: flex-end; }
        .wc-usr-confirm-q { font-size: 12.5px; font-weight: 600; color: var(--ink); }
        .wc-usr-confirm-note {
          font-size: 11.5px; color: var(--stone); line-height: 1.35;
          max-width: 230px; text-align: right;
        }
        .wc-usr-pagination {
          display: flex; align-items: center; justify-content: flex-end; gap: 12px;
          padding: 14px 4px 0; font-size: 13px; color: var(--stone);
        }
        .wc-usr-pagination button {
          display: flex; align-items: center;
          background: var(--parchment); border: 1px solid var(--stone-light);
          border-radius: 8px; padding: 6px 8px; color: var(--ink);
        }
        .wc-usr-pagination button:disabled { opacity: 0.4; cursor: default; }
        .wc-table .wc-confirm-row button:disabled,
        .wc-table .wc-icon-btn:disabled { opacity: 0.5; cursor: default; }
        .wc-usr-hint { font-size: 11.5px; color: var(--stone); padding: 10px 4px 0; line-height: 1.4; }
      `}</style>

      <div className="wc-topbar">
        <h1>Users</h1>
        <div className="wc-topbar-actions wc-usr-filters">
          <div className="wc-search">
            <Search size={15} />
            <input
              placeholder="Search name or email…"
              value={filters.search}
              onChange={(e) => patchFilters({ search: e.target.value })}
              aria-label="Search users by name or email"
            />
          </div>
          <select
            className="wc-usr-select"
            value={filters.role}
            onChange={(e) => patchFilters({ role: e.target.value })}
            aria-label="Filter by role"
          >
            {USER_ROLE_FILTERS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select
            className="wc-usr-select"
            value={filters.status}
            onChange={(e) => patchFilters({ status: e.target.value })}
            aria-label="Filter by status"
          >
            {USER_STATUS_FILTERS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select
            className="wc-usr-select"
            value={filters.sort}
            onChange={(e) => patchFilters({ sort: e.target.value })}
            aria-label="Sort users"
          >
            {USER_SORTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      {notice && (
        <div className="wc-usr-error">
          <AlertCircle size={15} /> {notice}
          <button
            className="wc-btn-secondary"
            style={{ marginLeft: 'auto', padding: '4px 10px', fontSize: 12 }}
            onClick={() => setNotice(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {error && (
        <div className="wc-usr-error">
          <AlertCircle size={15} /> {error}
          <button
            className="wc-btn-secondary"
            style={{ marginLeft: 'auto', padding: '4px 10px', fontSize: 12 }}
            onClick={reload}
          >
            Retry
          </button>
        </div>
      )}

      {!error && (
        <div className="wc-table-wrap">
          {loading && items.length === 0 ? (
            <div className="wc-usr-status-line">Loading users…</div>
          ) : items.length === 0 ? (
            <div className="wc-empty">
              <Users size={28} />
              <div>
                {hasFilters
                  ? 'No users match these filters.'
                  : 'No users yet.'}
              </div>
            </div>
          ) : (
            <table className="wc-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Verified</th>
                  <th>Joined</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((u) => {
                  const isSelf = currentUserId != null && String(u.id) === String(currentUserId);
                  return (
                    <tr key={u.id}>
                      <td>
                        <span className="wc-usr-name">{u.name}</span>
                        {isSelf && <span className="wc-usr-you">You</span>}
                      </td>
                      <td className="wc-usr-muted">{u.email}</td>
                      <td>
                        <span className={`wc-pill ${u.role === 'admin' ? 'wc-usr-admin' : 'wc-usr-user'}`}>
                          {ROLE_LABELS[u.role] || u.role}
                        </span>
                      </td>
                      <td>
                        <span className={`wc-pill ${u.status === 'active' ? 'active' : 'inactive'}`}>
                          {STATUS_LABELS[u.status] || u.status}
                        </span>
                      </td>
                      <td>
                        {u.emailVerified
                          ? <Check size={15} className="wc-usr-verified" aria-label="Email verified" />
                          : <span className="wc-usr-muted">—</span>}
                      </td>
                      <td
                        className="wc-usr-muted"
                        title={u.updatedAt ? `Last updated ${formatDate(u.updatedAt)}` : undefined}
                      >
                        {formatDate(u.createdAt)}
                      </td>
                      <td className="wc-usr-actions-cell">{renderActions(u, isSelf)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {!error && totalPages > 1 && (
        <div className="wc-usr-pagination">
          <button
            disabled={filters.page <= 1}
            onClick={() => patchFilters({ page: filters.page - 1 })}
            aria-label="Previous page"
          >
            <ChevronLeft size={15} />
          </button>
          <span>Page {pagination.page} of {totalPages}</span>
          <button
            disabled={filters.page >= totalPages}
            onClick={() => patchFilters({ page: filters.page + 1 })}
            aria-label="Next page"
          >
            <ChevronRight size={15} />
          </button>
        </div>
      )}

      {!error && items.length > 0 && (
        <div className="wc-usr-hint">
          Account status is the only thing an admin can change here. Role is shown for reference and
          can be filtered, but is not managed from this screen. You cannot change your own status.
        </div>
      )}
    </div>
  );
}