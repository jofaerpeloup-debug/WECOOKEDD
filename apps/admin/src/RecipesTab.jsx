import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Search, Plus, Pencil, X, Check, AlertCircle, ChefHat, Trash2,
  Archive, ArchiveRestore, ChevronLeft, ChevronRight, ChevronUp, ChevronDown,
} from 'lucide-react';
import { ApiError } from './apiClient.js';
import {
  listRecipes, createRecipe, updateRecipe, archiveRecipe, restoreRecipe,
  toIngredientUsagePayload,
} from './recipeApi.js';
import IngredientPicker from './IngredientPicker.jsx';
import {
  RECIPE_DIFFICULTIES, RECIPE_DIETARY_TAGS, RECIPE_UNITS,
  RECIPE_SORTS, RECIPE_STATUS_FILTERS, TO_TASTE_UNIT,
  DIFFICULTY_LABELS, DIETARY_TAG_LABELS,
  DEFAULT_DIFFICULTY, DEFAULT_UNIT,
  SLUG_MAX_LENGTH, SLUG_PATTERN, slugLabel, normalizeSlugInput, slugPatchValue,
  MAX_TITLE_LENGTH, MAX_DESCRIPTION_LENGTH, MAX_PREP_TIME_MINUTES,
  MAX_COOK_TIME_MINUTES, MAX_SERVINGS, MAX_INGREDIENTS, MAX_INSTRUCTIONS,
  MAX_INSTRUCTION_LENGTH, MAX_INGREDIENT_NOTE_LENGTH, MAX_IMAGE_URL_LENGTH,
} from './recipeOptions.js';

const PAGE_LIMIT = 20;

// Turns any thrown error into one safe, human sentence. Backend `AppError`
// messages are already safe to show (the API maps Mongo internals like E11000
// to stable codes/messages first); our ApiError network message is ours;
// anything else collapses to a generic line. Same helper shape as
// IngredientsTab / SubstitutionsTab.
function toMessage(err) {
  if (err instanceof ApiError) {
    if (err.isNetworkError) return err.message;
    if (err.isUnauthorized) return 'Your session has expired. Please sign in again.';
    if (err.isForbidden) {
      return err.message || 'Your account does not have permission to do that.';
    }
    // 404 RECIPE_NOT_FOUND / RECIPE_INGREDIENT_NOT_FOUND, 400
    // RECIPE_INGREDIENT_INACTIVE — all carry a safe backend message.
    return err.message;
  }
  return 'Something went wrong. Please try again.';
}

