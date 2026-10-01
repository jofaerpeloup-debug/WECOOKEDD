import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Search, Plus, Pencil, X, Check, AlertCircle, Carrot,
  Archive, ArchiveRestore,
} from 'lucide-react';
import { ApiError } from './apiClient.js';
import {
  listIngredients, createIngredient, updateIngredient, archiveIngredient, restoreIngredient,
  findIngredientAliasCollisions,
} from './ingredientApi.js';
import {
  INGREDIENT_CATEGORIES, INGREDIENT_ALLERGEN_TAGS, INGREDIENT_SORTS,
  INGREDIENT_STATUS_FILTERS, CATEGORY_LABELS, ALLERGEN_LABELS, DEFAULT_CATEGORY,
} from './ingredientOptions.js';
import ManagementPagination from './ManagementPagination.jsx';

const PAGE_LIMIT = 20;
const INGREDIENT_CATEGORY_VALUES = new Set(
  INGREDIENT_CATEGORIES.map(({ value }) => value),
);
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

  if (!INGREDIENT_CATEGORY_VALUES.has(form.category)) errors.category = 'Choose a valid category.';
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

export function ingredientAliasCollisionSignature(form, ingredient) {
  const values = ingredientFormValues(form);
  return JSON.stringify({
    name: values.name.toLowerCase().replace(/\s+/gu, ' '),
    aliases: values.aliases.map((alias) => alias.toLowerCase().replace(/\s+/gu, ' ')),
    ingredientId: ingredient?.id || null,
  });
}

