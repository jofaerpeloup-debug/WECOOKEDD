import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Search, Plus, Pencil, X, Check, AlertCircle, Replace,
  Archive, ArchiveRestore, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { ApiError } from './apiClient.js';
import {
  listSubstitutions, createSubstitution, updateSubstitution,
  archiveSubstitution, restoreSubstitution,
} from './substitutionApi.js';
import { listIngredients } from './ingredientApi.js';
import {
  SUBSTITUTION_STATUS_FILTERS, SUBSTITUTION_SORTS,
  MAX_CONTEXTS, MAX_CONTEXT_LENGTH, MAX_NOTES_LENGTH,
} from './substitutionOptions.js';

const PAGE_LIMIT = 20;
const INGREDIENT_PICKER_LIMIT = 10;

// Turns any thrown error into one safe, human sentence. Backend `AppError`
// messages are already safe to show (the API maps Mongo internals like E11000
// to stable codes/messages first); our ApiError network message is ours;
// anything else collapses to a generic line. Same helper shape as
// IngredientsTab.
function toMessage(err) {
  if (err instanceof ApiError) {
    if (err.isNetworkError) return err.message;
    if (err.isUnauthorized) return 'Your session has expired. Please sign in again.';
    if (err.isForbidden) {
      return err.message || 'Your account does not have permission to do that.';
    }
    // 404 / 409 / 400-non-validation all carry a safe backend message.
    return err.message;
  }
  return 'Something went wrong. Please try again.';
}

