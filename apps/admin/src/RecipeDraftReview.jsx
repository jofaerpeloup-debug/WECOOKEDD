import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, ChefHat, Search } from 'lucide-react';
import { ApiError } from './apiClient.js';
import { getRecipePublishReadiness, listRecipes } from './recipeApi.js';
import ManagementPagination from './ManagementPagination.jsx';

const PAGE_LIMIT = 20;

function errorMessage(error) {
  if (error instanceof ApiError) {
    if (error.isUnauthorized) return 'Your session has expired. Please sign in again.';
    return error.message;
  }
  return 'Something went wrong. Please try again.';
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value || '') : date.toLocaleString();
}

function issuePath(path) {
  return Array.isArray(path) ? path.join('.') : String(path || 'recipe');
}

function label(value) {
  return String(value || '').replaceAll('_', ' ');
}

function DuplicateReview({ review }) {
  if (!review) return <p>Not evaluated by READY1 for this saved Draft.</p>;
  const candidates = Array.isArray(review.candidates) ? review.candidates : [];
  const clear = !review.truncated && candidates.length === 0;
  return <div>
    {clear && <p>No duplicate or variant candidates in the current bounded comparison.</p>}
    {candidates.length > 0 && <>
      <p><strong>Duplicate review required</strong> ({candidates.length} {candidates.length === 1 ? 'candidate' : 'candidates'})</p>
      <ul>{candidates.map((candidate) => {
        const recipe = candidate.recipe || {};
        const lifecycle = `${recipe.publicationStatusSource === 'legacy' ? 'Legacy ' : ''}${label(recipe.publicationStatus)}`;
        const evidence = Object.entries(candidate.evidence || {}).map(([key, value]) => `${label(key)}: ${String(value)}`);
        return <li key={recipe.id || `${recipe.title}-${candidate.classification}`}>
          <strong>{recipe.title}</strong> — {label(candidate.classification)}; {lifecycle}; {recipe.isActive === false ? 'Archived' : 'Active'}
          {evidence.length > 0 && <div className="wc-review-evidence">Evidence: {evidence.join(', ')}</div>}
        </li>;
      })}</ul>
    </>}
    {review.truncated && <p className="wc-review-warning" role="status">
      Comparison window incomplete: compared {review.comparedCount} of {review.candidateUniverseCount} candidates.
    </p>}
  </div>;
}

