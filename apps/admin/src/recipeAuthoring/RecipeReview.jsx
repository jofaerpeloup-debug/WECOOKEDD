import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, CircleAlert, ImageOff } from 'lucide-react';
import { getRecipe } from '../recipeApi.js';
import { categoryLabel, DIETARY_TAG_LABELS, DIFFICULTY_LABELS, regionLabel, UNIT_LABELS } from '../recipeOptions.js';
import { STEP_LABELS, combineDuration, formatDuration, statusLabel } from './recipeAuthoringModel.js';

const shown = (value, suffix = '') => value === '' || value == null ? '—' : `${value}${suffix}`;
const CLASSIFICATION_LABELS = {
  exact_duplicate: 'Exact duplicates',
  near_exact_duplicate: 'Near-exact duplicates',
  possible_variant: 'Possible variants',
};

function lifecycleLabel(recipe) {
  const labels = [recipe.publicationStatus === 'draft' ? 'Draft' : 'Published'];
  if (!recipe.isActive) labels.push('Archived');
  if (recipe.publicationStatusSource === 'legacy') labels.push('Legacy status');
  return labels.join(' · ');
}

function Evidence({ evidence }) {
  const rows = [
    ['Title exact', evidence.titleExact],
    ['Ingredient multiset exact', evidence.ingredientMultisetExact],
    ['Instruction sequence exact', evidence.instructionSequenceExact],
    ['Exact fingerprint payload', evidence.fingerprintEqual],
  ];
  return <dl className="wc-duplicate-evidence">{rows.map(([label, matches]) => <div key={label}><dt>{label}</dt><dd>{matches ? 'Yes' : 'No'}</dd></div>)}</dl>;
}

function DuplicateReviewResultState({
  review, status, error, acknowledgedDigest, busy, onAcknowledge,
  expandedId = null, onToggleExpanded = () => {}, onShowExisting = () => {},
}) {
  const groups = Object.keys(CLASSIFICATION_LABELS).map((classification) => ({
    classification,
    candidates: review?.candidates?.filter((candidate) => candidate.classification === classification) || [],
  })).filter(({ candidates }) => candidates.length > 0);
  const requiresAcknowledgement = Boolean(review && (review.truncated || review.candidates.length > 0));
  const checked = Boolean(review && acknowledgedDigest === review.resultDigest);

  return <>
    {error && <p className="wc-author-field-error" role="alert">{error}</p>}
    {status === 'stale' && <p className="wc-author-notice" role="status">The saved review changed. Fresh comparison evidence is shown below; review it and check again before publishing.</p>}
    {review?.truncated && <p className="wc-author-notice" role="status">Checked the newest {review.candidateLimit} of {review.candidateUniverseCount} eligible Recipes. Older eligible Recipes were not compared.</p>}
    {status === 'no_qualifying_evidence' && !review?.truncated && <p role="status">No qualifying duplicate or variant evidence was found in the checked candidate window.</p>}
    {review && <p className="wc-author-muted">Compared {review.comparedCount} of {review.candidateUniverseCount} eligible Recipes.</p>}
    {groups.map(({ classification, candidates }) => <section key={classification} className="wc-duplicate-group" aria-labelledby={`duplicate-${classification}`}>
      <h4 id={`duplicate-${classification}`}>{CLASSIFICATION_LABELS[classification]}</h4>
      <ul>{candidates.map((candidate) => <li key={candidate.recipe.id} className="wc-duplicate-candidate">
        <div><strong>{candidate.recipe.title}</strong><span className="wc-pill">{lifecycleLabel(candidate.recipe)}</span></div>
        <Evidence evidence={candidate.evidence} />
        <div className="wc-duplicate-actions">
          <button type="button" className="wc-btn-secondary" onClick={() => onToggleExpanded(candidate.recipe.id)}>Compare</button>
          <button type="button" className="wc-btn-secondary" onClick={() => onShowExisting(candidate.recipe.id)}>View existing Recipe</button>
        </div>
        {expandedId === candidate.recipe.id && <p className="wc-author-muted">This classification compares the exact normalized title, canonical Ingredient-usage multiset, and ordered instruction sequence shown above. No score or fuzzy matching is used.</p>}
      </li>)}</ul>
    </section>)}
    {requiresAcknowledgement && <label className="wc-author-check wc-duplicate-acknowledgement"><input type="checkbox" checked={checked} disabled={busy || status === 'stale'} onChange={(event) => onAcknowledge(event.target.checked)} /> I reviewed this result and want to continue as a distinct Recipe or variant.</label>}
  </>;
}

