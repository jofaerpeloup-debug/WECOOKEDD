import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Archive, ArchiveRestore, ChefHat, Plus, Search } from 'lucide-react';
import { ApiError } from './apiClient.js';
import { archiveRecipe, listRecipes, restoreRecipe } from './recipeApi.js';
import { archiveRecipeAndRefresh, restoreRecipeAndRefresh } from './recipeCatalogMutations.js';
import IngredientPicker from './IngredientPicker.jsx';
import {
  DIETARY_TAG_LABELS, DIFFICULTY_LABELS, MAX_PREP_TIME_MINUTES,
  RECIPE_DIETARY_TAGS, RECIPE_DIFFICULTIES, RECIPE_SORTS, RECIPE_STATUS_FILTERS,
  normalizeSlugInput, slugLabel,
} from './recipeOptions.js';
import RecipeAuthoringWizard from './recipeAuthoring/RecipeAuthoringWizard.jsx';
import RecipeDetailsModal from './recipeAuthoring/RecipeDetailsModal.jsx';
import { formatDuration, statusLabel } from './recipeAuthoring/recipeAuthoringModel.js';
import ManagementPagination from './ManagementPagination.jsx';

const PAGE_LIMIT = 20;
function message(error) {
  if (error instanceof ApiError) {
    if (error.isUnauthorized) return 'Your session has expired. Please sign in again.';
    return error.message;
  }
  return 'Something went wrong. Please try again.';
}

function useRecipes() {
  const [filters, setFilters] = useState({ search: '', region: '', category: '', difficulty: '', dietaryTag: '', maxPrepTimeMinutes: '', ingredient: null, status: 'active', sort: 'titleAsc', page: 1 });
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState({ items: [], pagination: null, loading: true, error: '' });
  const reload = useCallback(() => setNonce((value) => value + 1), []);
  const patchFilters = useCallback((patch) => setFilters((current) => ({ ...current, ...patch, page: 'page' in patch ? patch.page : 1 })), []);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      setState((current) => ({ ...current, loading: true, error: '' }));
      try {
        const result = await listRecipes({
          search: filters.search.trim() || undefined, region: normalizeSlugInput(filters.region) || undefined,
          category: normalizeSlugInput(filters.category) || undefined, difficulty: filters.difficulty || undefined,
          dietaryTag: filters.dietaryTag || undefined, ingredientId: filters.ingredient?.id || undefined,
          maxPrepTimeMinutes: filters.maxPrepTimeMinutes === '' ? undefined : Number(filters.maxPrepTimeMinutes),
          status: filters.status, sort: filters.sort, page: filters.page, limit: PAGE_LIMIT,
        });
        if (active) setState({ items: result.recipes, pagination: result.pagination, loading: false, error: '' });
      } catch (error) { if (active) setState({ items: [], pagination: null, loading: false, error: message(error) }); }
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [filters, nonce]);
  return { filters, patchFilters, reload, ...state };
}