function collisionWarningsEqual(left = [], right = []) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function AliasCollisionWarnings({ state }) {
  const warnings = state.warnings || [];
  const stale = Boolean(state.stale);
  return (
    <div id="ingredient-alias-collisions" className="wc-ing-collision-region" aria-live="polite">
      {state.status === 'checking' && <div className="wc-ing-modal-hint">Checking catalog alias conflicts…</div>}
      {state.status === 'unavailable' && (
        <div className="wc-ing-collision-unavailable">
          Alias conflicts could not be checked. You can still save, but review the catalog when the check is available.
        </div>
      )}
      {stale && warnings.length > 0 && (
        <div className="wc-ing-modal-hint">Previously found warnings are stale while the current values are checked.</div>
      )}
      {warnings.map((warning, index) => {
        const self = warning.collisionType === 'SELF_ALIAS_TO_CANONICAL';
        return (
          <div className={self ? 'wc-ing-collision-self' : 'wc-ing-collision-strong'} key={`${warning.alias}:${warning.collisionType}:${index}`}>
            {self ? (
              <><strong>{warning.alias}</strong> is the same as this Ingredient&apos;s canonical name and is redundant.</>
            ) : (
              <>
                <strong>{warning.alias}</strong> conflicts with{' '}
                {warning.conflicts.map((conflict, conflictIndex) => (
                  <span key={`${conflict.ingredientName}:${conflictIndex}`}>
                    {conflictIndex > 0 ? '; ' : ''}
                    {conflict.ingredientName} ({conflict.status === 'active' ? 'Active' : conflict.status === 'archived' ? 'Archived' : 'Status unknown'}, matched by {conflict.matchedOn === 'canonical' ? 'canonical name' : 'alias'})
                  </span>
                ))}
                {warning.truncated && <>; {warning.totalConflicts - warning.conflicts.length} additional owner{warning.totalConflicts - warning.conflicts.length === 1 ? '' : 's'}</>}.
              </>
            )}
          </div>
        );
      })}
    </div>
  );
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

export function ingredientCategoryLabel(category) {
  if (CATEGORY_LABELS[category]) return CATEGORY_LABELS[category];
  if (category === 'other') return 'Other (legacy)';
  return category;
}

export function editableIngredientCategory(category) {
  return INGREDIENT_CATEGORY_VALUES.has(category) ? category : '';
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
      const ingredient = await createIngredient(values);
      reload();
      return ingredient;
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

  useEffect(() => {
    if (!loading && pagination && filters.page > Math.max(pagination.totalPages, 1)) {
      patchFilters({ page: Math.max(pagination.totalPages, 1) });
    }
  }, [filters.page, loading, pagination, patchFilters]);

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
    <div className="wc-management-page">
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
            value={filters.allergen}
            onChange={(e) => patchFilters({ allergen: e.target.value })}
            aria-label="Filter by allergen"
          >
            <option value="">All allergens</option>
            {INGREDIENT_ALLERGEN_TAGS.map((tag) => (
              <option key={tag.value} value={tag.value}>{tag.label}</option>
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

      {!error && !loading && (
        <ManagementPagination pagination={pagination} noun="ingredient" onPageChange={(page) => patchFilters({ page })} />
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
                  <td>{ingredientCategoryLabel(ing.category)}</td>
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

export function ingredientModalInitialForm(ingredient, initialValues) {
  return {
    name: initialValues ? String(initialValues.name ?? '').trim() : ingredient?.name ?? '',
    aliasesText: initialValues ? (initialValues.aliases || []).join(', ') : (ingredient?.aliases || []).join(', '),
    category: initialValues?.category ?? (ingredient ? editableIngredientCategory(ingredient.category) : DEFAULT_CATEGORY),
    allergenTags: initialValues?.allergenTags || ingredient?.allergenTags || [],
    isActive: ingredient ? ingredient.isActive : true,
  };
}

export async function submitIngredientForm({ form, ingredient, onSubmit }) {
  const fieldErrors = validateIngredientForm(form);
  if (Object.keys(fieldErrors).length > 0) return { status: 'validation', fieldErrors };

  const values = ingredientFormValues(form);
  let payload = values;
  if (ingredient) {
    payload = {};
    if (values.name !== ingredient.name) payload.name = values.name;
    if (!arraysEqual(values.aliases, ingredient.aliases || [])) payload.aliases = values.aliases;
    if (values.category !== ingredient.category) payload.category = values.category;
    if (!arraysEqual(values.allergenTags, ingredient.allergenTags || [])) payload.allergenTags = values.allergenTags;
    if (form.isActive !== ingredient.isActive) payload.isActive = form.isActive;
    if (Object.keys(payload).length === 0) return { status: 'unchanged' };
  }

  try {
    return { status: 'success', ingredient: await onSubmit(payload), payload };
  } catch (error) {
    return {
      status: 'error',
      error,
      fieldErrors: error instanceof ApiError && error.isValidationError
        ? ingredientFieldErrorsFromDetails(error.details)
        : {},
    };
  }
}

function ingredientFormIsUnchanged(form, ingredient) {
  if (!ingredient) return false;
  const values = ingredientFormValues(form);
  return values.name === ingredient.name
    && arraysEqual(values.aliases, ingredient.aliases || [])
    && values.category === ingredient.category
    && arraysEqual(values.allergenTags, ingredient.allergenTags || [])
    && form.isActive === ingredient.isActive;
}

export function ingredientSubmitErrorMessage(error, editing = false) {
  if (!editing && error instanceof ApiError && error.code === 'INGREDIENT_ALREADY_EXISTS') {
    return 'An Ingredient with this name already exists. Review the Ingredient catalog, including archived records.';
  }
  return toMessage(error);
}

export function IngredientModal({ ingredient, initialValues, sourceContext, onClose, onSubmit, onSuccess, onAuthorityLost }) {
  const editing = Boolean(ingredient);

  const [form, setForm] = useState(() => ingredientModalInitialForm(ingredient, initialValues));
  const [formError, setFormError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const dialogRef = useRef(null);
  const collisionGenerationRef = useRef(0);
  const collisionOverrideRef = useRef(null);
  const [collisionState, setCollisionState] = useState({ status: 'idle', signature: null, warnings: [], stale: false });
  const aliasAnalysis = analyzeAliases(form.aliasesText);
  const canonicalNameLength = form.name.trim().length;
  const collisionSignature = ingredientAliasCollisionSignature(form, ingredient);
  const collisionInputValid = !validateIngredientForm(form).name && !validateIngredientForm(form).aliases;

  useEffect(() => {
    collisionOverrideRef.current = null;
    const generation = ++collisionGenerationRef.current;
    setCollisionState((current) => ({
      ...current,
      status: collisionInputValid ? 'checking' : 'idle',
      signature: null,
      stale: current.warnings.length > 0,
    }));
    if (!collisionInputValid) return undefined;

    const timer = setTimeout(async () => {
      const values = ingredientFormValues(form);
      try {
        const warnings = await findIngredientAliasCollisions({
          name: values.name,
          aliases: values.aliases,
          ingredientId: ingredient?.id,
        });
        if (generation !== collisionGenerationRef.current) return;
        setCollisionState({ status: 'success', signature: collisionSignature, warnings, stale: false });
      } catch (error) {
        if (generation !== collisionGenerationRef.current) return;
        if (error instanceof ApiError && error.isForbidden) onAuthorityLost?.();
        setCollisionState((current) => ({ ...current, status: 'unavailable', signature: collisionSignature, stale: current.warnings.length > 0 }));
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [collisionSignature, collisionInputValid, ingredient?.id, onAuthorityLost]);

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

  const submit = async (e) => {
    e.preventDefault();
    if (savingRef.current) return;
    setFormError('');
    const localErrors = validateIngredientForm(form);
    setFieldErrors(localErrors);
    if (Object.keys(localErrors).length > 0) return;
    if (ingredientFormIsUnchanged(form, ingredient)) {
      onClose();
      return;
    }
    savingRef.current = true;
    setSaving(true);

    const signature = ingredientAliasCollisionSignature(form, ingredient);
    if (collisionOverrideRef.current !== signature) {
      const generation = ++collisionGenerationRef.current;
      const values = ingredientFormValues(form);
      try {
        const warnings = await findIngredientAliasCollisions({
          name: values.name,
          aliases: values.aliases,
          ingredientId: ingredient?.id,
        });
        if (generation !== collisionGenerationRef.current) return;
        const alreadyDisplayed = collisionState.status === 'success'
          && collisionState.signature === signature
          && collisionWarningsEqual(collisionState.warnings, warnings);
        setCollisionState({ status: 'success', signature, warnings, stale: false });
        if (warnings.length > 0 && !alreadyDisplayed) {
          collisionOverrideRef.current = signature;
          savingRef.current = false;
          setSaving(false);
          return;
        }
      } catch (error) {
        if (generation !== collisionGenerationRef.current) return;
        if (error instanceof ApiError && error.isForbidden) onAuthorityLost?.();
        setCollisionState((current) => ({ ...current, status: 'unavailable', signature, stale: current.warnings.length > 0 }));
        collisionOverrideRef.current = signature;
        savingRef.current = false;
        setSaving(false);
        return;
      }
    }
    collisionOverrideRef.current = null;
    const result = await submitIngredientForm({ form, ingredient, onSubmit });
    if (result.status === 'success') {
      onSuccess?.(result.ingredient);
      onClose();
    } else if (result.status === 'unchanged') {
      onClose();
    } else if (result.status === 'validation') {
      setFieldErrors(result.fieldErrors);
    } else {
      const { error } = result;
      if (error instanceof ApiError && error.isForbidden) onAuthorityLost?.();
      setFieldErrors(result.fieldErrors);
      if (error instanceof ApiError && error.isValidationError) {
        setFormError('Please fix the highlighted fields.');
      } else setFormError(ingredientSubmitErrorMessage(error, editing));
    }
    savingRef.current = false;
    setSaving(false);
  };

  const requestClose = () => { if (!savingRef.current) onClose(); };
  const handleDialogKeyDown = (event) => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); requestClose(); return; }
    if (event.key !== 'Tab') return;
    const controls = [...dialogRef.current.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled])')];
    if (!controls.length) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  return (
    <div className={`wc-modal-overlay${sourceContext ? ' wc-author-ingredient-modal' : ''}`} onMouseDown={(event) => { event.stopPropagation(); if (event.target === event.currentTarget) requestClose(); }} onKeyDown={(event) => event.stopPropagation()}>
      <style>{`
        .wc-ing-collision-region { margin-top: 7px; font-size: 12px; line-height: 1.45; }
        .wc-ing-collision-strong, .wc-ing-collision-unavailable {
          color: var(--clay); background: #E9D3CB; border-radius: 7px; padding: 7px 9px; margin-top: 5px;
        }
        .wc-ing-collision-self {
          color: var(--stone); background: var(--parchment); border: 1px solid var(--stone-light);
          border-radius: 7px; padding: 7px 9px; margin-top: 5px;
        }
      `}</style>
      <div ref={dialogRef} className="wc-modal" role="dialog" aria-modal="true" aria-labelledby="ingredient-modal-title" onMouseDown={(event) => event.stopPropagation()} onKeyDown={handleDialogKeyDown}>
        <div className="wc-modal-header">
          <h2 id="ingredient-modal-title" className="wc-serif">{editing ? 'Edit ingredient' : 'Add ingredient'}</h2>
          <button type="button" className="wc-modal-close" disabled={saving} onClick={requestClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {sourceContext && <div className="wc-ing-import-context"><strong>Imported source</strong><span>{sourceContext}</span></div>}

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
              disabled={saving}
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
              disabled={saving}
              value={form.aliasesText}
              onChange={(e) => {
                clearFieldError('aliases');
                setForm({ ...form, aliasesText: e.target.value });
              }}
              placeholder="e.g. sweet cream butter, unsalted butter"
              aria-invalid={Boolean(fieldErrors.aliases)}
              aria-describedby="ingredient-aliases-hint ingredient-aliases-error ingredient-alias-collisions"
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
            <AliasCollisionWarnings state={collisionState} />
          </div>

          <div className="wc-field">
            <label htmlFor="ingredient-category">Category</label>
            {editing && !INGREDIENT_CATEGORY_VALUES.has(ingredient.category) && (
              <div className="wc-ing-modal-hint">
                Current legacy category: {ingredientCategoryLabel(ingredient.category)}. Choose an
                approved category before saving.
              </div>
            )}
            <select
              id="ingredient-category"
              disabled={saving}
              value={form.category}
              onChange={(e) => {
                clearFieldError('category');
                setForm({ ...form, category: e.target.value });
              }}
              aria-invalid={Boolean(fieldErrors.category)}
              required
            >
              {form.category === '' && (
                <option value="" disabled>Choose a category</option>
              )}
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
                  disabled={saving}
                  className={`wc-chip ${form.allergenTags.includes(tag.value) ? 'selected' : ''}`}
                  onClick={() => toggleAllergen(tag.value)}
                >
                  {tag.label}
                </button>
              ))}
            </div>
            <div className="wc-ing-modal-hint">
              Set explicitly by a Moderator — never inferred automatically.
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
                  disabled={saving}
                  className={form.isActive ? 'selected active-opt' : ''}
                  onClick={() => setForm({ ...form, isActive: true })}
                >
                  Active
                </button>
                <button
                  type="button"
                  disabled={saving}
                  className={!form.isActive ? 'selected inactive-opt' : ''}
                  onClick={() => setForm({ ...form, isActive: false })}
                >
                  Archived
                </button>
              </div>
            </div>
          )}

          {formError && (
            <div className="wc-auth-error" role="alert"><AlertCircle size={14} /> {formError}</div>
          )}

          <div className="wc-modal-actions">
            <button type="button" className="wc-btn-secondary" disabled={saving} onClick={requestClose}>
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