function DuplicateReviewPanel({
  recipeMeta, readiness, review, status, error, acknowledgedDigest, focusRequest,
  needsSave, unresolvedIngredientCount, busy, onCheck, onAcknowledge,
}) {
  const headingRef = useRef(null);
  const [expandedId, setExpandedId] = useState(null);
  const [view, setView] = useState({ status: 'idle', recipe: null, error: '' });
  useEffect(() => { if (focusRequest) headingRef.current?.focus(); }, [focusRequest]);

  const showExisting = async (id) => {
    setView({ status: 'loading', recipe: null, error: '' });
    try {
      setView({ status: 'ready', recipe: await getRecipe(id), error: '' });
    } catch (requestError) {
      setView({ status: 'error', recipe: null, error: requestError?.message || 'The existing Recipe could not be loaded.' });
    }
  };
  const canCheck = recipeMeta.recipeId && recipeMeta.publicationStatus === 'draft' && recipeMeta.isActive
    && readiness.complete && !needsSave && !busy;

  return <section className="wc-duplicate-review" aria-labelledby="duplicate-review-heading" aria-busy={status === 'checking'}>
    <div className="wc-author-section-intro">
      <div><h3 id="duplicate-review-heading" ref={headingRef} tabIndex="-1">Duplicate and variant review</h3><p>Comparison uses saved canonical Recipe content and deterministic v1 rules.</p></div>
      <button type="button" className="wc-btn-secondary" disabled={!canCheck} onClick={onCheck}>{status === 'checking' ? 'Checking…' : status === 'error' ? 'Retry duplicate check' : review ? 'Check again' : 'Check for duplicates and variants'}</button>
    </div>
    {needsSave && <p className="wc-author-notice">Save changes before checking for duplicates and variants.</p>}
    {unresolvedIngredientCount > 0 && <p className="wc-author-notice">This check uses only saved canonical Recipe ingredients. Unresolved imported ingredient rows were not compared.</p>}
    {status === 'checking' && <p role="status">Checking the eligible Recipe window…</p>}
    <DuplicateReviewResultState review={review} status={status} error={error}
      acknowledgedDigest={acknowledgedDigest} busy={busy} onAcknowledge={onAcknowledge}
      expandedId={expandedId}
      onToggleExpanded={(id) => setExpandedId(expandedId === id ? null : id)}
      onShowExisting={showExisting} />
    {view.status === 'loading' && <p role="status">Loading existing Recipe…</p>}
    {view.status === 'error' && <p className="wc-author-field-error" role="alert">{view.error}</p>}
    {view.status === 'ready' && <aside className="wc-duplicate-existing" aria-label="Existing Recipe details"><div><h4>{view.recipe.title}</h4><button type="button" className="wc-btn-secondary" onClick={() => setView({ status: 'idle', recipe: null, error: '' })}>Close details</button></div><p>{view.recipe.description}</p><p><strong>Status:</strong> {statusLabel(view.recipe)}</p><p><strong>Ingredients:</strong> {view.recipe.ingredients?.length || 0} · <strong>Instructions:</strong> {view.recipe.instructions?.length || 0}</p></aside>}
  </section>;
}

