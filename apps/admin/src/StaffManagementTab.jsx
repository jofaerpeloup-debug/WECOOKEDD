import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, Check, ChevronLeft, ChevronRight, Clock, RefreshCw,
  ShieldCheck, UserMinus, X,
} from 'lucide-react';
import {
  approveModeratorApplication,
  demoteModerator,
  listAllModeratorApplications,
  listModeratorApplications,
  rejectModeratorApplication,
} from './staffApi.js';
import { staffErrorMessage } from './staffErrorMessage.js';
import { classifyApprovedApplications } from './approvedApplicationPolicy.js';

const STATUSES = ['pending', 'approved', 'rejected'];
const PAGE_LIMIT = 20;

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function label(value) {
  if (!value) return 'Unknown';
  return value.charAt(0).toUpperCase() + value.slice(1).replaceAll('_', ' ');
}

function DecisionDialog({ action, application, busy, error, onCancel, onConfirm }) {
  const rejecting = action === 'reject';
  const demoting = action === 'demote';
  const [reason, setReason] = useState('');
  const trimmedReason = reason.trim();

  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [busy, onCancel]);

  function submit(event) {
    event.preventDefault();
    if (rejecting && (!trimmedReason || trimmedReason.length > 500)) return;
    onConfirm(rejecting ? trimmedReason : undefined);
  }

  const name = application.applicant?.name || application.applicant?.email || 'this applicant';
  const title = rejecting ? 'Reject application' : demoting ? 'Demote Moderator' : 'Approve application';
  return (
    <div className="wc-staff-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
      <div className="wc-staff-modal" role="dialog" aria-modal="true" aria-labelledby="staff-dialog-title">
        <button type="button" className="wc-staff-modal-close" onClick={onCancel} disabled={busy} aria-label="Close dialog"><X size={18} /></button>
        <h2 id="staff-dialog-title">{title}</h2>
        <p>
          {rejecting && <>Reject the current Moderator application from <strong>{name}</strong>.</>}
          {demoting && <>Remove Moderator access from <strong>{name}</strong>. Their account will remain active as a normal user.</>}
          {!rejecting && !demoting && <>Approve <strong>{name}</strong> and grant Moderator access?</>}
        </p>
        <form onSubmit={submit}>
          {rejecting && (
            <div className="wc-staff-reason-field">
              <label htmlFor="rejection-reason">Rejection Reason</label>
              <textarea
                id="rejection-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={500}
                rows={5}
                required
                autoFocus
                aria-describedby="rejection-count"
              />
              <span id="rejection-count">{reason.length}/500 characters</span>
            </div>
          )}
          {error && <div className="wc-staff-alert" role="alert"><AlertCircle size={15} /> {error}</div>}
          <div className="wc-staff-modal-actions">
            <button type="button" className="wc-staff-button secondary" onClick={onCancel} disabled={busy}>Cancel</button>
            <button type="submit" className={`wc-staff-button ${rejecting || demoting ? 'danger' : 'primary'}`} disabled={busy || (rejecting && !trimmedReason)}>
              {busy ? 'Working…' : title}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function StaffManagementTab({ onAuthorityLost }) {
  const [status, setStatus] = useState('pending');
  const [page, setPage] = useState(1);
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState({ applications: [], pagination: null, loading: true, error: '' });
  const [dialog, setDialog] = useState(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(() => setNonce((value) => value + 1), []);
  const requestPage = status === 'approved' ? 1 : page;

  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ ...current, loading: true, error: '' }));
    const request = status === 'approved'
      ? listAllModeratorApplications({ status: 'approved' })
      : listModeratorApplications({ status, page: requestPage, limit: PAGE_LIMIT });
    request
      .then(({ applications, pagination }) => {
        if (!cancelled) setState({ applications, pagination, loading: false, error: '' });
      })
      .catch((error) => {
        if (cancelled) return;
        if (error?.isForbidden && typeof onAuthorityLost === 'function') onAuthorityLost();
        setState((current) => ({ ...current, loading: false, error: staffErrorMessage(error) }));
      });
    return () => { cancelled = true; };
  }, [status, requestPage, nonce, onAuthorityLost]);

  function changeStatus(nextStatus) {
    setStatus(nextStatus);
    setPage(1);
    setNotice('');
  }

  async function confirmAction(reason) {
    if (!dialog || actionBusy) return;
    setActionBusy(true);
    setActionError('');
    try {
      if (dialog.action === 'approve') await approveModeratorApplication(dialog.application.id);
      if (dialog.action === 'reject') await rejectModeratorApplication(dialog.application.id, reason);
      if (dialog.action === 'demote') await demoteModerator(dialog.application.applicant.id);
      setNotice(
        dialog.action === 'approve' ? 'Moderator application approved.'
          : dialog.action === 'reject' ? 'Moderator application rejected.'
            : 'Moderator access removed.',
      );
      setDialog(null);
      refresh();
    } catch (error) {
      setActionError(staffErrorMessage(error));
      if (['MODERATOR_APPLICATION_NOT_PENDING', 'MODERATOR_APPLICATION_NOT_ELIGIBLE', 'MODERATOR_TARGET_INVALID'].includes(error?.code)) refresh();
      if (error?.isForbidden && typeof onAuthorityLost === 'function') onAuthorityLost();
    } finally {
      setActionBusy(false);
    }
  }

  const approvedRows = useMemo(
    () => status === 'approved' ? classifyApprovedApplications(state.applications) : [],
    [status, state.applications],
  );
  const totalItems = status === 'approved'
    ? state.applications.length
    : state.pagination?.total || 0;
  const totalPages = status === 'approved'
    ? Math.max(1, Math.ceil(totalItems / PAGE_LIMIT))
    : state.pagination?.totalPages || 1;
  const rows = status === 'approved'
    ? approvedRows.slice((page - 1) * PAGE_LIMIT, page * PAGE_LIMIT)
    : state.applications.map((application) => ({ application }));

  return (
    <>
      <style>{`
        .wc-staff-toolbar { display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap; margin-bottom:18px; }
        .wc-staff-tabs { display:flex; gap:6px; padding:4px; border-radius:10px; background:var(--parchment); }
        .wc-staff-filter { border:0; background:transparent; color:var(--stone); padding:8px 13px; border-radius:7px; font-weight:600; font-size:13px; }
        .wc-staff-filter.active { background:var(--field-bg); color:var(--sage-deep); box-shadow:0 1px 4px rgba(42,47,40,.12); }
        .wc-staff-button { display:inline-flex; align-items:center; justify-content:center; gap:6px; border-radius:8px; padding:8px 12px; font-weight:600; font-size:12.5px; border:1px solid transparent; }
        .wc-staff-button.primary { background:var(--sage-deep); color:var(--cream); }
        .wc-staff-button.secondary { background:transparent; color:var(--sage-deep); border-color:var(--sage-mid); }
        .wc-staff-button.danger { background:var(--clay); color:white; }
        .wc-staff-button:disabled { opacity:.55; cursor:default; }
        .wc-staff-actions { display:flex; gap:7px; flex-wrap:wrap; }
        .wc-staff-alert, .wc-staff-notice { display:flex; align-items:center; gap:8px; padding:11px 13px; border-radius:9px; margin-bottom:14px; font-size:13px; }
        .wc-staff-alert { color:var(--clay); background:rgba(177,90,62,.1); border:1px solid rgba(177,90,62,.25); }
        .wc-staff-notice { color:var(--sage-deep); background:rgba(192,213,194,.35); border:1px solid var(--sage-light); }
        .wc-staff-person { display:flex; flex-direction:column; gap:2px; min-width:160px; }
        .wc-staff-person span { color:var(--stone); font-size:11.5px; }
        .wc-staff-state { display:inline-flex; align-items:center; gap:5px; font-weight:600; }
        .wc-staff-empty { padding:42px 18px; text-align:center; color:var(--stone); }
        .wc-staff-pagination { display:flex; justify-content:flex-end; align-items:center; gap:10px; margin-top:16px; color:var(--stone); font-size:12.5px; }
        .wc-staff-modal-backdrop { position:fixed; inset:0; z-index:100; display:flex; align-items:center; justify-content:center; padding:20px; background:rgba(22,28,23,.55); }
        .wc-staff-modal { position:relative; width:min(480px, 100%); border-radius:14px; background:var(--cream); color:var(--ink); padding:24px; box-shadow:0 22px 60px rgba(0,0,0,.28); }
        .wc-staff-modal h2 { margin:0 32px 8px 0; font-size:21px; }
        .wc-staff-modal p { margin:0 0 18px; color:var(--stone); line-height:1.5; font-size:13.5px; }
        .wc-staff-modal-close { position:absolute; right:16px; top:16px; border:0; background:transparent; color:var(--stone); padding:5px; }
        .wc-staff-modal-actions { display:flex; justify-content:flex-end; gap:9px; margin-top:18px; }
        .wc-staff-reason-field { display:flex; flex-direction:column; gap:6px; }
        .wc-staff-reason-field label { font-size:12.5px; font-weight:700; color:var(--sage-deep); }
        .wc-staff-reason-field textarea { resize:vertical; border:1px solid var(--stone-light); border-radius:8px; padding:10px; background:var(--field-bg); color:var(--ink); }
        .wc-staff-reason-field span { text-align:right; color:var(--stone); font-size:11.5px; }
        @media (max-width: 900px) { .wc-staff-actions { min-width:180px; } }
      `}</style>
      <div className="wc-topbar">
        <div><h1>Staff Management</h1><div className="wc-topbar-sub">Review Moderator applications and manage approved Moderator access.</div></div>
        <button type="button" className="wc-staff-button secondary" onClick={refresh} disabled={state.loading}><RefreshCw size={14} /> Refresh</button>
      </div>

      <div className="wc-staff-toolbar">
        <div className="wc-staff-tabs" aria-label="Application status filters">
          {STATUSES.map((item) => (
            <button key={item} type="button" className={`wc-staff-filter ${status === item ? 'active' : ''}`} onClick={() => changeStatus(item)} aria-pressed={status === item}>{label(item)}</button>
          ))}
        </div>
        {state.pagination && <span>{totalItems} {status} application{totalItems === 1 ? '' : 's'}</span>}
      </div>

      {notice && <div className="wc-staff-notice" role="status"><Check size={15} /> {notice}</div>}
      {state.error && <div className="wc-staff-alert" role="alert"><AlertCircle size={15} /> {state.error}</div>}

      <div className="wc-table-wrap">
        {state.loading ? <div className="wc-staff-empty">Loading applications…</div>
          : !state.error && rows.length === 0 ? <div className="wc-staff-empty">No {status} applications.</div>
            : !state.error && (
              <table className="wc-table">
                <thead><tr><th>Applicant</th><th>Email</th><th>Role / account</th><th>Applied</th><th>Reviewed</th>{status === 'rejected' && <th>Reason</th>}<th>Actions</th></tr></thead>
                <tbody>
                  {rows.map(({ application, isCurrentAuthority, isHistorical }) => {
                    const applicant = application.applicant;
                    return (
                      <tr key={application.id}>
                        <td><div className="wc-staff-person"><strong>{applicant?.name || 'Unavailable user'}</strong><span className="wc-staff-state">{applicant?.emailVerified ? <Check size={13} /> : <Clock size={13} />}{applicant?.emailVerified ? 'Email verified' : 'Email unverified'}</span></div></td>
                        <td>{applicant?.email || '—'}</td>
                        <td>
                          {status === 'approved' && isHistorical ? (
                            <div className="wc-staff-person"><strong>Historical approval</strong><span>{applicant ? `Current account: ${label(applicant.role)} / ${label(applicant.status)}` : 'Applicant unavailable'}</span></div>
                          ) : applicant ? `${label(applicant.role)} / ${label(applicant.status)}` : 'Unavailable'}
                        </td>
                        <td>{formatDate(application.createdAt)}</td>
                        <td>{formatDate(application.reviewedAt)}</td>
                        {status === 'rejected' && <td>{application.rejectionReason || '—'}</td>}
                        <td>
                          <div className="wc-staff-actions">
                            {status === 'pending' && <>
                              <button type="button" className="wc-staff-button primary" onClick={() => { setActionError(''); setDialog({ action: 'approve', application }); }}><ShieldCheck size={14} /> Approve</button>
                              <button type="button" className="wc-staff-button danger" onClick={() => { setActionError(''); setDialog({ action: 'reject', application }); }}>Reject</button>
                            </>}
                            {status === 'approved' && isCurrentAuthority && (
                              <button type="button" className="wc-staff-button danger" onClick={() => { setActionError(''); setDialog({ action: 'demote', application }); }}><UserMinus size={14} /> Demote Moderator</button>
                            )}
                            {status === 'approved' && !isCurrentAuthority && <span>No demotion action</span>}
                            {status === 'rejected' && <span>No actions</span>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
      </div>

      {state.pagination && totalPages > 1 && (
        <div className="wc-staff-pagination">
          <button type="button" className="wc-staff-button secondary" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1}><ChevronLeft size={14} /> Previous</button>
          <span>Page {page} of {totalPages}</span>
          <button type="button" className="wc-staff-button secondary" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page >= totalPages}>Next <ChevronRight size={14} /></button>
        </div>
      )}

      {dialog && <DecisionDialog action={dialog.action} application={dialog.application} busy={actionBusy} error={actionError} onCancel={() => { if (!actionBusy) setDialog(null); }} onConfirm={confirmAction} />}
    </>
  );
}