function arraysEqual(a = [], b = []) {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

// contexts + aliases share the same "comma-separated free text" entry style.
function parseContexts(text) {
  return text
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
}

// Maps backend VALIDATION_ERROR details ([{ field, message }]) onto the form's
// fields. Field paths (see validate.middleware.js) look like
// "sourceIngredientId", "ratio.substituteAmount", "contexts.0", "notes".
function fieldErrorsFromDetails(details = []) {
  const out = {};
  for (const d of details) {
    const field = String(d.field || '');
    if (field === 'sourceIngredientId') out.source = d.message;
    else if (field === 'substituteIngredientId') out.substitute = d.message;
    else if (field.startsWith('ratio')) out.ratio = d.message;
    else if (field.startsWith('contexts')) out.contexts = d.message;
    else if (field === 'notes') out.notes = d.message;
    else out.form = d.message;
  }
  return out;
}

function ratiosEqual(a, b) {
  return a.sourceAmount === b.sourceAmount && a.substituteAmount === b.substituteAmount;
}

function formatRatio(ratio) {
  if (!ratio) return '—';
  return `${ratio.sourceAmount} : ${ratio.substituteAmount}`;
}

// A finite number strictly greater than zero — mirrors the backend
// ratioAmountSchema so the admin gets immediate feedback, without changing the
// authoritative check.
function isPositiveAmount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

// ---------------------------------------------------------------------------
// Ingredient picker
//
// Substitutions reference canonical Ingredients by public id. The admin never
// types a Mongo id — this combobox searches the Ingredient REST API by name
// and hands back a { id, name } pair. In edit mode the current value comes
// straight from the substitution serializer's inlined { id, name }, so no
// fetch is needed to show it.
//
// `searchStatus` controls which ingredients the search offers:
//   - 'active' (default) — create / relationship-replacement, because the
//     backend rejects a substitution that references an archived ingredient
//     on create or reactivation (INGREDIENT_INACTIVE).
//   - 'all' — list filters, so an admin can narrow the Archived / All views to
//     a specific archived ingredient when cleaning those relationships up.
//     Archived hits are labelled so the admin is never misled into thinking
//     one is active.
// ---------------------------------------------------------------------------
function IngredientPicker({
  value,
  onChange,
  placeholder = 'Search ingredients…',
  ariaLabel,
  autoFocus = false,
  compact = false,
  disabled = false,
  searchStatus = 'active',
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // Monotonic request id — a slow earlier search must never overwrite a newer
  // result (same stale-request guard as useSubstitutions below).
  const reqIdRef = useRef(0);
  const blurTimerRef = useRef(null);

  useEffect(() => {
    if (!open || value) return undefined;
    let cancelled = false;
    const reqId = ++reqIdRef.current;
    setLoading(true);
    setError(null);

    const run = async () => {
      try {
        const { ingredients } = await listIngredients({
          search: query.trim() || undefined,
          status: searchStatus,
          sort: 'nameAsc',
          page: 1,
          limit: INGREDIENT_PICKER_LIMIT,
        });
        if (cancelled || reqId !== reqIdRef.current) return;
        setResults(ingredients);
        setLoading(false);
      } catch (err) {
        if (cancelled || reqId !== reqIdRef.current) return;
        setResults([]);
        setError(toMessage(err));
        setLoading(false);
      }
    };

    const timer = setTimeout(run, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, open, value, searchStatus]);

  useEffect(() => () => clearTimeout(blurTimerRef.current), []);

  const select = (ing) => {
    onChange({ id: ing.id, name: ing.name });
    setOpen(false);
    setQuery('');
    setResults([]);
  };

  const clear = () => {
    onChange(null);
    setQuery('');
    setOpen(false);
  };

  if (value) {
    return (
      <div className={`wc-sub-picker ${compact ? 'compact' : ''}`}>
        <div className="wc-sub-picker-selected">
          <span className="wc-sub-picker-name">{value.name}</span>
          {!disabled && (
            <button
              type="button"
              className="wc-sub-picker-clear"
              onClick={clear}
              aria-label={`Clear ${ariaLabel || 'ingredient'}`}
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`wc-sub-picker ${compact ? 'compact' : ''}`}>
      <div className="wc-sub-picker-input">
        <Search size={14} />
        <input
          type="text"
          value={query}
          placeholder={placeholder}
          aria-label={ariaLabel}
          autoFocus={autoFocus}
          disabled={disabled}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onBlur={() => {
            // Delay so an option's onMouseDown/onClick still registers.
            blurTimerRef.current = setTimeout(() => setOpen(false), 150);
          }}
        />
      </div>

      {open && (
        <div className="wc-sub-picker-menu" role="listbox">
          {loading ? (
            <div className="wc-sub-picker-note">Searching…</div>
          ) : error ? (
            <div className="wc-sub-picker-note error">
              <AlertCircle size={13} /> {error}
            </div>
          ) : results.length === 0 ? (
            <div className="wc-sub-picker-note">
              {searchStatus === 'active' ? 'No active ingredients' : 'No ingredients'}
              {query.trim() ? ' match.' : ' found.'}
            </div>
          ) : (
            results.map((ing) => (
              <button
                type="button"
                key={ing.id}
                role="option"
                aria-selected="false"
                className="wc-sub-picker-option"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => select(ing)}
              >
                <span>{ing.name}</span>
                {ing.isActive === false && (
                  <span className="wc-sub-picker-opt-tag">archived</span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Data hook
// ---------------------------------------------------------------------------
function useSubstitutions() {
  const [filters, setFilters] = useState({
    source: null, // { id, name } | null
    substitute: null, // { id, name } | null
    context: '',
    status: 'active',
    sort: 'newest',
    page: 1,
  });
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState({
    items: [],
    pagination: null,
    loading: true,
    error: null,
  });

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
        const { substitutions, pagination } = await listSubstitutions({
          sourceIngredientId: filters.source?.id || undefined,
          substituteIngredientId: filters.substitute?.id || undefined,
          context: filters.context.trim() || undefined,
          status: filters.status,
          sort: filters.sort,
          page: filters.page,
          limit: PAGE_LIMIT,
        });
        if (!cancelled) {
          setState({ items: substitutions, pagination, loading: false, error: null });
        }
      } catch (err) {
        if (!cancelled) {
          setState({ items: [], pagination: null, loading: false, error: toMessage(err) });
        }
      }
    };

    // Debounce so typing in the context box doesn't fire a request per keystroke.
    const timer = setTimeout(run, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [filters, nonce]);

  const create = useCallback(
    async (values) => {
      await createSubstitution(values);
      reload();
    },
    [reload],
  );

  const update = useCallback(
    async (id, patch) => {
      await updateSubstitution(id, patch);
      reload();
    },
    [reload],
  );

  const archive = useCallback(
    async (id) => {
      await archiveSubstitution(id);
      reload();
    },
    [reload],
  );

  const restore = useCallback(
    async (id) => {
      await restoreSubstitution(id);
      reload();
    },
    [reload],
  );

  return { filters, patchFilters, ...state, reload, create, update, archive, restore };
}

// ---------------------------------------------------------------------------
// Tab
// ---------------------------------------------------------------------------
export default function SubstitutionsTab() {
  const {
    filters, patchFilters, items, pagination, loading, error,
    reload, create, update, archive, restore,
  } = useSubstitutions();

  const [modal, setModal] = useState(null); // null | 'new' | substitution object
  const [confirmArchiveId, setConfirmArchiveId] = useState(null);
  const [rowError, setRowError] = useState(null); // { id, message }
  const [busyRowId, setBusyRowId] = useState(null); // a row mutation is in flight

  const totalPages = pagination?.totalPages ?? 1;
  const hasFilters = Boolean(
    filters.source || filters.substitute || filters.context || filters.status !== 'active',
  );

  // Serializes row mutations and blocks a double-submit: a second click while a
  // request is already in flight is ignored rather than firing a duplicate
  // archive/restore.
  const runRowAction = async (id, action) => {
    if (busyRowId) return;
    setRowError(null);
    setBusyRowId(id);
    try {
      await action();
    } catch (err) {
      setRowError({ id, message: toMessage(err) });
    } finally {
      setBusyRowId(null);
    }
  };

  const handleSubmit = async (payload) => {
    if (modal === 'new') {
      await create(payload);
    } else {
      await update(modal.id, payload);
    }
  };

  return (
    <div>
      <style>{`
        .wc-sub-filters { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
        .wc-sub-select {
          padding: 9px 10px;
          border-radius: 8px;
          border: 1px solid var(--stone-light);
          background: var(--parchment);
          color: var(--ink);
          font-size: 13px;
        }
        .wc-sub-context-input {
          padding: 9px 10px;
          border-radius: 8px;
          border: 1px solid var(--stone-light);
          background: var(--parchment);
          color: var(--ink);
          font-size: 13px;
          width: 150px;
        }
        .wc-sub-context-input::placeholder { color: var(--stone); }
        .wc-sub-status-line {
          padding: 40px 20px;
          text-align: center;
          color: var(--stone);
          font-size: 13.5px;
        }
        .wc-sub-error {
          display: flex; align-items: center; gap: 8px;
          background: #E9D3CB; color: var(--clay);
          border-radius: 10px;
          padding: 10px 14px;
          font-size: 13px;
          margin-bottom: 16px;
        }
        .wc-sub-muted { color: var(--stone); font-size: 12.5px; }
        .wc-sub-notes-cell {
          max-width: 260px;
          color: var(--stone);
          font-size: 12.5px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .wc-sub-pagination {
          display: flex; align-items: center; justify-content: flex-end; gap: 12px;
          padding: 14px 4px 0;
          font-size: 13px; color: var(--stone);
        }
        .wc-sub-pagination button {
          display: flex; align-items: center;
          background: var(--parchment);
          border: 1px solid var(--stone-light);
          border-radius: 8px;
          padding: 6px 8px;
          color: var(--ink);
        }
        .wc-sub-pagination button:disabled { opacity: 0.4; cursor: default; }
        .wc-sub-filters .wc-confirm-row button:disabled,
        .wc-table .wc-confirm-row button:disabled,
        .wc-table .wc-icon-btn:disabled { opacity: 0.5; cursor: default; }
        .wc-sub-modal-hint { font-size: 11.5px; color: var(--stone); margin-top: 4px; line-height: 1.4; }
        .wc-sub-field-error { color: var(--clay); font-size: 12px; margin-top: 5px; }
        .wc-sub-archived-note {
          font-size: 12.5px; color: var(--stone); line-height: 1.5;
          background: var(--parchment); border: 1px solid var(--stone-light);
          border-radius: 8px; padding: 10px 12px; margin-bottom: 14px;
        }
        .wc-sub-count-note {
          font-size: 11.5px; color: var(--stone); padding: 10px 4px 0; line-height: 1.4;
        }

        .wc-sub-picker { position: relative; }
        .wc-sub-picker.compact { width: 180px; }
        .wc-sub-picker-input {
          display: flex; align-items: center; gap: 7px;
          padding: 0 10px;
          border-radius: 8px;
          border: 1px solid var(--stone-light);
          background: var(--parchment);
        }
        .wc-sub-picker-input svg { color: var(--stone); flex-shrink: 0; }
        .wc-sub-picker-input input {
          border: none; background: transparent; outline: none;
          padding: 9px 0; flex: 1; min-width: 0; color: var(--ink); font-size: 13px;
        }
        .wc-sub-picker-input input::placeholder { color: var(--stone); }
        .wc-sub-picker-selected {
          display: flex; align-items: center; gap: 6px; justify-content: space-between;
          padding: 8px 10px;
          border-radius: 8px;
          border: 1px solid var(--stone-light);
          background: var(--parchment);
          font-size: 13px; color: var(--ink);
        }
        .wc-sub-picker-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .wc-sub-picker-clear {
          background: none; border: none; color: var(--stone); display: flex; padding: 2px; flex-shrink: 0;
        }
        .wc-sub-picker-clear:hover { color: var(--clay); }
        .wc-sub-picker-menu {
          position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 30;
          background: var(--cream);
          border: 1px solid var(--stone-light);
          border-radius: 8px;
          box-shadow: 0 12px 28px rgba(42,47,40,0.18);
          padding: 4px;
          max-height: 230px; overflow-y: auto;
        }
        .wc-sub-picker-option {
          display: flex; align-items: center; justify-content: space-between; gap: 8px;
          width: 100%; text-align: left;
          background: none; border: none;
          padding: 8px 10px; border-radius: 6px;
          font-size: 13px; color: var(--ink);
        }
        .wc-sub-picker-option:hover { background: var(--parchment); }
        .wc-sub-picker-opt-tag {
          flex-shrink: 0;
          font-size: 10.5px; font-weight: 600;
          text-transform: uppercase; letter-spacing: 0.04em;
          color: var(--clay);
          background: #E9D3CB;
          border-radius: 999px;
          padding: 1px 7px;
        }
        .wc-sub-picker-note {
          display: flex; align-items: center; gap: 6px;
          padding: 9px 10px; font-size: 12.5px; color: var(--stone);
        }
        .wc-sub-picker-note.error { color: var(--clay); }
        .wc-sub-ratio-row { display: flex; gap: 12px; align-items: flex-end; }
        .wc-sub-ratio-row .wc-field { flex: 1; margin-bottom: 0; }
        .wc-sub-ratio-sep { padding: 0 2px 10px; color: var(--stone); font-weight: 600; }
      `}</style>

      <div className="wc-topbar">
        <h1>Substitutions</h1>
        <div className="wc-topbar-actions wc-sub-filters">
          <IngredientPicker
            value={filters.source}
            onChange={(v) => patchFilters({ source: v })}
            placeholder="Source ingredient…"
            ariaLabel="Filter by source ingredient"
            searchStatus="all"
            compact
          />
          <IngredientPicker
            value={filters.substitute}
            onChange={(v) => patchFilters({ substitute: v })}
            placeholder="Substitute ingredient…"
            ariaLabel="Filter by substitute ingredient"
            searchStatus="all"
            compact
          />
          <input
            className="wc-sub-context-input"
            placeholder="Context…"
            value={filters.context}
            onChange={(e) => patchFilters({ context: e.target.value })}
            aria-label="Filter by context"
          />
          <select
            className="wc-sub-select"
            value={filters.status}
            onChange={(e) => patchFilters({ status: e.target.value })}
            aria-label="Filter by status"
          >
            {SUBSTITUTION_STATUS_FILTERS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <select
            className="wc-sub-select"
            value={filters.sort}
            onChange={(e) => patchFilters({ sort: e.target.value })}
            aria-label="Sort substitutions"
          >
            {SUBSTITUTION_SORTS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <button className="wc-btn-primary" onClick={() => setModal('new')}>
            <Plus size={16} /> Add substitution
          </button>
        </div>
      </div>

      {error && (
        <div className="wc-sub-error">
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
            <div className="wc-sub-status-line">Loading substitutions…</div>
          ) : items.length === 0 ? (
            <div className="wc-empty">
              <Replace size={28} />
              <div>
                {hasFilters
                  ? 'No substitutions match these filters.'
                  : 'No substitutions yet. Add one to describe how an ingredient can be swapped.'}
              </div>
            </div>
          ) : (
            <table className="wc-table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Substitute</th>
                  <th>Ratio</th>
                  <th>Contexts</th>
                  <th>Notes</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((sub) => (
                  <tr key={sub.id}>
                    <td>
                      {sub.sourceIngredient?.name || (
                        <span className="wc-sub-muted">Unavailable</span>
                      )}
                    </td>
                    <td>
                      {sub.substituteIngredient?.name || (
                        <span className="wc-sub-muted">Unavailable</span>
                      )}
                    </td>
                    <td>{formatRatio(sub.ratio)}</td>
                    <td className="wc-sub-muted">
                      {sub.contexts && sub.contexts.length > 0 ? sub.contexts.join(', ') : '—'}
                    </td>
                    <td className="wc-sub-notes-cell" title={sub.notes || ''}>
                      {sub.notes || '—'}
                    </td>
                    <td>
                      <span className={`wc-pill ${sub.isActive ? 'active' : 'inactive'}`}>
                        {sub.isActive ? 'Active' : 'Archived'}
                      </span>
                    </td>
                    <td>
                      {rowError && rowError.id === sub.id ? (
                        <div className="wc-confirm-row">
                          <span style={{ color: 'var(--clay)' }}>{rowError.message}</span>
                          <button className="wc-confirm-no" onClick={() => setRowError(null)}>
                            Dismiss
                          </button>
                        </div>
                      ) : confirmArchiveId === sub.id ? (
                        <div className="wc-confirm-row">
                          <span>Archive?</span>
                          <button
                            className="wc-confirm-yes"
                            disabled={busyRowId === sub.id}
                            onClick={async () => {
                              await runRowAction(sub.id, () => archive(sub.id));
                              setConfirmArchiveId(null);
                            }}
                          >
                            {busyRowId === sub.id ? 'Archiving…' : 'Yes'}
                          </button>
                          <button
                            className="wc-confirm-no"
                            disabled={busyRowId === sub.id}
                            onClick={() => setConfirmArchiveId(null)}
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <div className="wc-row-actions">
                          <button
                            className="wc-icon-btn"
                            onClick={() => setModal(sub)}
                            aria-label="Edit substitution"
                          >
                            <Pencil size={15} />
                          </button>
                          {sub.isActive ? (
                            <button
                              className="wc-icon-btn danger"
                              onClick={() => { setRowError(null); setConfirmArchiveId(sub.id); }}
                              aria-label="Archive substitution"
                            >
                              <Archive size={15} />
                            </button>
                          ) : (
                            <button
                              className="wc-icon-btn"
                              disabled={busyRowId === sub.id}
                              onClick={() => runRowAction(sub.id, () => restore(sub.id))}
                              aria-label="Restore substitution"
                            >
                              <ArchiveRestore size={15} />
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {!error && filters.status === 'active' && items.length > 0 && (
        <div className="wc-sub-count-note">
          The active view hides any substitution whose ingredient has since been archived, so a
          page can show fewer than {PAGE_LIMIT} rows and the total can be a slight overcount. Switch
          status to “All” to see and clean those up.
        </div>
      )}

      {!error && totalPages > 1 && (
        <div className="wc-sub-pagination">
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

      {modal && (
        <SubstitutionModal
          substitution={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSubmit={handleSubmit}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create / edit modal
// ---------------------------------------------------------------------------
function SubstitutionModal({ substitution, onClose, onSubmit }) {
  const editing = Boolean(substitution);

  const [form, setForm] = useState(() => ({
    source: substitution?.sourceIngredient
      ? { id: substitution.sourceIngredient.id, name: substitution.sourceIngredient.name }
      : null,
    substitute: substitution?.substituteIngredient
      ? { id: substitution.substituteIngredient.id, name: substitution.substituteIngredient.name }
      : null,
    // Kept as strings while editing so partial input (e.g. "0.") doesn't fight
    // the user; converted to Number exactly once, at submit.
    sourceAmount: substitution ? String(substitution.ratio.sourceAmount) : '1',
    substituteAmount: substitution ? String(substitution.ratio.substituteAmount) : '',
    contextsText: (substitution?.contexts || []).join(', '),
    notes: substitution?.notes || '',
    isActive: substitution ? substitution.isActive : true,
  }));
  const [formError, setFormError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const setField = (patch) => setForm((f) => ({ ...f, ...patch }));

  const buildPayload = () => {
    const contexts = parseContexts(form.contextsText);
    const notes = form.notes.trim();
    const ratio = {
      sourceAmount: Number(form.sourceAmount),
      substituteAmount: Number(form.substituteAmount),
    };

    if (!editing) {
      return {
        sourceIngredientId: form.source.id,
        substituteIngredientId: form.substitute.id,
        ratio,
        contexts,
        notes,
      };
    }

    // PATCH: only send what actually changed, so an unchanged submit is a
    // no-op and the API never re-normalizes / re-validates fields needlessly.
    const patch = {};
    if (form.source.id !== substitution.sourceIngredient?.id) {
      patch.sourceIngredientId = form.source.id;
    }
    if (form.substitute.id !== substitution.substituteIngredient?.id) {
      patch.substituteIngredientId = form.substitute.id;
    }
    if (!ratiosEqual(ratio, substitution.ratio)) patch.ratio = ratio;
    if (!arraysEqual(contexts, substitution.contexts || [])) patch.contexts = contexts;
    if (notes !== (substitution.notes || '')) patch.notes = notes;
    if (form.isActive !== substitution.isActive) patch.isActive = form.isActive;
    return patch;
  };

  const validate = () => {
    const errs = {};
    if (!form.source) errs.source = 'Choose a source ingredient.';
    if (!form.substitute) errs.substitute = 'Choose a substitute ingredient.';
    if (form.source && form.substitute && form.source.id === form.substitute.id) {
      errs.substitute = 'Source and substitute must be different ingredients.';
    }
    if (!isPositiveAmount(form.sourceAmount) || !isPositiveAmount(form.substituteAmount)) {
      errs.ratio = 'Both ratio amounts must be numbers greater than zero.';
    }
    const contexts = parseContexts(form.contextsText);
    if (contexts.length > MAX_CONTEXTS) {
      errs.contexts = `A maximum of ${MAX_CONTEXTS} contexts is allowed.`;
    } else if (contexts.some((c) => c.length > MAX_CONTEXT_LENGTH)) {
      errs.contexts = `Each context must be ${MAX_CONTEXT_LENGTH} characters or fewer.`;
    }
    if (form.notes.trim().length > MAX_NOTES_LENGTH) {
      errs.notes = `Notes must be ${MAX_NOTES_LENGTH} characters or fewer.`;
    }
    return errs;
  };

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return; // guard against an Enter-key double submit
    setFormError('');
    setFieldErrors({});

    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      return;
    }

    const payload = buildPayload();
    if (editing && Object.keys(payload).length === 0) {
      onClose();
      return;
    }

    setSaving(true);
    try {
      await onSubmit(payload);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.isValidationError) {
        setFieldErrors(fieldErrorsFromDetails(err.details));
        setFormError('Please fix the highlighted fields.');
      } else {
        // 409 duplicate pair, 400 SUBSTITUTION_SAME_INGREDIENT / INGREDIENT_INACTIVE,
        // 404 INGREDIENT_NOT_FOUND — all carry a safe backend message.
        setFormError(toMessage(err));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="wc-modal-overlay" onClick={onClose}>
      <div className="wc-modal" onClick={(e) => e.stopPropagation()}>
        <div className="wc-modal-header">
          <h2 className="wc-serif">{editing ? 'Edit substitution' : 'Add substitution'}</h2>
          <button className="wc-modal-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {editing && !substitution.isActive && (
          <div className="wc-sub-archived-note">
            This substitution is archived — hidden from the app, but not deleted. Set its status
            back to Active to restore it (both ingredients must still be active).
          </div>
        )}

        <form onSubmit={submit}>
          <div className="wc-field">
            <label>Source ingredient</label>
            <IngredientPicker
              value={form.source}
              onChange={(v) => setField({ source: v })}
              placeholder="Search ingredients…"
              ariaLabel="Source ingredient"
            />
            <div className="wc-sub-modal-hint">
              The ingredient a recipe calls for. Only active ingredients can be used.
            </div>
            {fieldErrors.source && <div className="wc-sub-field-error">{fieldErrors.source}</div>}
          </div>

          <div className="wc-field">
            <label>Substitute ingredient</label>
            <IngredientPicker
              value={form.substitute}
              onChange={(v) => setField({ substitute: v })}
              placeholder="Search ingredients…"
              ariaLabel="Substitute ingredient"
            />
            <div className="wc-sub-modal-hint">
              What can be used instead. This relationship is one-directional.
            </div>
            {fieldErrors.substitute && (
              <div className="wc-sub-field-error">{fieldErrors.substitute}</div>
            )}
          </div>

          <div className="wc-field">
            <label>Ratio</label>
            <div className="wc-sub-ratio-row">
              <div className="wc-field">
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={form.sourceAmount}
                  onChange={(e) => setField({ sourceAmount: e.target.value })}
                  aria-label="Source amount"
                  placeholder="1"
                />
              </div>
              <span className="wc-sub-ratio-sep">:</span>
              <div className="wc-field">
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={form.substituteAmount}
                  onChange={(e) => setField({ substituteAmount: e.target.value })}
                  aria-label="Substitute amount"
                  placeholder="0.75"
                />
              </div>
            </div>
            <div className="wc-sub-modal-hint">
              “{form.sourceAmount || '1'} : {form.substituteAmount || '?'}” means use that many parts
              substitute for every {form.sourceAmount || '1'} part source. No unit conversion is applied.
            </div>
            {fieldErrors.ratio && <div className="wc-sub-field-error">{fieldErrors.ratio}</div>}
          </div>

          <div className="wc-field">
            <label>Contexts</label>
            <input
              value={form.contextsText}
              onChange={(e) => setField({ contextsText: e.target.value })}
              placeholder="e.g. baking, frying"
            />
            <div className="wc-sub-modal-hint">
              Separate with commas. Optional — when this swap only applies to certain uses. Max{' '}
              {MAX_CONTEXTS}, {MAX_CONTEXT_LENGTH} characters each.
            </div>
            {fieldErrors.contexts && (
              <div className="wc-sub-field-error">{fieldErrors.contexts}</div>
            )}
          </div>

          <div className="wc-field">
            <label>Notes</label>
            <textarea
              className="wc-textarea"
              rows={3}
              value={form.notes}
              onChange={(e) => setField({ notes: e.target.value })}
              placeholder="Optional guidance, e.g. “Adds a slight fruitiness — best in savoury dishes.”"
            />
            <div className="wc-sub-modal-hint">Optional. Max {MAX_NOTES_LENGTH} characters.</div>
            {fieldErrors.notes && <div className="wc-sub-field-error">{fieldErrors.notes}</div>}
          </div>

          {editing && (
            <div className="wc-field">
              <label>Status</label>
              <div className="wc-status-toggle">
                <button
                  type="button"
                  className={form.isActive ? 'selected active-opt' : ''}
                  onClick={() => setField({ isActive: true })}
                >
                  Active
                </button>
                <button
                  type="button"
                  className={!form.isActive ? 'selected inactive-opt' : ''}
                  onClick={() => setField({ isActive: false })}
                >
                  Archived
                </button>
              </div>
            </div>
          )}

          {formError && (
            <div className="wc-auth-error"><AlertCircle size={14} /> {formError}</div>
          )}

          <div className="wc-modal-actions">
            <button type="button" className="wc-btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="wc-btn-primary" disabled={saving}>
              <Check size={15} />{' '}
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Add substitution'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}