export default function RecipesTab({ canWrite = false, canUploadRecipeImage = false, onAuthorityLost }) {
  const { filters, patchFilters, reload, items, pagination, loading, error } = useRecipes();
  const [modal, setModal] = useState(null);
  const [confirmArchive, setConfirmArchive] = useState(null);
  const [rowState, setRowState] = useState({ id: null, error: '' });
  const [notice, setNotice] = useState('');
  const rowFlight = useRef(false);
  const opener = useRef(null);
  const open = (value) => { opener.current = document.activeElement; setModal(value); };
  const close = () => { setModal(null); requestAnimationFrame(() => opener.current?.focus?.()); };

  const lifecycle = async (recipe, action) => {
    if (rowFlight.current) return;
    rowFlight.current = true; setRowState({ id: recipe.id, error: '' }); setNotice('');
    try {
      const updated = action === 'archive'
        ? await archiveRecipeAndRefresh(recipe.id, recipe.updatedAt, reload, archiveRecipe)
        : await restoreRecipeAndRefresh(recipe.id, recipe.updatedAt, reload, restoreRecipe);
      setNotice(`${updated.title} is now ${action === 'archive' ? 'archived' : 'restored'}.`);
    } catch (error) {
      if (error instanceof ApiError && error.isForbidden) onAuthorityLost?.();
      setRowState({ id: recipe.id, error: error?.code === 'RECIPE_EDIT_CONFLICT' ? 'This recipe changed. Reload the table and try again.' : message(error) });
    } finally { rowFlight.current = false; setConfirmArchive(null); }
  };

  useEffect(() => {
    if (!loading && pagination && filters.page > Math.max(pagination.totalPages, 1)) {
      patchFilters({ page: Math.max(pagination.totalPages, 1) });
    }
  }, [filters.page, loading, pagination, patchFilters]);

  const emDash = <span className="wc-rcp-muted">—</span>;
  return <div className="wc-management-page">
    <style>{`
      .wc-rcp-filters{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.wc-rcp-select,.wc-rcp-num{padding:9px 10px;border-radius:8px;border:1px solid var(--stone-light);background:var(--parchment);color:var(--ink);font-size:13px}.wc-rcp-num{width:130px}.wc-rcp-muted{color:var(--stone);font-size:12.5px}.wc-rcp-status{padding:40px 20px;text-align:center;color:var(--stone)}.wc-rcp-error,.wc-rcp-notice{display:flex;gap:8px;align-items:center;border-radius:10px;padding:10px 14px;margin-bottom:14px;font-size:13px}.wc-rcp-error{background:#E9D3CB;color:var(--clay)}.wc-rcp-notice{background:var(--sage-light);color:var(--sage-deep)}.wc-rcp-count-note{font-size:12.5px;color:var(--stone);line-height:1.5;margin-bottom:14px}.wc-rcp-pagination{display:flex;justify-content:flex-end;align-items:center;gap:12px;padding-top:14px}.wc-rcp-pagination button{display:flex;padding:6px;border:1px solid var(--stone-light);border-radius:7px;background:var(--parchment)}.wc-rcp-actions{display:flex;gap:6px;align-items:center}.wc-rcp-confirm{max-width:360px;display:flex;gap:7px;align-items:center;flex-wrap:wrap;font-size:12px}.wc-rcp-confirm>span{flex-basis:100%}.wc-rcp-tags{max-width:190px}
      .wc-ipick{position:relative}.wc-ipick.compact{width:170px}.wc-ipick-input,.wc-ipick-selected{display:flex;align-items:center;gap:7px;padding:0 10px;border-radius:8px;border:1px solid var(--stone-light);background:var(--parchment)}.wc-ipick-input input{border:0;background:transparent;outline:0;padding:9px 0;min-width:0;width:100%}.wc-ipick-selected{padding:8px 10px;justify-content:space-between}.wc-ipick-clear{border:0;background:none}.wc-ipick-menu{position:absolute;top:calc(100% + 4px);left:0;right:0;z-index:30;background:var(--cream);border:1px solid var(--stone-light);border-radius:8px;box-shadow:0 12px 28px rgba(42,47,40,.18);padding:4px;max-height:220px;overflow:auto}.wc-ipick-option{display:flex;justify-content:space-between;width:100%;border:0;background:none;padding:8px}.wc-ipick-note{padding:9px;font-size:12px}.wc-ipick-opt-tag{font-size:10px;color:var(--clay)}
    `}</style>
    <div className="wc-topbar"><h1>Recipes</h1><div className="wc-topbar-actions wc-rcp-filters">
      {!canWrite && <span className="wc-pill active">Read-only</span>}
      <div className="wc-search"><Search size={15} /><input placeholder="Search title or description…" value={filters.search} onChange={(e) => patchFilters({ search: e.target.value })} /></div>
      <input className="wc-rcp-num" aria-label="Filter by region slug" placeholder="Region slug…" value={filters.region} onChange={(e) => patchFilters({ region: e.target.value })} />
      <input className="wc-rcp-num" aria-label="Filter by category slug" placeholder="Category slug…" value={filters.category} onChange={(e) => patchFilters({ category: e.target.value })} />
      <select className="wc-rcp-select" aria-label="Filter by difficulty" value={filters.difficulty} onChange={(e) => patchFilters({ difficulty: e.target.value })}><option value="">Any difficulty</option>{RECIPE_DIFFICULTIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
      <select className="wc-rcp-select" aria-label="Filter by dietary tag" value={filters.dietaryTag} onChange={(e) => patchFilters({ dietaryTag: e.target.value })}><option value="">Any dietary tag</option>{RECIPE_DIETARY_TAGS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
      <input className="wc-rcp-num" type="number" min="0" max={MAX_PREP_TIME_MINUTES} aria-label="Filter by maximum prep time" placeholder="Max prep (min)" value={filters.maxPrepTimeMinutes} onChange={(e) => patchFilters({ maxPrepTimeMinutes: e.target.value })} />
      <IngredientPicker value={filters.ingredient} onChange={(ingredient) => patchFilters({ ingredient })} placeholder="Uses ingredient…" ariaLabel="Filter by ingredient used" searchStatus="all" compact />
      <select className="wc-rcp-select" aria-label="Lifecycle" value={filters.status} onChange={(e) => patchFilters({ status: e.target.value })}>{RECIPE_STATUS_FILTERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
      <select className="wc-rcp-select" aria-label="Sort recipes" value={filters.sort} onChange={(e) => patchFilters({ sort: e.target.value })}>{RECIPE_SORTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
      {canWrite && <button className="wc-btn-primary" onClick={() => open('new')}><Plus size={16} /> Add recipe</button>}
    </div></div>

    {notice && <div className="wc-rcp-notice" role="status">{notice}</div>}
    {error && <div className="wc-rcp-error"><AlertCircle size={15} />{error}<button className="wc-btn-secondary" onClick={reload}>Retry</button></div>}
    {!error && !loading && <ManagementPagination pagination={pagination} noun="recipe" onPageChange={(page) => patchFilters({ page })} />}
    {!error && filters.status === 'active' && items.length > 0 && <div className="wc-rcp-count-note">The active view hides any recipe whose required ingredient has since been archived, so a page can show fewer than {PAGE_LIMIT} rows and the total can be a slight overcount. Switch status to “All” to see and fix those.</div>}
    {!error && <div className="wc-table-wrap">{loading && !items.length ? <div className="wc-rcp-status">Loading recipes…</div> : !items.length ? <div className="wc-empty"><ChefHat size={28} /><div>No recipes match this view.</div></div> : <table className="wc-table"><thead><tr><th>Title</th><th>Category</th><th>Region</th><th>Difficulty</th><th>Prep</th><th>Cook</th><th>Servings</th><th>Dietary</th><th>Status</th><th>Actions</th></tr></thead><tbody>{items.map((recipe) => <tr key={recipe.id}>
      <td>{recipe.title}</td><td>{slugLabel(recipe.category) || emDash}</td><td>{slugLabel(recipe.region) || emDash}</td><td>{recipe.difficulty ? <span className={`wc-pill ${recipe.difficulty}`}>{DIFFICULTY_LABELS[recipe.difficulty] || recipe.difficulty}</span> : emDash}</td><td>{recipe.prepTimeMinutes == null ? emDash : `${recipe.prepTimeMinutes}m`}</td><td>{recipe.cookTimeMinutes == null ? emDash : formatDuration(recipe.cookTimeMinutes)}</td><td>{recipe.servings ?? emDash}</td>
      <td className="wc-rcp-tags">{recipe.dietaryTags?.length ? recipe.dietaryTags.map((tag) => <span className="wc-tag" key={tag}>{DIETARY_TAG_LABELS[tag] || tag}</span>) : emDash}</td><td><span className={`wc-pill ${recipe.isActive ? 'active' : 'inactive'}`}>{statusLabel(recipe)}</span></td>
      <td>{rowState.id === recipe.id && rowState.error ? <div className="wc-rcp-confirm"><span className="wc-rcp-error">{rowState.error}</span><button className="wc-btn-secondary" onClick={reload}>Reload table</button><button className="wc-btn-secondary" onClick={() => setRowState({ id: null, error: '' })}>Dismiss</button></div> : confirmArchive?.id === recipe.id ? <div className="wc-rcp-confirm"><span>{recipe.publicationStatus === 'draft' ? 'Archive this Draft? Its publication state will be preserved.' : 'Archive this Published recipe? It will be hidden from users, but remain Published.'}</span><button className="wc-btn-primary" onClick={() => lifecycle(recipe, 'archive')}>Archive</button><button className="wc-btn-secondary" onClick={() => setConfirmArchive(null)}>Cancel</button></div> : <div className="wc-rcp-actions">
        <button className="wc-btn-secondary" onClick={() => open(recipe)}>{canWrite ? (recipe.publicationStatus === 'draft' ? (recipe.isActive ? 'Resume' : 'Edit draft') : 'Edit') : 'View'}</button>
        {canWrite && (recipe.isActive ? <button className="wc-icon-btn danger" aria-label={`Archive ${recipe.title}`} onClick={() => setConfirmArchive(recipe)}><Archive size={15} /></button> : <button className="wc-btn-secondary" onClick={() => lifecycle(recipe, 'restore')}><ArchiveRestore size={15} />{recipe.publicationStatus === 'draft' ? 'Restore Draft' : 'Restore Published recipe'}</button>)}
      </div>}</td></tr>)}</tbody></table>}</div>}
    {modal && canWrite && <RecipeAuthoringWizard recipe={modal === 'new' ? null : modal} canUploadRecipeImage={canUploadRecipeImage} onAuthorityLost={onAuthorityLost} onClose={close} onSaved={reload} onPublished={(recipe) => { setNotice(`${recipe.title} was published.`); reload(); close(); }} />}
    {modal && !canWrite && <RecipeDetailsModal recipeId={modal.id} onClose={close} />}
  </div>;
}