export default function RecipeReview({
  form, readiness, onNavigate, recipeMeta, readOnly = false,
  duplicateReview, duplicateReviewStatus, duplicateReviewError, duplicateAcknowledgedDigest,
  duplicateReviewFocusRequest, duplicateCheckNeedsSave, unresolvedIngredientCount,
  busy, onCheckDuplicates, onAcknowledgeDuplicateReview,
}) {
  const ingredients = (form.ingredients || []).filter((row) => row.ingredient?.id);
  const instructions = (form.instructions || []).map((text) => text.trim()).filter(Boolean);
  return (
    <div className="wc-author-review">
      <div className="wc-author-review-head">
        {form.imageUrl ? <img src={form.imageUrl} alt="" /> : <div className="wc-author-image-fallback"><ImageOff size={28} /><span>No image</span></div>}
        <div><span className="wc-pill active">{statusLabel(recipeMeta)}</span><h2>{form.title || 'Untitled recipe'}</h2><p>{form.description || 'No description yet.'}</p></div>
      </div>

      <section aria-labelledby="readiness-heading">
        <h3 id="readiness-heading">Publication readiness</h3>
        <div className="wc-author-readiness">
          {Object.entries(readiness.sections).map(([step, item]) => {
            const content = <><span>{item.complete ? <CheckCircle2 size={17} /> : <CircleAlert size={17} />}{STEP_LABELS[step]}</span><small>{item.complete ? 'Complete' : item.messages.join(' ')}</small></>;
            return onNavigate && !readOnly ? <button type="button" key={step} className={item.complete ? 'complete' : 'incomplete'} onClick={() => onNavigate(step)}>{content}</button>
              : <div key={step} className={item.complete ? 'complete' : 'incomplete'}>{content}</div>;
          })}
        </div>
      </section>

      {!readOnly && recipeMeta?.publicationStatus === 'draft' && <DuplicateReviewPanel
        recipeMeta={recipeMeta} readiness={readiness} review={duplicateReview} status={duplicateReviewStatus}
        error={duplicateReviewError} acknowledgedDigest={duplicateAcknowledgedDigest}
        focusRequest={duplicateReviewFocusRequest} needsSave={duplicateCheckNeedsSave}
        unresolvedIngredientCount={unresolvedIngredientCount} busy={busy}
        onCheck={onCheckDuplicates} onAcknowledge={onAcknowledgeDuplicateReview}
      />}

      <div className="wc-author-summary-grid">
        <section><h3>Details</h3><dl>
          <div><dt>Difficulty</dt><dd>{DIFFICULTY_LABELS[form.difficulty] || shown(form.difficulty)}</dd></div>
          <div><dt>Prep</dt><dd>{shown(form.prepTimeMinutes, ' min')}</dd></div>
          <div><dt>Cook</dt><dd>{formatDuration(combineDuration(form.cookTimeHours, form.cookTimeMinutePart))}</dd></div>
          <div><dt>Servings</dt><dd>{shown(form.servings)}</dd></div>
          {form.region && <div><dt>Region</dt><dd>{regionLabel(form.region)}</dd></div>}
          {form.category && <div><dt>Category</dt><dd>{categoryLabel(form.category)}</dd></div>}
        </dl>{form.dietaryTags.length > 0 && <div className="wc-author-tags">{form.dietaryTags.map((tag) => <span className="wc-tag" key={tag}>{DIETARY_TAG_LABELS[tag] || tag}</span>)}</div>}</section>
        <section><h3>Ingredients</h3>{ingredients.length ? <ul>{ingredients.map((row, index) => <li key={row.key || index}><strong>{row.ingredient.name}</strong> — {row.unit === 'toTaste' ? 'to taste' : `${row.quantity} ${UNIT_LABELS[row.unit] || row.unit}`}{row.optional ? ' (optional)' : ''}{row.note ? `, ${row.note}` : ''}</li>)}</ul> : <p className="wc-author-muted">None yet.</p>}</section>
      </div>
      <section><h3>Instructions</h3>{instructions.length ? <ol>{instructions.map((text, index) => <li key={`${index}-${text}`}>{text}</li>)}</ol> : <p className="wc-author-muted">None yet.</p>}</section>
      {readOnly && recipeMeta && <section className="wc-author-audit"><h3>Staff record</h3><p>Created {recipeMeta.createdAt ? new Date(recipeMeta.createdAt).toLocaleString() : '—'} · Updated {recipeMeta.updatedAt ? new Date(recipeMeta.updatedAt).toLocaleString() : '—'}</p></section>}
    </div>
  );
}
