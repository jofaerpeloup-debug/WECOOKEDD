import { useState } from 'react';
import { ArrowDown, ArrowUp, ImageOff, Plus, Trash2 } from 'lucide-react';
import IngredientPicker from '../IngredientPicker.jsx';
import { resolveIngredients } from '../ingredientApi.js';
import {
  MAX_DESCRIPTION_LENGTH, MAX_INGREDIENTS, MAX_INSTRUCTION_LENGTH,
  MAX_INSTRUCTIONS, MAX_PREP_TIME_MINUTES, MAX_SERVINGS,
  RECIPE_DIETARY_TAGS, RECIPE_DIFFICULTIES, RECIPE_UNITS, TO_TASTE_UNIT,
} from '../recipeOptions.js';
import { blankIngredient } from './recipeAuthoringModel.js';
import { prepareIngredientResolutionRequest } from './recipeIngredientResolution.js';
import { createRecipeIntakeHandlers } from './recipeIntake.js';
import { createRecipeUrlImportHandlers, RecipeUrlImportControls } from './recipeUrlImport.js';
import RecipeReview from './RecipeReview.jsx';

function FieldError({ message }) { return message ? <div className="wc-author-field-error" role="alert">{message}</div> : null; }
function err(errors, prefix) { return errors[prefix] || Object.entries(errors).find(([key]) => key.startsWith(`${prefix}.`))?.[1]; }

function RecipeIntake({ form, change, busy, dispatch }) {
  const [input, setInput] = useState('');
  const [preview, setPreview] = useState(null);
  const [application, setApplication] = useState(null);
  const [url, setUrl] = useState('');
  const [urlImport, setUrlImport] = useState({ status: 'idle', sourceUrl: '', error: '' });
  const { previewInput, applyPreview } = createRecipeIntakeHandlers({
    input, form, preview, change, setPreview,
    setApplication,
  });
  const { importFromUrl } = createRecipeUrlImportHandlers({
    url, setInput, setPreview, setApplication, setUrlImport,
  });
  const setUnresolvedFromPreview = (result) => {
    if (!result?.ok) return;
    dispatch({ type: 'SET_UNRESOLVED_INGREDIENTS', lines: result.unresolved.flatMap(({ values }) => values) });
  };
  const handlePreview = () => {
    const result = previewInput();
    setUnresolvedFromPreview(result);
  };
  const handleUrlImport = async () => {
    const result = await importFromUrl();
    setUnresolvedFromPreview(result.preview);
  };
  return <section className="wc-recipe-intake" aria-labelledby="recipe-intake-title">
    <h2 id="recipe-intake-title">Prefill from Recipe JSON-LD</h2>
    <p>Paste one Recipe object to preview safe fields. Nothing is saved or published automatically.</p>
    <RecipeUrlImportControls
      url={url}
      urlImport={urlImport}
      busy={busy}
      onUrlChange={(value) => { setUrl(value); setUrlImport({ status: 'idle', sourceUrl: '', error: '' }); }}
      onImport={handleUrlImport}
    />
    <label>Recipe JSON-LD<textarea rows="6" value={input} disabled={busy} onChange={(event) => { setInput(event.target.value); setPreview(null); setApplication(null); setUrlImport({ status: 'idle', sourceUrl: '', error: '' }); }} /></label>
    <div className="wc-recipe-intake-actions"><button type="button" className="wc-btn-secondary" disabled={busy || !input.trim()} onClick={handlePreview}>Preview</button>{preview?.ok && preview.mapped.length > 0 && <button type="button" className="wc-btn-secondary" disabled={busy} onClick={applyPreview}>Apply blank fields</button>}</div>
    {preview && !preview.ok && <div className="wc-author-field-error" role="alert">{preview.error.message}</div>}
    {preview?.ok && <div className="wc-recipe-intake-preview" role="status">
      <strong>{preview.mapped.length} mapped</strong>
      {preview.mapped.length > 0 && <ul>{preview.mapped.map((item) => <li key={item.field}>{item.source} → {item.field}</li>)}</ul>}
      {preview.unsupported.length > 0 && <><strong>Unsupported</strong><ul>{preview.unsupported.map((item, index) => <li key={`${item.location || 'recipe'}-${item.field}-${index}`}>{item.location ? `${item.location} ${item.field}` : item.field}: {item.message}</li>)}</ul></>}
      {preview.invalid.length > 0 && <><strong>Invalid</strong><ul>{preview.invalid.map((item) => <li key={item.field}>{item.field}: {item.message}</li>)}</ul></>}
      {preview.unresolved.length > 0 && <><strong>Unresolved ingredients</strong><p>{preview.unresolved[0].message}</p><ol>{preview.unresolved[0].values.map((value, index) => <li key={`${index}-${value}`}>{value}</li>)}</ol></>}
      {application && <p>{application.applied.length} applied; {application.skipped.length} existing value{application.skipped.length === 1 ? '' : 's'} preserved.</p>}
      {application?.skipped.length > 0 && <ul>{application.skipped.map((item) => <li key={item.field}>{item.field}: {item.reason}</li>)}</ul>}
    </div>}
  </section>;
}