function arraysEqual(a = [], b = []) {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

// Mirrors RecipeService#collapseWhitespace so an unchanged title does not
// produce a needless PATCH.
function collapseWhitespace(value) {
  return value.trim().replace(/\s+/g, ' ');
}

function isValidUrl(value) {
  try {
    // eslint-disable-next-line no-new
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function isIntInRange(value, min, max) {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max;
}

function isPositiveFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

// Maps backend VALIDATION_ERROR details ([{ field, message }]) onto the form's
// fields. Field paths (see validate.middleware.js) look like "title",
// "description", "ingredients.0.quantity", "instructions.2", "dietaryTags.0".
function fieldErrorsFromDetails(details = []) {
  const out = {};
  for (const d of details) {
    const f = String(d.field || '');
    if (f === 'title') out.title = d.message;
    else if (f === 'description') out.description = d.message;
    else if (f === 'region') out.region = d.message;
    else if (f === 'category') out.category = d.message;
    else if (f === 'difficulty') out.difficulty = d.message;
    else if (f.startsWith('steps')) out.instructions = out.instructions || d.message;
    else if (f === 'prepTimeMinutes') out.prepTimeMinutes = d.message;
    else if (f === 'cookTimeMinutes') out.cookTimeMinutes = d.message;
    else if (f === 'servings') out.servings = d.message;
    else if (f === 'imageUrl') out.imageUrl = d.message;
    else if (f.startsWith('ingredients')) out.ingredients = out.ingredients || d.message;
    else if (f.startsWith('instructions')) out.instructions = out.instructions || d.message;
    else if (f.startsWith('dietaryTags')) out.dietaryTags = d.message;
    else out.form = out.form || d.message;
  }
  return out;
}

let rowKeySeq = 0;
const nextKey = () => `r${(rowKeySeq += 1)}`;

function emptyIngredientRow() {
  return {
    key: nextKey(),
    ingredient: null, // { id, name } | null
    unavailable: false, // true only for an edit-mode entry whose ref no longer resolves
    quantity: '',
    unit: DEFAULT_UNIT,
    note: '',
    optional: false,
  };
}

function ingredientRowsFromRecipe(recipe) {
  if (!recipe || !Array.isArray(recipe.ingredients) || recipe.ingredients.length === 0) {
    return [emptyIngredientRow()];
  }
  return recipe.ingredients.map((entry) => ({
    key: nextKey(),
    ingredient: entry.ingredient ? { id: entry.ingredient.id, name: entry.ingredient.name } : null,
    unavailable: !entry.ingredient,
    quantity: entry.quantity == null ? '' : String(entry.quantity),
    unit: entry.unit,
    note: entry.note ?? '',
    optional: Boolean(entry.optional),
  }));
}

function instructionRowsFromRecipe(recipe) {
  if (!recipe || !Array.isArray(recipe.instructions) || recipe.instructions.length === 0) {
    return [{ key: nextKey(), text: '' }];
  }
  return recipe.instructions.map((text) => ({ key: nextKey(), text }));
}

// Comparable strings for the minimal-patch diff — identical projection applied
// to a live form row and to a stored serializer entry.
function ingredientComparable({ id, quantity, unit, note, optional }) {
  return JSON.stringify({
    id: id ?? null,
    quantity: unit === TO_TASTE_UNIT ? null : (quantity === '' || quantity == null ? null : Number(quantity)),
    unit,
    note: (note ?? '').trim() || null,
    optional: Boolean(optional),
  });
}

function rowComparable(row) {
  return ingredientComparable({
    id: row.ingredient?.id ?? null,
    quantity: row.quantity,
    unit: row.unit,
    note: row.note,
    optional: row.optional,
  });
}

function storedComparable(entry) {
  return ingredientComparable({
    id: entry.ingredient?.id ?? null,
    quantity: entry.quantity,
    unit: entry.unit,
    note: entry.note,
    optional: entry.optional,
  });
}

// ---------------------------------------------------------------------------
// Data hook — server-owned search / filter / sort / pagination
// ---------------------------------------------------------------------------
function useRecipes() {
  const [filters, setFilters] = useState({
    search: '',
    region: '',
    category: '',
    difficulty: '',
    dietaryTag: '',
    maxPrepTimeMinutes: '',
    ingredient: null, // { id, name } | null
    status: 'active',
    sort: 'titleAsc',
    page: 1,
  });
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState({ items: [], pagination: null, loading: true, error: null });

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const patchFilters = useCallback((patch) => {
    setFilters((f) => {
      const next = { ...f, ...patch };
      if (!('page' in patch)) next.page = 1;
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));

    const run = async () => {
      try {
        const maxPrep = filters.maxPrepTimeMinutes.trim();
        const { recipes, pagination } = await listRecipes({
          search: filters.search.trim() || undefined,
          region: normalizeSlugInput(filters.region) || undefined,
          category: normalizeSlugInput(filters.category) || undefined,
          difficulty: filters.difficulty || undefined,
          dietaryTag: filters.dietaryTag || undefined,
          ingredientId: filters.ingredient?.id || undefined,
          maxPrepTimeMinutes: maxPrep === '' ? undefined : Number(maxPrep),
          status: filters.status,
          sort: filters.sort,
          page: filters.page,
          limit: PAGE_LIMIT,
        });
        if (!cancelled) setState({ items: recipes, pagination, loading: false, error: null });
      } catch (err) {
        if (!cancelled) {
          setState({ items: [], pagination: null, loading: false, error: toMessage(err) });
        }
      }
    };

    // Debounce so typing in a text filter doesn't fire a request per keystroke.
    const timer = setTimeout(run, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [filters, nonce]);

  const create = useCallback(async (values) => { await createRecipe(values); reload(); }, [reload]);
  const update = useCallback(async (id, patch) => { await updateRecipe(id, patch); reload(); }, [reload]);
  const archive = useCallback(async (id) => { await archiveRecipe(id); reload(); }, [reload]);
  const restore = useCallback(async (id) => { await restoreRecipe(id); reload(); }, [reload]);

  return { filters, patchFilters, ...state, reload, create, update, archive, restore };
}

// ---------------------------------------------------------------------------
// Tab
// ---------------------------------------------------------------------------
export default function RecipesTab() {
  const {
    filters, patchFilters, items, pagination, loading, error,
    reload, create, update, archive, restore,
  } = useRecipes();

  const [modal, setModal] = useState(null); // null | 'new' | recipe object
  const [confirmArchiveId, setConfirmArchiveId] = useState(null);
  const [rowError, setRowError] = useState(null); // { id, message }
  const [busyRowId, setBusyRowId] = useState(null);
  // Synchronous lock: `busyRowId` is React state and a stale closure could let a
  // phantom double-click fire a second archive/restore before the re-render.
  const rowBusyRef = useRef(false);

  const totalPages = pagination?.totalPages ?? 1;
  const hasFilters = Boolean(
    filters.search || filters.region || filters.category || filters.difficulty || filters.dietaryTag
    || filters.maxPrepTimeMinutes || filters.ingredient || filters.status !== 'active',
  );

  const runRowAction = async (id, action) => {
    if (rowBusyRef.current || busyRowId) return;
    rowBusyRef.current = true;
    setRowError(null);
    setBusyRowId(id);
    try {
      await action();
    } catch (err) {
      setRowError({ id, message: toMessage(err) });
    } finally {
      rowBusyRef.current = false;
      setBusyRowId(null);
    }
  };

  const handleSubmit = async (payload) => {
    if (modal === 'new') await create(payload);
    else await update(modal.id, payload);
  };

  return (
    <div>
      <style>{`
        .wc-rcp-filters { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
        .wc-rcp-select {
          padding: 9px 10px; border-radius: 8px;
          border: 1px solid var(--stone-light);
          background: var(--parchment); color: var(--ink); font-size: 13px;
        }
        .wc-rcp-num {
          width: 130px; padding: 9px 10px; border-radius: 8px;
          border: 1px solid var(--stone-light);
          background: var(--parchment); color: var(--ink); font-size: 13px;
        }
        .wc-rcp-num::placeholder { color: var(--stone); }
        .wc-rcp-status-line { padding: 40px 20px; text-align: center; color: var(--stone); font-size: 13.5px; }
        .wc-rcp-error {
          display: flex; align-items: center; gap: 8px;
          background: #E9D3CB; color: var(--clay);
          border-radius: 10px; padding: 10px 14px; font-size: 13px; margin-bottom: 16px;
        }
        .wc-rcp-muted { color: var(--stone); font-size: 12.5px; }
        .wc-rcp-tags-cell { max-width: 200px; }
        .wc-rcp-count-note { font-size: 11.5px; color: var(--stone); padding: 10px 4px 0; line-height: 1.4; }
        .wc-rcp-pagination {
          display: flex; align-items: center; justify-content: flex-end; gap: 12px;
          padding: 14px 4px 0; font-size: 13px; color: var(--stone);
        }
        .wc-rcp-pagination button {
          display: flex; align-items: center;
          background: var(--parchment); border: 1px solid var(--stone-light);
          border-radius: 8px; padding: 6px 8px; color: var(--ink);
        }
        .wc-rcp-pagination button:disabled { opacity: 0.4; cursor: default; }
        .wc-table .wc-confirm-row button:disabled,
        .wc-table .wc-icon-btn:disabled { opacity: 0.5; cursor: default; }

        .wc-rcp-modal { max-width: 640px; }
        .wc-rcp-modal-hint { font-size: 11.5px; color: var(--stone); margin-top: 4px; line-height: 1.4; }
        .wc-rcp-field-error { color: var(--clay); font-size: 12px; margin-top: 5px; }
        .wc-rcp-archived-note {
          font-size: 12.5px; color: var(--stone); line-height: 1.5;
          background: var(--parchment); border: 1px solid var(--stone-light);
          border-radius: 8px; padding: 10px 12px; margin-bottom: 14px;
        }
        .wc-rcp-section-head {
          display: flex; align-items: center; justify-content: space-between;
          margin: 20px 0 8px;
        }
        .wc-rcp-section-head h3 { font-size: 14px; font-weight: 700; margin: 0; color: var(--sage-deep); }
        .wc-rcp-add-btn {
          display: flex; align-items: center; gap: 5px;
          background: none; border: 1px solid var(--stone-light);
          border-radius: 8px; padding: 6px 10px; font-size: 12.5px; color: var(--ink);
        }
        .wc-rcp-add-btn:hover { background: var(--parchment); }
        .wc-rcp-add-btn:disabled { opacity: 0.45; cursor: default; }

        .wc-rcp-ing {
          border: 1px solid var(--stone-light); border-radius: 10px;
          padding: 12px; margin-bottom: 10px; background: var(--field-bg);
        }
        .wc-rcp-ing-top { display: flex; gap: 8px; align-items: flex-start; }
        .wc-rcp-ing-top .wc-ipick { flex: 1; }
        .wc-rcp-ing-line { display: flex; gap: 8px; align-items: center; margin-top: 8px; flex-wrap: wrap; }
        .wc-rcp-ing-line select, .wc-rcp-ing-line input[type="number"] {
          padding: 8px 9px; border-radius: 8px; border: 1px solid var(--stone-light);
          background: var(--field-bg); color: var(--ink); font-size: 13px;
        }
        .wc-rcp-ing-line select { width: 110px; }
        .wc-rcp-ing-line input[type="number"] { width: 90px; }
        .wc-rcp-ing-totaste { font-size: 12.5px; color: var(--stone); font-style: italic; }
        .wc-rcp-ing-opt { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--ink); }
        .wc-rcp-ing-opt input { width: auto; }
        .wc-rcp-ing-note { width: 100%; margin-top: 8px;
          padding: 8px 9px; border-radius: 8px; border: 1px solid var(--stone-light);
          background: var(--field-bg); color: var(--ink); font-size: 13px;
        }
        .wc-rcp-icon-x {
          background: none; border: none; color: var(--stone); padding: 6px; border-radius: 6px;
          display: flex; flex-shrink: 0;
        }
        .wc-rcp-icon-x:hover { background: #E9D3CB; color: var(--clay); }
        .wc-rcp-icon-x:disabled { opacity: 0.35; cursor: default; }

        .wc-rcp-step { display: flex; gap: 8px; align-items: flex-start; margin-bottom: 8px; }
        .wc-rcp-step-num {
          flex-shrink: 0; width: 22px; height: 34px;
          display: flex; align-items: center; justify-content: center;
          font-size: 12.5px; font-weight: 700; color: var(--stone);
        }
        .wc-rcp-step textarea {
          flex: 1; padding: 8px 10px; border-radius: 8px;
          border: 1px solid var(--stone-light); background: var(--field-bg);
          color: var(--ink); font-family: inherit; font-size: 13px; resize: vertical;
        }
        .wc-rcp-step-actions { display: flex; flex-direction: column; gap: 2px; flex-shrink: 0; }
        .wc-rcp-step-actions button {
          background: none; border: 1px solid var(--stone-light); border-radius: 6px;
          color: var(--stone); padding: 3px; display: flex;
        }
        .wc-rcp-step-actions button:hover { background: var(--parchment); color: var(--ink); }
        .wc-rcp-step-actions button:disabled { opacity: 0.3; cursor: default; }
        .wc-rcp-tag-chips { display: flex; flex-wrap: wrap; gap: 6px; }

        /* Canonical ingredient picker (src/IngredientPicker.jsx) */
        .wc-ipick { position: relative; }
        .wc-ipick.compact { width: 170px; }
        .wc-ipick-input {
          display: flex; align-items: center; gap: 7px;
          padding: 0 10px; border-radius: 8px;
          border: 1px solid var(--stone-light); background: var(--parchment);
        }
        .wc-ipick-input svg { color: var(--stone); flex-shrink: 0; }
        .wc-ipick-input input {
          border: none; background: transparent; outline: none;
          padding: 9px 0; flex: 1; min-width: 0; color: var(--ink); font-size: 13px;
        }
        .wc-ipick-input input::placeholder { color: var(--stone); }
        .wc-ipick-input.disabled { opacity: 0.55; }
        .wc-ipick-selected {
          display: flex; align-items: center; gap: 6px; justify-content: space-between;
          padding: 8px 10px; border-radius: 8px;
          border: 1px solid var(--stone-light); background: var(--parchment);
          font-size: 13px; color: var(--ink);
        }
        .wc-ipick-selected.unavailable { border-style: dashed; color: var(--clay); }
        .wc-ipick-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .wc-ipick-clear {
          background: none; border: none; color: var(--stone);
          display: flex; padding: 2px; flex-shrink: 0;
        }
        .wc-ipick-clear:hover { color: var(--clay); }
        .wc-ipick-menu {
          position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 30;
          background: var(--cream); border: 1px solid var(--stone-light);
          border-radius: 8px; box-shadow: 0 12px 28px rgba(42,47,40,0.18);
          padding: 4px; max-height: 220px; overflow-y: auto;
        }
        .wc-ipick-option {
          display: flex; align-items: center; justify-content: space-between; gap: 8px;
          width: 100%; text-align: left; background: none; border: none;
          padding: 8px 10px; border-radius: 6px; font-size: 13px; color: var(--ink);
        }
        .wc-ipick-option:hover { background: var(--parchment); }
        .wc-ipick-opt-tag {
          flex-shrink: 0; font-size: 10.5px; font-weight: 600;
          text-transform: uppercase; letter-spacing: 0.04em;
          color: var(--clay); background: #E9D3CB; border-radius: 999px; padding: 1px 7px;
        }
        .wc-ipick-note {
          display: flex; align-items: center; gap: 6px;
          padding: 9px 10px; font-size: 12.5px; color: var(--stone);
        }
        .wc-ipick-note.error { color: var(--clay); }
      `}</style>

      <div className="wc-topbar">
        <h1>Recipes</h1>
        <div className="wc-topbar-actions wc-rcp-filters">
          <div className="wc-search">
            <Search size={15} />
            <input
              placeholder="Search title or description…"
              value={filters.search}
              onChange={(e) => patchFilters({ search: e.target.value })}
            />
          </div>
          <input
            className="wc-rcp-num"
            value={filters.region}
            onChange={(e) => patchFilters({ region: e.target.value })}
            placeholder="Region slug…"
            aria-label="Filter by region slug"
          />
          <input
            className="wc-rcp-num"
            value={filters.category}
            onChange={(e) => patchFilters({ category: e.target.value })}
            placeholder="Category slug…"
            aria-label="Filter by category slug"
          />
          <select
            className="wc-rcp-select"
            value={filters.difficulty}
            onChange={(e) => patchFilters({ difficulty: e.target.value })}
            aria-label="Filter by difficulty"
          >
            <option value="">Any difficulty</option>
            {RECIPE_DIFFICULTIES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
          <select
            className="wc-rcp-select"
            value={filters.dietaryTag}
            onChange={(e) => patchFilters({ dietaryTag: e.target.value })}
            aria-label="Filter by dietary tag"
          >
            <option value="">Any dietary tag</option>
            {RECIPE_DIETARY_TAGS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <input
            className="wc-rcp-num"
            type="number"
            min="0"
            max={MAX_PREP_TIME_MINUTES}
            placeholder="Max prep (min)"
            value={filters.maxPrepTimeMinutes}
            onChange={(e) => patchFilters({ maxPrepTimeMinutes: e.target.value })}
            aria-label="Filter by maximum prep time in minutes"
          />
          <IngredientPicker
            value={filters.ingredient}
            onChange={(v) => patchFilters({ ingredient: v })}
            placeholder="Uses ingredient…"
            ariaLabel="Filter by ingredient used"
            searchStatus="all"
            compact
          />
          <select
            className="wc-rcp-select"
            value={filters.status}
            onChange={(e) => patchFilters({ status: e.target.value })}
            aria-label="Filter by status"
          >
            {RECIPE_STATUS_FILTERS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select
            className="wc-rcp-select"
            value={filters.sort}
            onChange={(e) => patchFilters({ sort: e.target.value })}
            aria-label="Sort recipes"
          >
            {RECIPE_SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <button className="wc-btn-primary" onClick={() => setModal('new')}>
            <Plus size={16} /> Add recipe
          </button>
        </div>
      </div>

      {error && (
        <div className="wc-rcp-error">
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
            <div className="wc-rcp-status-line">Loading recipes…</div>
          ) : items.length === 0 ? (
            <div className="wc-empty">
              <ChefHat size={28} />
              <div>
                {hasFilters
                  ? 'No recipes match these filters.'
                  : 'No recipes yet. Add one to build the catalog.'}
              </div>
            </div>
          ) : (
            <table className="wc-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Category</th>
                  <th>Region</th>
                  <th>Difficulty</th>
                  <th>Prep</th>
                  <th>Cook</th>
                  <th>Servings</th>
                  <th>Dietary</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id}>
                    <td>{r.title}</td>
                    <td>{slugLabel(r.category) || <span className="wc-rcp-muted">—</span>}</td>
                    <td>{slugLabel(r.region) || <span className="wc-rcp-muted">—</span>}</td>
                    <td>
                      <span className={`wc-pill ${r.difficulty}`}>
                        {DIFFICULTY_LABELS[r.difficulty] || r.difficulty}
                      </span>
                    </td>
                    <td>{r.prepTimeMinutes}m</td>
                    <td>{r.cookTimeMinutes}m</td>
                    <td>{r.servings}</td>
                    <td className="wc-rcp-tags-cell">
                      {r.dietaryTags && r.dietaryTags.length > 0
                        ? r.dietaryTags.map((t) => (
                            <span className="wc-tag" key={t}>{DIETARY_TAG_LABELS[t] || t}</span>
                          ))
                        : <span className="wc-rcp-muted">—</span>}
                    </td>
                    <td>
                      <span className={`wc-pill ${r.isActive ? 'active' : 'inactive'}`}>
                        {r.isActive ? 'Active' : 'Archived'}
                      </span>
                    </td>
                    <td>
                      {rowError && rowError.id === r.id ? (
                        <div className="wc-confirm-row">
                          <span style={{ color: 'var(--clay)' }}>{rowError.message}</span>
                          <button className="wc-confirm-no" onClick={() => setRowError(null)}>
                            Dismiss
                          </button>
                        </div>
                      ) : confirmArchiveId === r.id ? (
                        <div className="wc-confirm-row">
                          <span>Archive?</span>
                          <button
                            className="wc-confirm-yes"
                            disabled={busyRowId === r.id}
                            onClick={async () => {
                              await runRowAction(r.id, () => archive(r.id));
                              setConfirmArchiveId(null);
                            }}
                          >
                            {busyRowId === r.id ? 'Archiving…' : 'Yes'}
                          </button>
                          <button
                            className="wc-confirm-no"
                            disabled={busyRowId === r.id}
                            onClick={() => setConfirmArchiveId(null)}
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <div className="wc-row-actions">
                          <button
                            className="wc-icon-btn"
                            onClick={() => setModal(r)}
                            aria-label={`Edit ${r.title}`}
                          >
                            <Pencil size={15} />
                          </button>
                          {r.isActive ? (
                            <button
                              className="wc-icon-btn danger"
                              onClick={() => { setRowError(null); setConfirmArchiveId(r.id); }}
                              aria-label={`Archive ${r.title}`}
                            >
                              <Archive size={15} />
                            </button>
                          ) : (
                            <button
                              className="wc-icon-btn"
                              disabled={busyRowId === r.id}
                              onClick={() => runRowAction(r.id, () => restore(r.id))}
                              aria-label={`Restore ${r.title}`}
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
        <div className="wc-rcp-count-note">
          The active view hides any recipe whose required ingredient has since been archived, so a
          page can show fewer than {PAGE_LIMIT} rows and the total can be a slight overcount. Switch
          status to “All” to see and fix those.
        </div>
      )}

      {!error && totalPages > 1 && (
        <div className="wc-rcp-pagination">
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
        <RecipeModal
          recipe={modal === 'new' ? null : modal}
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
function RecipeModal({ recipe, onClose, onSubmit }) {
  const editing = Boolean(recipe);

  const [form, setForm] = useState(() => ({
    title: recipe?.title || '',
    description: recipe?.description || '',
    region: recipe?.region || '',
    category: recipe?.category || '',
    difficulty: recipe?.difficulty || DEFAULT_DIFFICULTY,
    prepTimeMinutes: recipe ? String(recipe.prepTimeMinutes) : '',
    cookTimeMinutes: recipe ? String(recipe.cookTimeMinutes) : '',
    servings: recipe ? String(recipe.servings) : '',
    dietaryTags: recipe?.dietaryTags ? [...recipe.dietaryTags] : [],
    imageUrl: recipe?.imageUrl || '',
    ingredients: ingredientRowsFromRecipe(recipe),
    instructions: instructionRowsFromRecipe(recipe),
    isActive: recipe ? recipe.isActive : true,
  }));
  const [formError, setFormError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);
  // Synchronous lock — see rowBusyRef note above. Prevents a rapid double-click
  // (or Enter + click) from firing two POST/PATCH requests, which for create
  // would produce a duplicate recipe (titles are not unique).
  const submittingRef = useRef(false);

  const setField = (patch) => setForm((f) => ({ ...f, ...patch }));

  const toggleTag = (tag) => {
    setForm((f) => ({
      ...f,
      dietaryTags: f.dietaryTags.includes(tag)
        ? f.dietaryTags.filter((t) => t !== tag)
        : [...f.dietaryTags, tag],
    }));
  };

  // --- ingredient rows ---
  const patchIngredient = (key, patch) => {
    setForm((f) => ({
      ...f,
      ingredients: f.ingredients.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    }));
  };
  const addIngredient = () => {
    setForm((f) => (f.ingredients.length >= MAX_INGREDIENTS
      ? f
      : { ...f, ingredients: [...f.ingredients, emptyIngredientRow()] }));
  };
  const removeIngredient = (key) => {
    setForm((f) => (f.ingredients.length <= 1
      ? f
      : { ...f, ingredients: f.ingredients.filter((row) => row.key !== key) }));
  };

  // --- instruction rows ---
  const patchInstruction = (key, text) => {
    setForm((f) => ({
      ...f,
      instructions: f.instructions.map((row) => (row.key === key ? { ...row, text } : row)),
    }));
  };
  const addInstruction = () => {
    setForm((f) => (f.instructions.length >= MAX_INSTRUCTIONS
      ? f
      : { ...f, instructions: [...f.instructions, { key: nextKey(), text: '' }] }));
  };
  const removeInstruction = (key) => {
    setForm((f) => (f.instructions.length <= 1
      ? f
      : { ...f, instructions: f.instructions.filter((row) => row.key !== key) }));
  };
  const moveInstruction = (index, delta) => {
    setForm((f) => {
      const next = [...f.instructions];
      const target = index + delta;
      if (target < 0 || target >= next.length) return f;
      [next[index], next[target]] = [next[target], next[index]];
      return { ...f, instructions: next };
    });
  };

  // Whether the ingredient section differs from what is stored. When editing an
  // existing recipe and it is unchanged, the PATCH omits `ingredients` entirely
  // (the backend then leaves the stored array untouched) — so an admin can fix
  // an unrelated field on a recipe that references an archived / unresolved
  // ingredient without being forced to rebuild the ingredient list first.
  const ingredientsChanged = !editing
    || !arraysEqual(
      form.ingredients.map(rowComparable),
      (recipe?.ingredients || []).map(storedComparable),
    );

  const validate = () => {
    const errs = {};
    if (!collapseWhitespace(form.title)) errs.title = 'Title is required.';
    else if (collapseWhitespace(form.title).length > MAX_TITLE_LENGTH) {
      errs.title = `Title must be ${MAX_TITLE_LENGTH} characters or fewer.`;
    }
    if (!form.description.trim()) errs.description = 'Description is required.';
    else if (form.description.trim().length > MAX_DESCRIPTION_LENGTH) {
      errs.description = `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`;
    }
    if (!isIntInRange(form.prepTimeMinutes, 0, MAX_PREP_TIME_MINUTES)) {
      errs.prepTimeMinutes = `Whole minutes, 0–${MAX_PREP_TIME_MINUTES}.`;
    }
    if (!isIntInRange(form.cookTimeMinutes, 0, MAX_COOK_TIME_MINUTES)) {
      errs.cookTimeMinutes = `Whole minutes, 0–${MAX_COOK_TIME_MINUTES}.`;
    }
    if (!isIntInRange(form.servings, 1, MAX_SERVINGS)) {
      errs.servings = `Whole number, 1–${MAX_SERVINGS}.`;
    }
    if (form.imageUrl.trim() && !isValidUrl(form.imageUrl.trim())) {
      errs.imageUrl = 'Enter a full URL (https://…) or leave blank.';
    } else if (form.imageUrl.trim().length > MAX_IMAGE_URL_LENGTH) {
      errs.imageUrl = `URL must be ${MAX_IMAGE_URL_LENGTH} characters or fewer.`;
    }

    for (const field of ['region', 'category']) {
      const raw = form[field].trim();
      if (!raw) continue;
      const slug = normalizeSlugInput(raw);
      if (!slug || slug.length > SLUG_MAX_LENGTH || !SLUG_PATTERN.test(slug)) {
        errs[field] = 'Use a lowercase slug — letters, numbers and single hyphens.';
      }
    }

    // Only enforce the per-row rules when the ingredient list is actually
    // going to be sent (always on create; on edit only if it changed).
    if (ingredientsChanged) {
      const ingErrs = [];
      form.ingredients.forEach((row, i) => {
        if (!row.ingredient || row.unavailable) {
          ingErrs.push(`Row ${i + 1}: choose an ingredient.`);
          return;
        }
        if (row.unit !== TO_TASTE_UNIT && !isPositiveFiniteNumber(row.quantity)) {
          ingErrs.push(`Row ${i + 1}: quantity must be a number greater than zero.`);
        }
        if ((row.note ?? '').trim().length > MAX_INGREDIENT_NOTE_LENGTH) {
          ingErrs.push(`Row ${i + 1}: note must be ${MAX_INGREDIENT_NOTE_LENGTH} characters or fewer.`);
        }
      });
      if (ingErrs.length > 0) errs.ingredients = ingErrs[0];
    }

    const steps = form.instructions.map((row) => row.text.trim()).filter(Boolean);
    if (steps.length === 0) errs.instructions = 'At least one instruction step is required.';
    else if (steps.some((s) => s.length > MAX_INSTRUCTION_LENGTH)) {
      errs.instructions = `Each step must be ${MAX_INSTRUCTION_LENGTH} characters or fewer.`;
    }

    return errs;
  };

  const buildIngredientPayload = () =>
    form.ingredients.map((row) => toIngredientUsagePayload({
      ingredientId: row.ingredient.id,
      unit: row.unit,
      optional: row.optional,
      quantity: row.quantity,
      note: row.note,
    }));

  const buildPayload = () => {
    const title = collapseWhitespace(form.title);
    const description = form.description.trim();
    const prepTimeMinutes = Number(form.prepTimeMinutes);
    const cookTimeMinutes = Number(form.cookTimeMinutes);
    const servings = Number(form.servings);
    const dietaryTags = [...new Set(form.dietaryTags)];
    const imageUrl = form.imageUrl.trim() || null;
    const instructions = form.instructions.map((row) => row.text.trim()).filter(Boolean);
    const region = normalizeSlugInput(form.region);
    const category = normalizeSlugInput(form.category);

    if (!editing) {
      const payload = {
        title, description, difficulty: form.difficulty,
        prepTimeMinutes, cookTimeMinutes, servings,
        ingredients: buildIngredientPayload(), instructions, dietaryTags, imageUrl,
      };
      if (region) payload.region = region;
      if (category) payload.category = category;
      return payload;
    }

    // PATCH: only send fields whose value actually changed vs. the loaded
    // recipe, so an unchanged save is a no-op and the API never re-normalizes
    // or re-validates needlessly. Arrays (ingredients / instructions /
    // dietaryTags) are sent as a complete replacement only when they differ.
    const patch = {};
    if (title !== recipe.title) patch.title = title;
    if (description !== recipe.description) patch.description = description;
    // region/category: an unchanged field is omitted; a populated field the
    // admin blanked is sent as `null` (the API unsets it); a changed value is
    // sent as the normalized slug. See slugPatchValue.
    const regionPatch = slugPatchValue(recipe.region, form.region);
    if (regionPatch !== undefined) patch.region = regionPatch;
    const categoryPatch = slugPatchValue(recipe.category, form.category);
    if (categoryPatch !== undefined) patch.category = categoryPatch;
    if (form.difficulty !== recipe.difficulty) patch.difficulty = form.difficulty;
    if (prepTimeMinutes !== recipe.prepTimeMinutes) patch.prepTimeMinutes = prepTimeMinutes;
    if (cookTimeMinutes !== recipe.cookTimeMinutes) patch.cookTimeMinutes = cookTimeMinutes;
    if (servings !== recipe.servings) patch.servings = servings;

    const nextTags = [...dietaryTags].sort();
    const prevTags = [...(recipe.dietaryTags || [])].sort();
    if (!arraysEqual(nextTags, prevTags)) patch.dietaryTags = dietaryTags;

    if (imageUrl !== (recipe.imageUrl ?? null)) patch.imageUrl = imageUrl;

    if (!arraysEqual(instructions, recipe.instructions || [])) patch.instructions = instructions;

    if (ingredientsChanged) patch.ingredients = buildIngredientPayload();

    if (form.isActive !== recipe.isActive) patch.isActive = form.isActive;

    return patch;
  };

  const submit = async (e) => {
    e.preventDefault();
    if (saving || submittingRef.current) return;
    setFormError('');
    setFieldErrors({});

    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      setFormError('Please fix the highlighted fields.');
      return;
    }

    const payload = buildPayload();
    if (editing && Object.keys(payload).length === 0) {
      onClose();
      return;
    }

    submittingRef.current = true;
    setSaving(true);
    try {
      await onSubmit(payload);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.isValidationError) {
        setFieldErrors(fieldErrorsFromDetails(err.details));
        setFormError('Please fix the highlighted fields.');
      } else {
        // RECIPE_INGREDIENT_NOT_FOUND (404), RECIPE_INGREDIENT_INACTIVE (400),
        // RECIPE_NOT_FOUND (404), FORBIDDEN (403) — all carry a safe message.
        setFormError(toMessage(err));
      }
    } finally {
      submittingRef.current = false;
      setSaving(false);
    }
  };

  const hasUnavailable = editing && form.ingredients.some((row) => row.unavailable);

  return (
    <div className="wc-modal-overlay" onClick={onClose}>
      <div className="wc-modal wc-rcp-modal" onClick={(e) => e.stopPropagation()}>
        <div className="wc-modal-header">
          <h2 className="wc-serif">{editing ? 'Edit recipe' : 'Add recipe'}</h2>
          <button className="wc-modal-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        {editing && !recipe.isActive && (
          <div className="wc-rcp-archived-note">
            This recipe is archived — hidden from the app and from the default Active list, but not
            deleted. Set its status back to Active to restore it (every referenced ingredient must
            still be active).
          </div>
        )}
        {hasUnavailable && (
          <div className="wc-rcp-archived-note">
            One or more ingredient references no longer resolve to a canonical ingredient. You can
            still edit other fields, but replace the unavailable rows before changing the ingredient
            list or restoring the recipe.
          </div>
        )}

        <form onSubmit={submit}>
          {fieldErrors.form && (
            <div className="wc-auth-error" style={{ marginBottom: 12 }}>
              <AlertCircle size={14} /> {fieldErrors.form}
            </div>
          )}
          <div className="wc-field">
            <label>Title</label>
            <input
              value={form.title}
              onChange={(e) => setField({ title: e.target.value })}
              placeholder="e.g. Chicken Adobo"
              maxLength={MAX_TITLE_LENGTH + 20}
              autoFocus
            />
            {fieldErrors.title && <div className="wc-rcp-field-error">{fieldErrors.title}</div>}
          </div>

          <div className="wc-field">
            <label>Description</label>
            <textarea
              className="wc-textarea"
              rows={3}
              value={form.description}
              onChange={(e) => setField({ description: e.target.value })}
              placeholder="A short summary of the dish."
            />
            {fieldErrors.description && (
              <div className="wc-rcp-field-error">{fieldErrors.description}</div>
            )}
          </div>

          <div className="wc-field-row">
            <div className="wc-field">
              <label>Region</label>
              <input
                value={form.region}
                onChange={(e) => setField({ region: e.target.value })}
                placeholder="e.g. bicol (optional)"
                maxLength={SLUG_MAX_LENGTH + 20}
              />
              {fieldErrors.region && <div className="wc-rcp-field-error">{fieldErrors.region}</div>}
            </div>
            <div className="wc-field">
              <label>Category</label>
              <input
                value={form.category}
                onChange={(e) => setField({ category: e.target.value })}
                placeholder="e.g. main-dish (optional)"
                maxLength={SLUG_MAX_LENGTH + 20}
              />
              {fieldErrors.category && <div className="wc-rcp-field-error">{fieldErrors.category}</div>}
            </div>
            <div className="wc-field">
              <label>Difficulty</label>
              <select value={form.difficulty} onChange={(e) => setField({ difficulty: e.target.value })}>
                {RECIPE_DIFFICULTIES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
              {fieldErrors.difficulty && (
                <div className="wc-rcp-field-error">{fieldErrors.difficulty}</div>
              )}
            </div>
          </div>
          <div className="wc-rcp-modal-hint">
            Region &amp; category are optional lowercase slugs (letters, numbers, hyphens) — e.g.
            “central-luzon”, “dessert”. There is no fixed list yet; leave blank if unsure.
          </div>

          <div className="wc-field-row">
            <div className="wc-field">
              <label>Prep time (min)</label>
              <input
                type="number" min="0" max={MAX_PREP_TIME_MINUTES}
                value={form.prepTimeMinutes}
                onChange={(e) => setField({ prepTimeMinutes: e.target.value })}
              />
              {fieldErrors.prepTimeMinutes && (
                <div className="wc-rcp-field-error">{fieldErrors.prepTimeMinutes}</div>
              )}
            </div>
            <div className="wc-field">
              <label>Cook time (min)</label>
              <input
                type="number" min="0" max={MAX_COOK_TIME_MINUTES}
                value={form.cookTimeMinutes}
                onChange={(e) => setField({ cookTimeMinutes: e.target.value })}
              />
              {fieldErrors.cookTimeMinutes && (
                <div className="wc-rcp-field-error">{fieldErrors.cookTimeMinutes}</div>
              )}
            </div>
            <div className="wc-field">
              <label>Servings</label>
              <input
                type="number" min="1" max={MAX_SERVINGS}
                value={form.servings}
                onChange={(e) => setField({ servings: e.target.value })}
              />
              {fieldErrors.servings && (
                <div className="wc-rcp-field-error">{fieldErrors.servings}</div>
              )}
            </div>
          </div>

          <div className="wc-field">
            <label>Image URL</label>
            <input
              value={form.imageUrl}
              onChange={(e) => setField({ imageUrl: e.target.value })}
              placeholder="https://example.com/adobo.jpg"
            />
            <div className="wc-rcp-modal-hint">
              Optional. A stored URL reference only — there is no image upload.
            </div>
            {fieldErrors.imageUrl && <div className="wc-rcp-field-error">{fieldErrors.imageUrl}</div>}
          </div>

          <div className="wc-field">
            <label>Dietary tags</label>
            <div className="wc-rcp-tag-chips">
              {RECIPE_DIETARY_TAGS.map((tag) => (
                <button
                  type="button"
                  key={tag.value}
                  className={`wc-chip ${form.dietaryTags.includes(tag.value) ? 'selected' : ''}`}
                  onClick={() => toggleTag(tag.value)}
                >
                  {tag.label}
                </button>
              ))}
            </div>
            <div className="wc-rcp-modal-hint">Set explicitly by an admin — never inferred.</div>
            {fieldErrors.dietaryTags && (
              <div className="wc-rcp-field-error">{fieldErrors.dietaryTags}</div>
            )}
          </div>

          <div className="wc-rcp-section-head">
            <h3>Ingredients</h3>
            <button
              type="button"
              className="wc-rcp-add-btn"
              onClick={addIngredient}
              disabled={form.ingredients.length >= MAX_INGREDIENTS}
            >
              <Plus size={13} /> Add ingredient
            </button>
          </div>
          {fieldErrors.ingredients && (
            <div className="wc-rcp-field-error" style={{ marginBottom: 8 }}>{fieldErrors.ingredients}</div>
          )}
          {form.ingredients.map((row, i) => (
            <div className="wc-rcp-ing" key={row.key}>
              <div className="wc-rcp-ing-top">
                <IngredientPicker
                  value={
                    row.ingredient
                      ? row.ingredient
                      : row.unavailable
                        ? { id: null, name: '', unavailable: true }
                        : null
                  }
                  onChange={(v) => patchIngredient(row.key, { ingredient: v, unavailable: false })}
                  placeholder="Search ingredients…"
                  ariaLabel={`Ingredient ${i + 1}`}
                  unavailableLabel="Original ingredient unavailable — pick a replacement"
                />
                <button
                  type="button"
                  className="wc-rcp-icon-x"
                  onClick={() => removeIngredient(row.key)}
                  disabled={form.ingredients.length <= 1}
                  aria-label={`Remove ingredient ${i + 1}`}
                >
                  <Trash2 size={15} />
                </button>
              </div>
              <div className="wc-rcp-ing-line">
                <select
                  value={row.unit}
                  onChange={(e) => patchIngredient(row.key, { unit: e.target.value })}
                  aria-label={`Unit for ingredient ${i + 1}`}
                >
                  {RECIPE_UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
                </select>
                {row.unit === TO_TASTE_UNIT ? (
                  <span className="wc-rcp-ing-totaste">no quantity — “to taste”</span>
                ) : (
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={row.quantity}
                    onChange={(e) => patchIngredient(row.key, { quantity: e.target.value })}
                    placeholder="Qty"
                    aria-label={`Quantity for ingredient ${i + 1}`}
                  />
                )}
                <label className="wc-rcp-ing-opt">
                  <input
                    type="checkbox"
                    checked={row.optional}
                    onChange={(e) => patchIngredient(row.key, { optional: e.target.checked })}
                  />
                  Optional
                </label>
              </div>
              <input
                className="wc-rcp-ing-note"
                value={row.note}
                onChange={(e) => patchIngredient(row.key, { note: e.target.value })}
                placeholder="Note (optional) — e.g. minced, cut into serving pieces"
                maxLength={MAX_INGREDIENT_NOTE_LENGTH + 20}
              />
            </div>
          ))}

          <div className="wc-rcp-section-head">
            <h3>Instructions</h3>
            <button
              type="button"
              className="wc-rcp-add-btn"
              onClick={addInstruction}
              disabled={form.instructions.length >= MAX_INSTRUCTIONS}
            >
              <Plus size={13} /> Add step
            </button>
          </div>
          {fieldErrors.instructions && (
            <div className="wc-rcp-field-error" style={{ marginBottom: 8 }}>{fieldErrors.instructions}</div>
          )}
          {form.instructions.map((row, i) => (
            <div className="wc-rcp-step" key={row.key}>
              <span className="wc-rcp-step-num">{i + 1}</span>
              <textarea
                rows={2}
                value={row.text}
                onChange={(e) => patchInstruction(row.key, e.target.value)}
                placeholder={`Step ${i + 1}`}
                maxLength={MAX_INSTRUCTION_LENGTH + 50}
              />
              <div className="wc-rcp-step-actions">
                <button
                  type="button"
                  onClick={() => moveInstruction(i, -1)}
                  disabled={i === 0}
                  aria-label={`Move step ${i + 1} up`}
                >
                  <ChevronUp size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => moveInstruction(i, 1)}
                  disabled={i === form.instructions.length - 1}
                  aria-label={`Move step ${i + 1} down`}
                >
                  <ChevronDown size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => removeInstruction(row.key)}
                  disabled={form.instructions.length <= 1}
                  aria-label={`Remove step ${i + 1}`}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}

          {editing && (
            <div className="wc-field" style={{ marginTop: 18 }}>
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
            <div className="wc-auth-error" style={{ marginTop: 14 }}>
              <AlertCircle size={14} /> {formError}
            </div>
          )}

          <div className="wc-modal-actions">
            <button type="button" className="wc-btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="wc-btn-primary" disabled={saving}>
              <Check size={15} /> {saving ? 'Saving…' : editing ? 'Save changes' : 'Add recipe'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}