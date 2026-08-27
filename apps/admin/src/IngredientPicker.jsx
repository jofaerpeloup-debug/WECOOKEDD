import { useEffect, useRef, useState } from 'react';
import { Search, X, AlertCircle } from 'lucide-react';
import { ApiError } from './apiClient.js';
import { listIngredients } from './ingredientApi.js';

// ---------------------------------------------------------------------------
// Canonical ingredient picker.
//
// Recipes and substitutions both reference canonical Ingredients by public id.
// The admin never types a Mongo id — this combobox searches the Ingredient REST
// API by name and hands back a { id, name } pair. `SubstitutionsTab.jsx` still
// carries its own inline equivalent from an earlier slice; unifying the two is
// deferred low-risk cleanup (it would mean editing a shipped slice).
//
// The `.wc-ipick-*` styling lives in the consuming tab's <style> block
// (RecipesTab.jsx) so multiple mounted instances don't each emit a <style>.
//
// `searchStatus` controls which ingredients the search offers:
//   - 'active' (default) — recipe create / ingredient-array replacement,
//     because the backend rejects a recipe that references an archived
//     ingredient on create, on any ingredients-array replacement, and on
//     reactivation (RECIPE_INGREDIENT_INACTIVE / RECIPE_INGREDIENT_NOT_FOUND).
//   - 'all' — list filters, so an admin can narrow a view to a specific
//     archived ingredient. Archived hits are labelled so the admin is never
//     misled into treating one as an active, selectable choice.
// ---------------------------------------------------------------------------

const PICKER_LIMIT = 10;

function toSafeMessage(err) {
  if (err instanceof ApiError) {
    if (err.isNetworkError) return err.message;
    if (err.isUnauthorized) return 'Your session has expired. Please sign in again.';
    return err.message;
  }
  return 'Something went wrong. Please try again.';
}

export default function IngredientPicker({
  value,
  onChange,
  placeholder = 'Search ingredients…',
  ariaLabel,
  autoFocus = false,
  compact = false,
  disabled = false,
  searchStatus = 'active',
  unavailableLabel = 'Unavailable',
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // Monotonic request id — a slow earlier search must never overwrite a newer
  // result.
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
          limit: PICKER_LIMIT,
        });
        if (cancelled || reqId !== reqIdRef.current) return;
        setResults(ingredients);
        setLoading(false);
      } catch (err) {
        if (cancelled || reqId !== reqIdRef.current) return;
        setResults([]);
        setError(toSafeMessage(err));
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
    const unavailable = value.unavailable === true;
    return (
      <div className={`wc-ipick ${compact ? 'compact' : ''}`}>
        <div className={`wc-ipick-selected ${unavailable ? 'unavailable' : ''}`}>
          <span className="wc-ipick-name">{unavailable ? unavailableLabel : value.name}</span>
          {!disabled && (
            <button
              type="button"
              className="wc-ipick-clear"
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
    <div className={`wc-ipick ${compact ? 'compact' : ''}`}>
      <div className={`wc-ipick-input ${disabled ? 'disabled' : ''}`}>
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
            blurTimerRef.current = setTimeout(() => setOpen(false), 150);
          }}
        />
      </div>

      {open && !disabled && (
        <div className="wc-ipick-menu" role="listbox">
          {loading ? (
            <div className="wc-ipick-note">Searching…</div>
          ) : error ? (
            <div className="wc-ipick-note error">
              <AlertCircle size={13} /> {error}
            </div>
          ) : results.length === 0 ? (
            <div className="wc-ipick-note">
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
                className="wc-ipick-option"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => select(ing)}
              >
                <span>{ing.name}</span>
                {ing.isActive === false && <span className="wc-ipick-opt-tag">archived</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}