export async function requestIngredientResolutions({ queue, generation, dispatch, request = resolveIngredients }) {
  const prepared = prepareIngredientResolutionRequest(queue);
  dispatch({ type: 'INGREDIENT_RESOLUTION_START', request: prepared, generation });
  try {
    const resolutions = prepared.lines.length ? await request(prepared.lines) : [];
    dispatch({ type: 'INGREDIENT_RESOLUTION_SUCCESS', generation, request: prepared, resolutions });
  } catch (error) {
    dispatch({ type: 'INGREDIENT_RESOLUTION_FAILURE', generation, message: error?.message || 'Catalog matches could not be loaded. Try again.' });
  }
}

export function IngredientResolutionPanel({ state, dispatch, busy }) {
  const queue = state.unresolvedIngredients || [];
  if (!queue.length) return null;
  const loading = state.ingredientResolutionStatus === 'loading';
  const findMatches = () => requestIngredientResolutions({
    queue, generation: state.ingredientResolutionGeneration, dispatch,
  });
  const update = (index, patch) => dispatch({ type: 'UPDATE_INGREDIENT_RESOLUTION', index, patch });

  return <section className="wc-ingredient-resolution" aria-labelledby="ingredient-resolution-title">
    <div className="wc-author-section-intro">
      <div><h2 id="ingredient-resolution-title">Imported ingredient lines</h2><p>Matches are suggestions only. Choose a canonical Ingredient and confirm each row.</p></div>
      <button type="button" className="wc-btn-secondary" disabled={busy || loading} onClick={findMatches}>{loading ? 'Finding matches…' : state.ingredientResolutionError ? 'Retry catalog matches' : 'Find catalog matches'}</button>
    </div>
    {state.ingredientResolutionError && <div className="wc-author-field-error" role="alert">{state.ingredientResolutionError}</div>}
    <ol className="wc-resolution-list">
      {queue.map((entry, index) => {
        const match = entry.resolution?.match;
        return <li key={entry.key} className="wc-resolution-card">
          <p className="wc-resolution-source"><strong>Source:</strong> {entry.sourceText}</p>
          {entry.resolutionError && <p className="wc-author-field-error" role="alert">{entry.resolutionError} Use the manual picker below.</p>}
          {entry.resolution && <>
            <p className="wc-author-muted">Classification: <strong>{match.kind}</strong>{entry.resolution.parsed.name ? ` · parsed name: ${entry.resolution.parsed.name}` : ''}</p>
            {match.truncated && <p className="wc-author-notice">More matches exist than are shown. Use the manual picker to search the active catalog.</p>}
            {match.candidates.length > 0 && <fieldset className="wc-resolution-candidates"><legend>{match.kind === 'exact' ? 'Exact catalog match' : match.kind === 'ambiguous' ? 'Ambiguous exact matches' : 'Possible catalog matches'}</legend>
              {match.candidates.map((candidate) => <label key={candidate.ingredient.id}>
                <input type="radio" name={`resolution-${entry.key}`} checked={entry.selectedIngredient?.id === candidate.ingredient.id} disabled={busy || loading} onChange={() => update(index, { selectedIngredient: candidate.ingredient })} />
                <span><strong>{candidate.ingredient.name}</strong> ({candidate.ingredient.category}) · matched {candidate.matchedOn}: {candidate.matchedText}</span>
              </label>)}
            </fieldset>}
            {(match.kind === 'none' || match.kind === 'unparsed') && <p className="wc-author-muted">No suggested catalog candidate. Choose one manually.</p>}
          </>}
          <div className="wc-resolution-confirm">
            <IngredientPicker value={entry.selectedIngredient} disabled={busy || loading} ariaLabel={`Manual catalog Ingredient for ${entry.sourceText}`} onChange={(ingredient) => update(index, { selectedIngredient: ingredient })} />
            <label>Quantity<input type="text" inputMode="decimal" placeholder="e.g. 1 1/2" disabled={busy || loading || entry.unit === TO_TASTE_UNIT} value={entry.quantity} onChange={(event) => update(index, { quantity: event.target.value })} /></label>
            <label>Unit<select value={entry.unit} disabled={busy || loading} onChange={(event) => update(index, { unit: event.target.value, quantity: event.target.value === TO_TASTE_UNIT ? '' : entry.quantity })}><option value="">Choose unit</option>{RECIPE_UNITS.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}</select></label>
            <button type="button" className="wc-btn-secondary" disabled={busy || loading} onClick={() => dispatch({ type: 'CONFIRM_INGREDIENT_RESOLUTION', index })}>Confirm ingredient</button>
          </div>
          {entry.confirmationError && <div className="wc-author-field-error" role="alert">{entry.confirmationError}</div>}
        </li>;
      })}
    </ol>
  </section>;
}