export default function RecipeDraftReview({ onOpenDraft, onAuthorityLost, refreshToken = 0 }) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [listNonce, setListNonce] = useState(0);
  const [listState, setListState] = useState({ items: [], pagination: null, loading: true, error: '' });
  const [selected, setSelected] = useState(null);
  const [reviewState, setReviewState] = useState({ status: 'idle', projection: null, error: '' });
  const generation = useRef(0);
  const listGeneration = useRef(0);
  const replacementLoading = useRef(true);
  const reviewButtons = useRef(new Map());

  const discardReview = useCallback(() => {
    generation.current += 1;
    setSelected(null);
    setReviewState({ status: 'idle', projection: null, error: '' });
  }, []);

  const beginListReplacement = useCallback(() => {
    replacementLoading.current = true;
    discardReview();
    setListState({ items: [], pagination: null, loading: true, error: '' });
  }, [discardReview]);

  const refreshList = useCallback(() => {
    beginListReplacement();
    setPage(1);
    setListNonce((value) => value + 1);
  }, [beginListReplacement]);

  useEffect(() => {
    let active = true;
    const requestGeneration = listGeneration.current + 1;
    listGeneration.current = requestGeneration;
    beginListReplacement();
    const timer = setTimeout(async () => {
      try {
        const result = await listRecipes({
          search: search.trim() || undefined,
          publicationStatus: 'draft',
          status: 'active',
          sort: 'updatedDesc',
          page,
          limit: PAGE_LIMIT,
        });
        if (active && listGeneration.current === requestGeneration) {
          generation.current += 1;
          replacementLoading.current = false;
          setSelected(null);
          setReviewState({ status: 'idle', projection: null, error: '' });
          setListState({ items: result.recipes, pagination: result.pagination, loading: false, error: '' });
        }
      } catch (error) {
        if (error instanceof ApiError && error.isForbidden) onAuthorityLost?.();
        if (active && listGeneration.current === requestGeneration) {
          generation.current += 1;
          replacementLoading.current = false;
          setSelected(null);
          setReviewState({ status: 'idle', projection: null, error: '' });
          setListState({ items: [], pagination: null, loading: false, error: errorMessage(error) });
        }
      }
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
      listGeneration.current += 1;
      generation.current += 1;
    };
  }, [beginListReplacement, listNonce, onAuthorityLost, page, refreshToken, search]);

  useEffect(() => {
    if (!listState.loading && listState.pagination && page > Math.max(listState.pagination.totalPages, 1)) {
      beginListReplacement();
      setPage(Math.max(listState.pagination.totalPages, 1));
    }
  }, [beginListReplacement, listState.loading, listState.pagination, page]);

  const checkReadiness = useCallback(async (recipe) => {
    if (replacementLoading.current) return;
    const requestGeneration = generation.current + 1;
    generation.current = requestGeneration;
    setSelected(recipe);
    setReviewState({ status: 'loading', projection: null, error: '' });
    try {
      const projection = await getRecipePublishReadiness(recipe.id, recipe.updatedAt);
      if (generation.current !== requestGeneration) return;
      if (projection?.recipeId !== recipe.id || projection?.recipeUpdatedAt !== recipe.updatedAt) {
        beginListReplacement();
        setPage(1);
        setListNonce((value) => value + 1);
        return;
      }
      setReviewState({ status: projection.ready === true ? 'ready' : 'attention', projection, error: '' });
    } catch (error) {
      if (generation.current !== requestGeneration) return;
      if (error instanceof ApiError && error.isForbidden) onAuthorityLost?.();
      if (error?.code === 'RECIPE_EDIT_CONFLICT') {
        setReviewState({ status: 'stale', projection: null, error: '' });
      } else {
        setReviewState({ status: 'error', projection: null, error: errorMessage(error) });
      }
    }
  }, [beginListReplacement, onAuthorityLost]);

  const closePanel = () => {
    const id = selected?.id;
    discardReview();
    requestAnimationFrame(() => reviewButtons.current.get(id)?.focus?.());
  };

  const projection = reviewState.projection;
  const readinessFor = (recipe) => {
    const isExactSelection = selected?.id === recipe.id
      && selected?.updatedAt === recipe.updatedAt
      && projection?.recipeId === recipe.id
      && projection?.recipeUpdatedAt === recipe.updatedAt;
    if (!isExactSelection) return 'Not checked';
    if (reviewState.status === 'ready') return 'Ready to publish';
    if (reviewState.status === 'attention') return 'Needs attention';
    return 'Not checked';
  };
  return <section className="wc-review-view" aria-label="Draft review">
    <style>{`
      .wc-review-toolbar{display:flex;gap:10px;align-items:center;justify-content:space-between;margin-bottom:14px}.wc-review-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,.65fr);gap:16px;align-items:start}.wc-review-panel{border:1px solid var(--stone-light);border-radius:12px;padding:16px;background:var(--parchment)}.wc-review-panel h2,.wc-review-panel h3{margin-top:0}.wc-review-status{padding:10px;border-radius:8px;background:var(--sage-light);color:var(--sage-deep)}.wc-review-error,.wc-review-warning{padding:10px;border-radius:8px;background:#E9D3CB;color:var(--clay)}.wc-review-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.wc-review-evidence{color:var(--stone);font-size:12px;margin-top:3px}.wc-review-selected{outline:2px solid var(--sage);outline-offset:-2px}.wc-review-updated{white-space:nowrap}.wc-review-panel li{margin-bottom:8px}@media(max-width:900px){.wc-review-grid{grid-template-columns:1fr}}
    `}</style>
    <div className="wc-review-toolbar">
      <div className="wc-search"><Search size={15} /><input aria-label="Search Draft titles" placeholder="Search Draft titles…" value={search} onChange={(event) => {
        if (event.target.value === search) return;
        beginListReplacement();
        setSearch(event.target.value);
        setPage(1);
      }} /></div>
      <button className="wc-btn-secondary" onClick={refreshList}>Refresh list</button>
    </div>
    {listState.error && <div className="wc-review-error" role="alert"><AlertCircle size={15} /> {listState.error} <button className="wc-btn-secondary" onClick={refreshList}>Retry</button></div>}
    {!listState.error && !listState.loading && <ManagementPagination pagination={listState.pagination} noun="Draft" onPageChange={(nextPage) => {
      if (nextPage === page) return;
      beginListReplacement();
      setPage(nextPage);
    }} />}
    <div className="wc-review-grid">
      {!listState.error && <div className="wc-table-wrap" aria-busy={listState.loading}>
        {listState.loading && !listState.items.length ? <div className="wc-rcp-status">Loading Drafts…</div> : !listState.items.length ? <div className="wc-empty"><ChefHat size={28} /><div>No active Drafts match this view.</div></div> : <table className="wc-table">
          <thead><tr><th>Title</th><th>Status</th><th>Updated</th><th>Readiness</th><th>Action</th></tr></thead>
          <tbody>{listState.items.map((recipe) => <tr key={recipe.id} className={selected?.id === recipe.id ? 'wc-review-selected' : ''} aria-selected={selected?.id === recipe.id || undefined}>
            <td>{recipe.title}</td><td><span className="wc-pill inactive">Draft</span></td><td className="wc-review-updated"><time dateTime={recipe.updatedAt}>{formatDate(recipe.updatedAt)}</time></td>
            <td>{readinessFor(recipe)}</td>
            <td><button disabled={listState.loading} ref={(node) => { if (node) reviewButtons.current.set(recipe.id, node); else reviewButtons.current.delete(recipe.id); }} className="wc-btn-secondary" aria-pressed={selected?.id === recipe.id} onClick={() => checkReadiness(recipe)}>Review</button></td>
          </tr>)}</tbody>
        </table>}
      </div>}
      {selected && <aside className="wc-review-panel" aria-busy={reviewState.status === 'loading'} aria-label={`Review ${selected.title}`}>
        <h2>{selected.title}</h2>
        <p><span className="wc-pill inactive">Draft</span> Updated <time dateTime={selected.updatedAt}>{formatDate(selected.updatedAt)}</time></p>
        <div role={reviewState.status === 'error' ? 'alert' : 'status'}>
          {reviewState.status === 'loading' && <p className="wc-review-status">Checking saved Draft...</p>}
          {reviewState.status === 'ready' && <p className="wc-review-status">Ready to publish</p>}
          {reviewState.status === 'attention' && <p className="wc-review-warning">Needs attention</p>}
          {reviewState.status === 'error' && <div className="wc-review-error"><strong>Could not check readiness</strong><div>{reviewState.error}</div></div>}
          {reviewState.status === 'stale' && <p className="wc-review-warning">Draft changed - refresh the list and review it again</p>}
        </div>
        {projection && <>
          <h3>Publication issues ({projection.issues.length})</h3>
          {projection.issues.length === 0 ? <p>No server-derived publication issues.</p> : <ol>{projection.issues.map((issue, index) => <li key={`${issue.code}-${index}`}><strong>{issue.message}</strong><div className="wc-review-evidence">Path: {issuePath(issue.path)}</div></li>)}</ol>}
          <h3>Duplicate review</h3>
          <DuplicateReview review={projection.duplicateReview} />
        </>}
        <div className="wc-review-actions">
          {reviewState.status === 'error' && <button className="wc-btn-secondary" onClick={() => checkReadiness(selected)}>Retry</button>}
          <button className="wc-btn-primary" onClick={() => onOpenDraft(selected)}>Open Draft</button>
          <button className="wc-btn-secondary" onClick={closePanel}>Close review</button>
        </div>
      </aside>}
    </div>
  </section>;
}
