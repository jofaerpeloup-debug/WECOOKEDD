import { CheckCircle2, CircleAlert, ImageOff } from 'lucide-react';
import { DIETARY_TAG_LABELS, DIFFICULTY_LABELS, UNIT_LABELS, slugLabel } from '../recipeOptions.js';
import { STEP_LABELS, combineDuration, formatDuration, statusLabel } from './recipeAuthoringModel.js';

const shown = (value, suffix = '') => value === '' || value == null ? '—' : `${value}${suffix}`;

export default function RecipeReview({ form, readiness, onNavigate, recipeMeta, readOnly = false }) {
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

      <div className="wc-author-summary-grid">
        <section><h3>Details</h3><dl>
          <div><dt>Difficulty</dt><dd>{DIFFICULTY_LABELS[form.difficulty] || shown(form.difficulty)}</dd></div>
          <div><dt>Prep</dt><dd>{shown(form.prepTimeMinutes, ' min')}</dd></div>
          <div><dt>Cook</dt><dd>{formatDuration(combineDuration(form.cookTimeHours, form.cookTimeMinutePart))}</dd></div>
          <div><dt>Servings</dt><dd>{shown(form.servings)}</dd></div>
          {form.region && <div><dt>Region</dt><dd>{slugLabel(form.region)}</dd></div>}
          {form.category && <div><dt>Category</dt><dd>{slugLabel(form.category)}</dd></div>}
        </dl>{form.dietaryTags.length > 0 && <div className="wc-author-tags">{form.dietaryTags.map((tag) => <span className="wc-tag" key={tag}>{DIETARY_TAG_LABELS[tag] || tag}</span>)}</div>}</section>
        <section><h3>Ingredients</h3>{ingredients.length ? <ul>{ingredients.map((row, index) => <li key={row.key || index}><strong>{row.ingredient.name}</strong> — {row.unit === 'toTaste' ? 'to taste' : `${row.quantity} ${UNIT_LABELS[row.unit] || row.unit}`}{row.optional ? ' (optional)' : ''}{row.note ? `, ${row.note}` : ''}</li>)}</ul> : <p className="wc-author-muted">None yet.</p>}</section>
      </div>
      <section><h3>Instructions</h3>{instructions.length ? <ol>{instructions.map((text, index) => <li key={`${index}-${text}`}>{text}</li>)}</ol> : <p className="wc-author-muted">None yet.</p>}</section>
      {readOnly && recipeMeta && <section className="wc-author-audit"><h3>Staff record</h3><p>Created {recipeMeta.createdAt ? new Date(recipeMeta.createdAt).toLocaleString() : '—'} · Updated {recipeMeta.updatedAt ? new Date(recipeMeta.updatedAt).toLocaleString() : '—'}</p></section>}
    </div>
  );
}