export default function RecipeAuthoringSteps({ authoring, canUploadRecipeImage }) {
  const { state, change, selectedFile, setSelectedFile, previewUrl, readiness, setStep, busy, dispatch } = authoring;
  const { form, currentStep, fieldErrors } = state;
  if (currentStep === 'review') return <RecipeReview form={form} readiness={readiness} onNavigate={setStep} recipeMeta={state} />;

  if (currentStep === 'basics') return <div className="wc-author-fields">
    {!state.recipeId && <RecipeIntake form={form} change={change} busy={busy} dispatch={dispatch} />}
    <label>Title <span aria-hidden="true">*</span><input autoFocus value={form.title} aria-invalid={Boolean(fieldErrors.title)} onChange={(e) => change('title', e.target.value)} /></label><FieldError message={fieldErrors.title} />
    <label>Description<textarea rows="5" value={form.description} maxLength={MAX_DESCRIPTION_LENGTH} aria-invalid={Boolean(fieldErrors.description)} onChange={(e) => change('description', e.target.value)} /></label><div className="wc-author-hint">{form.description.length}/{MAX_DESCRIPTION_LENGTH}</div><FieldError message={fieldErrors.description} />
    <fieldset className="wc-author-image"><legend>Image (optional)</legend>
      {(selectedFile || form.imageUrl) ? <img src={selectedFile ? previewUrl : form.imageUrl} alt="Recipe preview" /> : <div className="wc-author-image-fallback"><ImageOff size={25} /> No image selected</div>}
      {canUploadRecipeImage && <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(e) => {
        const file = e.target.files?.[0] || null;
        if (file && (file.size > 5 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) {
          dispatch({ type: 'SET_ERRORS', fieldErrors: { image: 'Choose a JPEG, PNG, or WebP image no larger than 5 MiB.' } }); e.target.value = ''; return;
        }
        setSelectedFile(file);
      }} />}
      <FieldError message={fieldErrors.image} />
      {(selectedFile || form.imageUrl) && <button type="button" className="wc-btn-secondary" disabled={busy} onClick={() => { setSelectedFile(null); change('imageUrl', null); }}>Remove image</button>}
      <div className="wc-author-hint">JPEG, PNG, or WebP; maximum 5 MiB. The Draft is created before upload.</div>
    </fieldset>
  </div>;

  if (currentStep === 'ingredients') {
    const updateRow = (index, patch) => change('ingredients', form.ingredients.map((row, i) => i === index ? { ...row, ...patch } : row));
    return <div><IngredientResolutionPanel state={state} dispatch={dispatch} busy={busy} /><div className="wc-author-section-intro"><p>Blank rows are ignored. Partially completed rows must be finished before saving.</p><button type="button" className="wc-btn-secondary" disabled={form.ingredients.length >= MAX_INGREDIENTS || busy} onClick={() => change('ingredients', [...form.ingredients, blankIngredient()])}><Plus size={15} /> Add ingredient</button></div><FieldError message={err(fieldErrors, 'ingredients')} />
      {form.ingredients.map((row, index) => <div className="wc-author-ingredient" key={row.key}>
        <span className="wc-author-row-number">{index + 1}</span><IngredientPicker value={row.ingredient} disabled={busy} ariaLabel={`Ingredient ${index + 1}`} onChange={(ingredient) => updateRow(index, { ingredient })} />
        <label>Quantity<input type="text" inputMode="decimal" placeholder="e.g. 1 1/2" disabled={row.unit === TO_TASTE_UNIT || busy} value={row.quantity} aria-invalid={Boolean(fieldErrors[`ingredients.${index}.quantity`])} onChange={(e) => updateRow(index, { quantity: e.target.value })} /></label>
        <label>Unit<select value={row.unit} disabled={busy} onChange={(e) => updateRow(index, { unit: e.target.value, quantity: e.target.value === TO_TASTE_UNIT ? '' : row.quantity })}>{RECIPE_UNITS.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}</select></label>
        <label className="wc-author-check"><input type="checkbox" checked={row.optional} disabled={busy} onChange={(e) => updateRow(index, { optional: e.target.checked })} /> Optional</label>
        <label className="wc-author-note">Note<input value={row.note} maxLength={200} disabled={busy} onChange={(e) => updateRow(index, { note: e.target.value })} /></label>
        <button type="button" className="wc-icon-btn danger" aria-label={`Remove ingredient ${index + 1}`} disabled={busy} onClick={() => change('ingredients', form.ingredients.length === 1 ? [blankIngredient()] : form.ingredients.filter((_, i) => i !== index))}><Trash2 size={15} /></button>
      </div>)}
    </div>;
  }

  if (currentStep === 'instructions') {
    const move = (from, to) => { const rows = [...form.instructions]; const [item] = rows.splice(from, 1); rows.splice(to, 0, item); change('instructions', rows); };
    return <div><div className="wc-author-section-intro"><p>Blank instructions are ignored and saved steps are renumbered automatically.</p><button type="button" className="wc-btn-secondary" disabled={form.instructions.length >= MAX_INSTRUCTIONS || busy} onClick={() => change('instructions', [...form.instructions, ''])}><Plus size={15} /> Add instruction</button></div><FieldError message={err(fieldErrors, 'instructions')} />
      {form.instructions.map((text, index) => <div className="wc-author-instruction" key={index}><span>{index + 1}</span><textarea rows="3" value={text} maxLength={MAX_INSTRUCTION_LENGTH} disabled={busy} aria-label={`Instruction ${index + 1}`} aria-invalid={Boolean(fieldErrors[`instructions.${index}`])} onChange={(e) => change('instructions', form.instructions.map((value, i) => i === index ? e.target.value : value))} />
        <div><button type="button" aria-label="Move up" disabled={index === 0 || busy} onClick={() => move(index, index - 1)}><ArrowUp size={14} /></button><button type="button" aria-label="Move down" disabled={index === form.instructions.length - 1 || busy} onClick={() => move(index, index + 1)}><ArrowDown size={14} /></button><button type="button" aria-label="Remove instruction" disabled={busy} onClick={() => change('instructions', form.instructions.length === 1 ? [''] : form.instructions.filter((_, i) => i !== index))}><Trash2 size={14} /></button></div></div>)}
    </div>;
  }

  return <div className="wc-author-fields wc-author-details">
    <label>Difficulty<select value={form.difficulty} aria-invalid={Boolean(fieldErrors.difficulty)} onChange={(e) => change('difficulty', e.target.value)}><option value="">Not set</option>{RECIPE_DIFFICULTIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><FieldError message={fieldErrors.difficulty} />
    <div className="wc-author-grid"><label>Prep time (minutes)<input type="number" inputMode="numeric" min="1" max={MAX_PREP_TIME_MINUTES} step="1" value={form.prepTimeMinutes} aria-invalid={Boolean(fieldErrors.prepTimeMinutes)} onChange={(e) => change('prepTimeMinutes', e.target.value)} /></label><fieldset className="wc-author-duration"><legend>Cooking time</legend><div><label>Hours<input type="number" inputMode="numeric" min="0" max="24" step="1" value={form.cookTimeHours} aria-invalid={Boolean(fieldErrors.cookTimeMinutes)} onChange={(e) => change('cookTimeHours', e.target.value)} /></label><label>Minutes<input type="number" inputMode="numeric" min="0" max="59" step="1" value={form.cookTimeMinutePart} aria-invalid={Boolean(fieldErrors.cookTimeMinutes)} onChange={(e) => change('cookTimeMinutePart', e.target.value)} /></label></div></fieldset><label>Servings<input type="number" inputMode="numeric" min="1" max={MAX_SERVINGS} step="1" value={form.servings} aria-invalid={Boolean(fieldErrors.servings)} onChange={(e) => change('servings', e.target.value)} /></label></div>
    <FieldError message={fieldErrors.prepTimeMinutes || fieldErrors.cookTimeMinutes || fieldErrors.servings} />
    <div className="wc-author-grid"><label>Region<input value={form.region} aria-invalid={Boolean(fieldErrors.region)} placeholder="e.g. central-luzon" onChange={(e) => change('region', e.target.value)} /></label><label>Category<input value={form.category} aria-invalid={Boolean(fieldErrors.category)} placeholder="e.g. main-dish" onChange={(e) => change('category', e.target.value)} /></label></div><FieldError message={fieldErrors.region || fieldErrors.category} />
    <fieldset><legend>Dietary tags</legend><div className="wc-author-tags">{RECIPE_DIETARY_TAGS.map((tag) => <label className="wc-author-check" key={tag.value}><input type="checkbox" checked={form.dietaryTags.includes(tag.value)} onChange={(e) => change('dietaryTags', e.target.checked ? [...form.dietaryTags, tag.value] : form.dietaryTags.filter((value) => value !== tag.value))} /> {tag.label}</label>)}</div></fieldset><FieldError message={fieldErrors.dietaryTags} />
  </div>;
}
