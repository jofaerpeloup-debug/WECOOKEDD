import { useCallback, useEffect, useState } from 'react';
import {
  Search, Plus, Pencil, X, Check, AlertCircle, Carrot,
  Archive, ArchiveRestore, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { ApiError } from './apiClient.js';
import {
  listIngredients, createIngredient, updateIngredient, archiveIngredient, restoreIngredient,
} from './ingredientApi.js';
import {
  INGREDIENT_CATEGORIES, INGREDIENT_ALLERGEN_TAGS, INGREDIENT_SORTS,
  INGREDIENT_STATUS_FILTERS, CATEGORY_LABELS, ALLERGEN_LABELS, DEFAULT_CATEGORY,
} from './ingredientOptions.js';

const PAGE_LIMIT = 20;
export const INGREDIENT_FORM_LIMITS = Object.freeze({
  name: 100,
  aliases: 20,
  alias: 100,
});

// Turns any thrown error into one safe, human sentence. Backend `AppError`
// messages are already safe to show; our ApiError network message is ours;
// anything else collapses to a generic line. Mongo internals (E11000, etc.)
// never reach here — the API maps them to stable codes/messages first.
function toMessage(err) {
  if (err instanceof ApiError) {
    if (err.isNetworkError) return err.message;
    if (err.isUnauthorized) return 'Your session has expired. Please sign in again.';
    if (err.isForbidden) {
      return err.message || 'Your account does not have permission to do that.';
    }
    return err.message;
  }
  return 'Something went wrong. Please try again.';
}

function arraysEqual(a = [], b = []) {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

export function analyzeAliases(text = '') {
  const parts = String(text).split(',');
  const entries = parts.map((alias) => alias.trim()).filter(Boolean);
  const aliases = [];
  const seen = new Set();

  for (const entry of entries) {
    // Mirror the service's whitespace normalization and case-insensitive
    // duplicate key while preserving the first-seen spelling/casing.
    const normalized = entry.replace(/\s+/g, ' ');
    const key = normalized.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      aliases.push(normalized);
    }
  }

  return {
    aliases,
    entries,
    duplicateCount: entries.length - aliases.length,
    hasBlankEntries: String(text).trim() !== '' && parts.some((part) => !part.trim()),
  };
}

export function validateIngredientForm(form) {
  const errors = {};
  const name = String(form.name ?? '').trim();
  const aliasAnalysis = analyzeAliases(form.aliasesText);
  const categoryValues = new Set(INGREDIENT_CATEGORIES.map(({ value }) => value));
  const allergenValues = new Set(INGREDIENT_ALLERGEN_TAGS.map(({ value }) => value));

  if (!name) {
    errors.name = 'Ingredient name is required.';
  } else if (name.length > INGREDIENT_FORM_LIMITS.name) {
    errors.name = `Ingredient name must be ${INGREDIENT_FORM_LIMITS.name} characters or fewer.`;
  }

  if (aliasAnalysis.entries.length > INGREDIENT_FORM_LIMITS.aliases) {
    errors.aliases = `You can add up to ${INGREDIENT_FORM_LIMITS.aliases} aliases.`;
  } else if (aliasAnalysis.entries.some((alias) => alias.length > INGREDIENT_FORM_LIMITS.alias)) {
    errors.aliases = `Each alias must be ${INGREDIENT_FORM_LIMITS.alias} characters or fewer.`;
  }

  if (!categoryValues.has(form.category)) errors.category = 'Choose a valid category.';
  if (!Array.isArray(form.allergenTags)
      || form.allergenTags.some((tag) => !allergenValues.has(tag))) {
    errors.allergenTags = 'Choose only supported allergen tags.';
  }
  if (typeof form.isActive !== 'boolean') errors.isActive = 'Choose a valid status.';

  return errors;
}

export function ingredientFormValues(form) {
  return {
    name: String(form.name ?? '').trim(),
    aliases: analyzeAliases(form.aliasesText).aliases,
    category: form.category,
    allergenTags: form.allergenTags,
  };
}

// Maps backend VALIDATION_ERROR details ([{ field, message }]) onto the form's
// fields. Field paths look like "name", "aliases.0", "allergenTags.1".
export function ingredientFieldErrorsFromDetails(details = []) {
  const out = {};
  for (const d of details) {
    const field = String(d.field || '');
    if (field === 'name') out.name = d.message;
    else if (field.startsWith('aliases')) out.aliases = d.message;
    else if (field === 'category') out.category = d.message;
    else if (field.startsWith('allergenTags')) out.allergenTags = d.message;
  }
  return out;
}

export function clearIngredientFieldError(errors, field) {
  const next = { ...errors };
  delete next[field];
  return next;
}

function useIngredients() {
  const [filters, setFilters] = useState({
    search: '',
    category: '',
    allergen: '',
    status: 'active',
    sort: 'nameAsc',
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
        const { ingredients, pagination } = await listIngredients({
          search: filters.search.trim() || undefined,
          category: filters.category || undefined,
          allergen: filters.allergen || undefined,
          status: filters.status,
          sort: filters.sort,
          page: filters.page,
          limit: PAGE_LIMIT,
        });
        if (!cancelled) {
          setState({ items: ingredients, pagination, loading: false, error: null });
        }
      } catch (err) {
        if (!cancelled) {
          setState({ items: [], pagination: null, loading: false, error: toMessage(err) });
        }
      }
    };

    // Debounce so typing in the search box doesn't fire a request per keystroke.
    const timer = setTimeout(run, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [filters, nonce]);

  const create = useCallback(
    async (values) => {
      await createIngredient(values);
      reload();
    },
    [reload],
  );

  const update = useCallback(
    async (id, patch) => {
      await updateIngredient(id, patch);
      reload();
    },
    [reload],
  );

  const archive = useCallback(
    async (id) => {
      await archiveIngredient(id);
      reload();
    },
    [reload],
  );

  const restore = useCallback(
    async (id) => {
      await restoreIngredient(id);
      reload();
    },
    [reload],
  );

  return { filters, patchFilters, ...state, reload, create, update, archive, restore };
}

export default function IngredientsTab({ canWrite = false, onAuthorityLost }) {
  const {
    filters, patchFilters, items, pagination, loading, error,
    reload, create, update, archive, restore,
  } = useIngredients();

  const [modal, setModal] = useState(null); // null | 'new' | ingredient object
  const [confirmArchiveId, setConfirmArchiveId] = useState(null);
  const [rowError, setRowError] = useState(null); // { id, message }

  const totalPages = pagination?.totalPages ?? 1;

  const runRowAction = async (id, action) => {
    setRowError(null);
    try {
      await action();
    } catch (err) {
      if (err instanceof ApiError && err.isForbidden) onAuthorityLost?.();
      setRowError({ id, message: toMessage(err) });
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
        .wc-ing-filters { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
        .wc-ing-select {
          padding: 9px 10px;
          border-radius: 8px;
          border: 1px solid var(--stone-light);
          background: var(--parchment);
          color: var(--ink);
          font-size: 13px;
        }
        .wc-ing-status-line {
          padding: 40px 20px;
          text-align: center;
          color: var(--stone);
          font-size: 13.5px;
        }
        .wc-ing-error {
          display: flex; align-items: center; gap: 8px;
          background: #E9D3CB; color: var(--clay);
          border-radius: 10px;
          padding: 10px 14px;
          font-size: 13px;
          margin-bottom: 16px;
        }
        .wc-ing-aliases { color: var(--stone); font-size: 12.5px; }
        .wc-ing-pagination {
          display: flex; align-items: center; justify-content: flex-end; gap: 12px;
          padding: 14px 4px 0;
          font-size: 13px; color: var(--stone);
        }
        .wc-ing-pagination button {
          display: flex; align-items: center;
          background: var(--parchment);
          border: 1px solid var(--stone-light);
          border-radius: 8px;
          padding: 6px 8px;
          color: var(--ink);
        }
        .wc-ing-pagination button:disabled { opacity: 0.4; cursor: default; }
        .wc-ing-modal-hint { font-size: 11.5px; color: var(--stone); margin-top: 4px; line-height: 1.4; }
        .wc-ing-field-error { color: var(--clay); font-size: 12px; margin-top: 5px; }
        .wc-field input[aria-invalid="true"], .wc-field select[aria-invalid="true"] {
          border-color: var(--clay);
        }
        .wc-ing-archived-note {
          font-size: 12.5px; color: var(--stone); line-height: 1.5;
          background: var(--parchment); border: 1px solid var(--stone-light);
          border-radius: 8px; padding: 10px 12px; margin-bottom: 14px;
        }
      `}</style>

      <div className="wc-topbar">
        <h1>Ingredients</h1>
        <div className="wc-topbar-actions wc-ing-filters">
          {!canWrite && <span className="wc-pill active">Read-only</span>}
          <div className="wc-search">
            <Search size={15} />
            <input
              placeholder="Search name or alias…"
              value={filters.search}
              onChange={(e) => patchFilters({ search: e.target.value })}
            />
          </div>
          <select
            className="wc-ing-select"
            value={filters.category}
            onChange={(e) => patchFilters({ category: e.target.value })}
            aria-label="Filter by category"
          >
            <option value="">All categories</option>
            {INGREDIENT_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          <select
            className="wc-ing-select"
            value={filters.status}
            onChange={(e) => patchFilters({ status: e.target.value })}
            aria-label="Filter by status"
          >
            {INGREDIENT_STATUS_FILTERS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <select
            className="wc-ing-select"
            value={filters.sort}
            onChange={(e) => patchFilters({ sort: e.target.value })}
            aria-label="Sort ingredients"
          >
            {INGREDIENT_SORTS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          {canWrite && (
            <button className="wc-btn-primary" onClick={() => setModal('new')}>
              <Plus size={16} /> Add ingredient
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="wc-ing-error">
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
          <div className="wc-ing-status-line">Loading ingredients…</div>
        ) : items.length === 0 ? (
          <div className="wc-empty">
            <Carrot size={28} />
            <div>
              {filters.search || filters.category || filters.allergen || filters.status !== 'active'
                ? 'No ingredients match these filters.'
                : canWrite
                  ? 'No ingredients yet. Add one to build the catalog.'
                  : 'No ingredients are currently available.'}
            </div>
          </div>
        ) : (
          <table className="wc-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Aliases</th>
                <th>Category</th>
                <th>Allergens</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((ing) => (
                <tr key={ing.id}>
                  <td>{ing.name}</td>
                  <td className="wc-ing-aliases">
                    {ing.aliases && ing.aliases.length > 0 ? ing.aliases.join(', ') : '—'}
                  </td>
                  <td>{CATEGORY_LABELS[ing.category] || ing.category}</td>
                  <td>
                    {ing.allergenTags && ing.allergenTags.length > 0
                      ? ing.allergenTags.map((t) => (
                          <span className="wc-tag" key={t}>{ALLERGEN_LABELS[t] || t}</span>
                        ))
                      : '—'}
                  </td>
                  <td>
                    <span className={`wc-pill ${ing.isActive ? 'active' : 'inactive'}`}>
                      {ing.isActive ? 'Active' : 'Archived'}
                    </span>
                  </td>
                  <td>
                    {!canWrite ? null : rowError && rowError.id === ing.id ? (
                      <div className="wc-confirm-row">
                        <span style={{ color: 'var(--clay)' }}>{rowError.message}</span>
                        <button className="wc-confirm-no" onClick={() => setRowError(null)}>
                          Dismiss
                        </button>
                      </div>
                    ) : confirmArchiveId === ing.id ? (
                      <div className="wc-confirm-row">
                        <span>Archive?</span>
                        <button
                          className="wc-confirm-yes"
                          onClick={async () => {
                            await runRowAction(ing.id, () => archive(ing.id));
                            setConfirmArchiveId(null);
                          }}
                        >
                          Yes
                        </button>
                        <button className="wc-confirm-no" onClick={() => setConfirmArchiveId(null)}>
                          No
                        </button>
                      </div>
                    ) : (
                      <div className="wc-row-actions">
                        <button
                          className="wc-icon-btn"
                          onClick={() => setModal(ing)}
                          aria-label={`Edit ${ing.name}`}
                        >
                          <Pencil size={15} />
                        </button>
                        {ing.isActive ? (
                          <button
                            className="wc-icon-btn danger"
                            onClick={() => { setRowError(null); setConfirmArchiveId(ing.id); }}
                            aria-label={`Archive ${ing.name}`}
                          >
                            <Archive size={15} />
                          </button>
                        ) : (
                          <button
                            className="wc-icon-btn"
                            onClick={() => runRowAction(ing.id, () => restore(ing.id))}
                            aria-label={`Restore ${ing.name}`}
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

      {!error && totalPages > 1 && (
        <div className="wc-ing-pagination">
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

      {canWrite && modal && (
        <IngredientModal
          ingredient={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSubmit={handleSubmit}
          onAuthorityLost={onAuthorityLost}
        />
      )}
    </div>
  );
}

export function IngredientModal({ ingredient, onClose, onSubmit, onAuthorityLost }) {
  const editing = Boolean(ingredient);

  const [form, setForm] = useState(() => ({
    name: ingredient?.name || '',
    aliasesText: (ingredient?.aliases || []).join(', '),
    category: ingredient?.category || DEFAULT_CATEGORY,
    allergenTags: ingredient?.allergenTags || [],
    isActive: ingredient ? ingredient.isActive : true,
  }));
  const [formError, setFormError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const aliasAnalysis = analyzeAliases(form.aliasesText);
  const canonicalNameLength = form.name.trim().length;

  const clearFieldError = (field) => {
    setFieldErrors((errors) => clearIngredientFieldError(errors, field));
  };

  const toggleAllergen = (tag) => {
    clearFieldError('allergenTags');
    setForm((f) => ({
      ...f,
      allergenTags: f.allergenTags.includes(tag)
        ? f.allergenTags.filter((t) => t !== tag)
        : [...f.allergenTags, tag],
    }));
  };

  const buildPayload = () => {
    const values = ingredientFormValues(form);

    if (!editing) {
      return values;
    }

    // PATCH: only send what actually changed, so an unchanged submit is a
    // no-op and the API never re-normalizes fields needlessly.
    const patch = {};
    if (values.name !== ingredient.name) patch.name = values.name;
    if (!arraysEqual(values.aliases, ingredient.aliases || [])) patch.aliases = values.aliases;
    if (values.category !== ingredient.category) patch.category = values.category;
    if (!arraysEqual(values.allergenTags, ingredient.allergenTags || [])) {
      patch.allergenTags = values.allergenTags;
    }
    if (form.isActive !== ingredient.isActive) patch.isActive = form.isActive;
    return patch;
  };

  const submit = async (e) => {
    e.preventDefault();
    setFormError('');
    setFieldErrors({});

    const errors = validateIngredientForm(form);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
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
      if (err instanceof ApiError && err.isForbidden) onAuthorityLost?.();
      if (err instanceof ApiError && err.isValidationError) {
        setFieldErrors(ingredientFieldErrorsFromDetails(err.details));
        setFormError('Please fix the highlighted fields.');
      } else {
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
          <h2 className="wc-serif">{editing ? 'Edit ingredient' : 'Add ingredient'}</h2>
          <button className="wc-modal-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {editing && !ingredient.isActive && (
          <div className="wc-ing-archived-note">
            This ingredient is archived — hidden from the app and from recipe/substitution
            pickers, but not deleted. Set its status back to Active to restore it.
          </div>
        )}

        <form onSubmit={submit}>
          <div className="wc-field">
            <label htmlFor="ingredient-name">Name</label>
            <input
              id="ingredient-name"
              value={form.name}
              onChange={(e) => {
                clearFieldError('name');
                setForm({ ...form, name: e.target.value });
              }}
              placeholder="e.g. Butter"
              required
              aria-invalid={Boolean(fieldErrors.name)}
              aria-describedby="ingredient-name-hint ingredient-name-error"
              autoFocus
            />
            <div id="ingredient-name-hint" className="wc-ing-modal-hint">
              {canonicalNameLength}/{INGREDIENT_FORM_LIMITS.name} trimmed characters.
            </div>
            {fieldErrors.name && (
              <div id="ingredient-name-error" className="wc-ing-field-error">{fieldErrors.name}</div>
            )}
          </div>

          <div className="wc-field">
            <label htmlFor="ingredient-aliases">Aliases</label>
            <input
              id="ingredient-aliases"
              value={form.aliasesText}
              onChange={(e) => {
                clearFieldError('aliases');
                setForm({ ...form, aliasesText: e.target.value });
              }}
              placeholder="e.g. sweet cream butter, unsalted butter"
              aria-invalid={Boolean(fieldErrors.aliases)}
              aria-describedby="ingredient-aliases-hint ingredient-aliases-error"
            />
            <div id="ingredient-aliases-hint" className="wc-ing-modal-hint">
              Separate with commas. {aliasAnalysis.entries.length}/{INGREDIENT_FORM_LIMITS.aliases}{' '}
              entries; {INGREDIENT_FORM_LIMITS.alias} characters each. Blank entries are ignored.
              {aliasAnalysis.duplicateCount > 0 && (
                <> {aliasAnalysis.duplicateCount} case-insensitive duplicate{aliasAnalysis.duplicateCount === 1 ? '' : 's'} will be removed, keeping the first spelling.</>
              )}
            </div>
            {fieldErrors.aliases && (
              <div id="ingredient-aliases-error" className="wc-ing-field-error">{fieldErrors.aliases}</div>
            )}
          </div>

          <div className="wc-field">
            <label htmlFor="ingredient-category">Category</label>
            <select
              id="ingredient-category"
              value={form.category}
              onChange={(e) => {
                clearFieldError('category');
                setForm({ ...form, category: e.target.value });
              }}
              aria-invalid={Boolean(fieldErrors.category)}
            >
              {INGREDIENT_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
            {fieldErrors.category && (
              <div className="wc-ing-field-error">{fieldErrors.category}</div>
            )}
          </div>

          <div className="wc-field">
            <label>Allergen tags</label>
            <div className="wc-chip-group">
              {INGREDIENT_ALLERGEN_TAGS.map((tag) => (
                <button
                  type="button"
                  key={tag.value}
                  className={`wc-chip ${form.allergenTags.includes(tag.value) ? 'selected' : ''}`}
                  onClick={() => toggleAllergen(tag.value)}
                >
                  {tag.label}
                </button>
              ))}
            </div>
            <div className="wc-ing-modal-hint">
              Set explicitly by an admin — never inferred automatically.
            </div>
            {fieldErrors.allergenTags && (
              <div className="wc-ing-field-error">{fieldErrors.allergenTags}</div>
            )}
          </div>

          {editing && (
            <div className="wc-field">
              <label>Status</label>
              <div className="wc-status-toggle">
                <button
                  type="button"
                  className={form.isActive ? 'selected active-opt' : ''}
                  onClick={() => setForm({ ...form, isActive: true })}
                >
                  Active
                </button>
                <button
                  type="button"
                  className={!form.isActive ? 'selected inactive-opt' : ''}
                  onClick={() => setForm({ ...form, isActive: false })}
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
              <Check size={15} /> {saving ? 'Saving…' : editing ? 'Save changes' : 'Add ingredient'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
