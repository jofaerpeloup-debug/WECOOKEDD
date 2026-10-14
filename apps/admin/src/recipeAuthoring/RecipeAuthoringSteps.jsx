import { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ImageOff, Plus, Trash2 } from 'lucide-react';
import IngredientPicker from '../IngredientPicker.jsx';
import { IngredientModal } from '../IngredientsTab.jsx';
import { createIngredient, resolveIngredients } from '../ingredientApi.js';
import {
  MAX_DESCRIPTION_LENGTH, MAX_INGREDIENTS, MAX_INSTRUCTION_LENGTH,
  MAX_INSTRUCTIONS, MAX_PREP_TIME_MINUTES, MAX_SERVINGS,
  RECIPE_CATEGORIES, RECIPE_DIETARY_TAGS, RECIPE_DIFFICULTIES, RECIPE_REGIONS,
  RECIPE_UNITS, TO_TASTE_UNIT,
} from '../recipeOptions.js';
import { blankIngredient, blankNutrition, blankSpiceAlternative, blankStepTimer, cookingForMode, cookingMode, NUTRIENT_FIELDS, SPICE_LEVELS } from './recipeAuthoringModel.js';
import { ingredientCreationPrefill, prepareIngredientResolutionRequest } from './recipeIngredientResolution.js';
import { createRecipeIntakeHandlers, metadataSuggestionState } from './recipeIntake.js';
import { createRecipeUrlImportHandlers, RecipeUrlImportControls } from './recipeUrlImport.js';
import RecipeReview from './RecipeReview.jsx';

function FieldError({ message }) { return message ? <div className="wc-author-field-error" role="alert">{message}</div> : null; }
function err(errors, prefix) { return errors[prefix] || Object.entries(errors).find(([key]) => key.startsWith(`${prefix}.`))?.[1]; }

function CookingSpiceEditor({ form, change, busy, errors }) {
  const cooking = form.cooking;
  const mode = cookingMode(cooking);
  const setCooking = (patch) => change('cooking', { ...cooking, ...patch });
  return <fieldset className="wc-cooking-editor"><legend>Authored cooking options</legend>
    <label>Cooking profile<select value={mode} disabled={busy} onChange={(event) => change('cooking', cookingForMode(cooking, event.target.value))}>
      <option value="none">No spice levels or timers</option><option value="timers">Step timers only</option><option value="spice">Authored spice levels and optional timers</option>
    </select></label>
    {mode === 'spice' && <>
      <label>Default spice level<select value={cooking.defaultSpiceLevel} disabled={busy} aria-invalid={Boolean(errors['cooking.defaultSpiceLevel'])} onChange={(event) => setCooking({ defaultSpiceLevel: event.target.value })}>
        {SPICE_LEVELS.map((level) => <option key={level} value={level}>{level.replace('_', ' ')}</option>)}
      </select></label><FieldError message={errors['cooking.defaultSpiceLevel']} />
      <p className="wc-author-hint">The Ingredients above are the complete default list. Each alternative below is a complete replacement list.</p>
      {(cooking.spiceAlternatives || []).map((alternative, altIndex) => {
        const prefix = `cooking.spiceAlternatives.${altIndex}`;
        const updateAlternative = (patch) => setCooking({ spiceAlternatives: cooking.spiceAlternatives.map((value, index) => index === altIndex ? { ...value, ...patch } : value) });
        const updateRow = (rowIndex, patch) => updateAlternative({ ingredients: alternative.ingredients.map((row, index) => index === rowIndex ? { ...row, ...patch } : row) });
        return <section className="wc-cooking-alternative" key={altIndex} aria-label={`Alternative spice level ${altIndex + 1}`}>
          <div className="wc-author-section-intro"><label>Alternative level<select value={alternative.spiceLevel} disabled={busy} aria-invalid={Boolean(errors[`${prefix}.spiceLevel`])} onChange={(event) => updateAlternative({ spiceLevel: event.target.value })}>
            <option value="">Choose level</option>{SPICE_LEVELS.map((level) => <option key={level} value={level}>{level.replace('_', ' ')}</option>)}
          </select></label><button type="button" className="wc-btn-secondary" disabled={busy} onClick={() => setCooking({ spiceAlternatives: cooking.spiceAlternatives.filter((_, index) => index !== altIndex) })}>Remove level</button></div>
          <FieldError message={errors[`${prefix}.spiceLevel`] || errors[`${prefix}.ingredients`]} />
          {alternative.ingredients.map((row, rowIndex) => <div className="wc-author-ingredient" key={row.key || rowIndex}>
            <span className="wc-author-row-number">{rowIndex + 1}</span><IngredientPicker value={row.ingredient} disabled={busy} ariaLabel={`${alternative.spiceLevel || 'Alternative'} ingredient ${rowIndex + 1}`} onChange={(ingredient) => updateRow(rowIndex, { ingredient })} />
            <label>Quantity<input type="text" inputMode="decimal" value={row.quantity} disabled={busy || row.unit === TO_TASTE_UNIT} aria-invalid={Boolean(errors[`${prefix}.ingredients.${rowIndex}.quantity`])} onChange={(event) => updateRow(rowIndex, { quantity: event.target.value })} /></label>
            <label>Unit<select value={row.unit} disabled={busy} onChange={(event) => updateRow(rowIndex, { unit: event.target.value, quantity: event.target.value === TO_TASTE_UNIT ? '' : row.quantity })}>{RECIPE_UNITS.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}</select></label>
            <label className="wc-author-check"><input type="checkbox" checked={row.optional} disabled={busy} onChange={(event) => updateRow(rowIndex, { optional: event.target.checked })} /> Optional</label>
            <label className="wc-author-note">Note<input value={row.note} disabled={busy} maxLength={200} onChange={(event) => updateRow(rowIndex, { note: event.target.value })} /></label>
            <button type="button" className="wc-icon-btn danger" aria-label={`Remove ${alternative.spiceLevel || 'alternative'} ingredient ${rowIndex + 1}`} disabled={busy} onClick={() => updateAlternative({ ingredients: alternative.ingredients.length === 1 ? [blankIngredient()] : alternative.ingredients.filter((_, index) => index !== rowIndex) })}><Trash2 size={15} /></button>
          </div>)}
          <FieldError message={err(errors, `${prefix}.ingredients`)} />
          <button type="button" className="wc-btn-secondary" disabled={busy || alternative.ingredients.length >= MAX_INGREDIENTS} onClick={() => updateAlternative({ ingredients: [...alternative.ingredients, blankIngredient()] })}>Add alternative ingredient</button>
        </section>;
      })}
      <FieldError message={errors['cooking.spiceAlternatives']} />
      <button type="button" className="wc-btn-secondary" disabled={busy || cooking.spiceAlternatives.length >= 4} onClick={() => setCooking({ spiceAlternatives: [...cooking.spiceAlternatives, blankSpiceAlternative()] })}>Add complete spice alternative</button>
    </>}
  </fieldset>;
}

function CookingTimerEditor({ form, change, busy, errors }) {
  const cooking = form.cooking;
  const instructions = (form.instructions || []).map((text) => text.trim()).filter(Boolean);
  if (!cooking) return <section className="wc-cooking-editor"><h3>Cook Mode step timers</h3><p className="wc-author-hint">Timers are optional and use exact authored durations.</p><button type="button" className="wc-btn-secondary" disabled={busy} onClick={() => change('cooking', cookingForMode(null, 'timers'))}>Enable step timers</button></section>;
  const levels = cooking.defaultSpiceLevel === null ? [null] : [cooking.defaultSpiceLevel, ...cooking.spiceAlternatives.map((alternative) => alternative.spiceLevel)];
  const setTimers = (stepTimers) => change('cooking', { ...cooking, stepTimers });
  return <fieldset className="wc-cooking-editor"><legend>Cook Mode step timers</legend><p className="wc-author-hint">Select a current instruction, exact servings, authored level, and duration in seconds. Missing presets stay manual in Cook Mode.</p>
    {cooking.stepTimers.map((timer, index) => {
      const prefix = `cooking.stepTimers.${index}`;
      const update = (patch) => setTimers(cooking.stepTimers.map((entry, entryIndex) => entryIndex === index ? { ...entry, ...patch } : entry));
      return <div className="wc-cooking-timer" key={index}>
        <label>Instruction<select value={timer.stepOrder} disabled={busy} aria-invalid={Boolean(errors[`${prefix}.stepOrder`])} onChange={(event) => update({ stepOrder: event.target.value })}><option value="">Choose step</option>{instructions.map((text, stepIndex) => <option key={stepIndex} value={stepIndex + 1}>{stepIndex + 1}. {text.slice(0, 60)}</option>)}</select></label>
        <label>Servings<input type="number" min="1" max="100" step="1" value={timer.servings} disabled={busy} aria-invalid={Boolean(errors[`${prefix}.servings`])} onChange={(event) => update({ servings: event.target.value })} /></label>
        <label>Spice level<select value={timer.spiceLevel ?? ''} disabled={busy} aria-invalid={Boolean(errors[`${prefix}.spiceLevel`])} onChange={(event) => update({ spiceLevel: cooking.defaultSpiceLevel === null ? null : event.target.value })}>{cooking.defaultSpiceLevel === null ? <option value="">No spice selection</option> : <><option value="">Choose level</option>{levels.map((level) => <option key={level} value={level}>{level.replace('_', ' ')}</option>)}</>}</select></label>
        <label>Duration (seconds)<input type="number" min="1" max="10800" step="1" value={timer.durationSeconds} disabled={busy} aria-invalid={Boolean(errors[`${prefix}.durationSeconds`])} onChange={(event) => update({ durationSeconds: event.target.value })} /></label>
        <button type="button" className="wc-btn-secondary" disabled={busy} onClick={() => setTimers(cooking.stepTimers.filter((_, entryIndex) => entryIndex !== index))}>Remove timer</button>
        <FieldError message={err(errors, prefix)} />
      </div>;
    })}
    <button type="button" className="wc-btn-secondary" disabled={busy} onClick={() => setTimers([...cooking.stepTimers, blankStepTimer(cooking.defaultSpiceLevel)])}>Add timer preset</button>
  </fieldset>;
}

function metadataSuggestionKey(item) {
  return `${item.source}:${item.field}:${item.value}`;
}

export function MetadataSuggestionRow({ item, form, busy, accepted, onAccept }) {
  const state = metadataSuggestionState(form, item, accepted);
  const stateLabel = {
    accepted: 'Accepted in current form',
    'already-selected': 'Already selected',
    'existing-preserved': 'Existing category preserved',
  }[state];
  return <li>
    <p><strong>Source:</strong> {item.source} {item.sourceValue}</p>
    <p><strong>Canonical suggestion:</strong> {item.field} → {item.value} ({item.label})</p>
    {state === 'eligible'
      ? <button type="button" className="wc-btn-secondary" disabled={busy} onClick={() => onAccept(item)}>Accept suggestion: {item.label}</button>
      : <p aria-live="polite">{stateLabel}</p>}
  </li>;
}

export function RecipeIntake({ form, change, busy, dispatch }) {
  const [input, setInput] = useState('');
  const [preview, setPreview] = useState(null);
  const [application, setApplication] = useState(null);
  const [acceptedMetadata, setAcceptedMetadata] = useState(() => new Set());
  const [acceptedNutrition, setAcceptedNutrition] = useState(false);
  const [url, setUrl] = useState('');
  const [urlImport, setUrlImport] = useState({ status: 'idle', sourceUrl: '', error: '' });
  const { previewInput, applyPreview, acceptSuggestion, acceptNutrition } = createRecipeIntakeHandlers({
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
    setAcceptedMetadata(new Set());
    setAcceptedNutrition(false);
    setUnresolvedFromPreview(result);
  };
  const handleUrlImport = async () => {
    const result = await importFromUrl();
    if (result.preview) {
      setAcceptedMetadata(new Set());
      setAcceptedNutrition(false);
    }
    setUnresolvedFromPreview(result.preview);
  };
  const handleMetadataAcceptance = (item) => {
    const outcome = acceptSuggestion(item);
    if (outcome.changed) {
      setAcceptedMetadata((current) => new Set(current).add(metadataSuggestionKey(item)));
    }
  };
  const handleNutritionAcceptance = () => {
    const outcome = acceptNutrition();
    if (outcome.changed) setAcceptedNutrition(true);
  };
  const suggestedMetadata = preview?.metadata.filter(({ status }) => status === 'suggested') || [];
  const unsupportedMetadata = preview?.metadata.filter(({ status }) => status !== 'suggested') || [];
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
    <label>Recipe JSON-LD<textarea rows="6" value={input} disabled={busy} onChange={(event) => { setInput(event.target.value); setPreview(null); setApplication(null); setAcceptedMetadata(new Set()); setAcceptedNutrition(false); setUrlImport({ status: 'idle', sourceUrl: '', error: '' }); }} /></label>
    <div className="wc-recipe-intake-actions"><button type="button" className="wc-btn-secondary" disabled={busy || !input.trim()} onClick={handlePreview}>Preview</button>{preview?.ok && preview.mapped.length > 0 && <button type="button" className="wc-btn-secondary" disabled={busy} onClick={applyPreview}>Apply blank fields</button>}</div>
    {preview && !preview.ok && <div className="wc-author-field-error" role="alert">{preview.error.message}</div>}
    {preview?.ok && <div className="wc-recipe-intake-preview">
      <strong>{preview.mapped.length} mapped</strong>
      {preview.mapped.length > 0 && <ul>{preview.mapped.map((item) => <li key={item.field}>{item.source} → {item.field}</li>)}</ul>}
      {suggestedMetadata.length > 0 && <><strong>Metadata suggestions</strong><ul>{suggestedMetadata.map((item) => <MetadataSuggestionRow
        key={metadataSuggestionKey(item)} item={item} form={form} busy={busy}
        accepted={acceptedMetadata.has(metadataSuggestionKey(item))} onAccept={handleMetadataAcceptance}
      />)}</ul></>}
      {preview.nutritionSuggestion && <section className="wc-nutrition-suggestion" aria-labelledby="nutrition-suggestion-title">
        <strong id="nutrition-suggestion-title">Nutrition suggestion</strong>
        <p>{preview.nutritionSuggestion.reason}</p>
        <p><strong>Source:</strong> {preview.nutritionSuggestion.source.url || preview.nutritionSuggestion.source.label}</p>
        <p>Per serving: {preview.nutritionSuggestion.nutrition.caloriesKcal} kcal; {preview.nutritionSuggestion.nutrition.proteinGrams} g protein; {preview.nutritionSuggestion.nutrition.carbohydrateGrams} g carbohydrate; {preview.nutritionSuggestion.nutrition.fatGrams} g fat; {preview.nutritionSuggestion.nutrition.sugarGrams} g sugar; {preview.nutritionSuggestion.nutrition.fiberGrams} g fiber.</p>
        {acceptedNutrition
          ? <p role="status">Accepted in current form. Save the Details step to persist it.</p>
          : <button type="button" className="wc-btn-secondary" disabled={busy} onClick={handleNutritionAcceptance}>Accept nutrition suggestion</button>}
      </section>}
      {unsupportedMetadata.length > 0 && <><strong>Unsupported or ambiguous metadata</strong><ul>{unsupportedMetadata.map((item, index) => <li key={`${item.source}-${index}`}>
        <p><strong>Source:</strong> {item.source} {item.sourceValue}</p>
        <p><strong>{item.status === 'ambiguous' ? 'Ambiguous' : 'Unsupported'}:</strong> {item.reason}</p>
      </li>)}</ul></>}
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

export function IngredientResolutionPanel({
  state, dispatch, busy, onAuthorityLost, creationTarget = null, onOpenCreation = () => {},
  onCloseCreation = () => {}, registerCreateButton = () => {},
}) {
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
        const creationPrefill = ingredientCreationPrefill(entry, state.ingredientResolutionGeneration);
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
          {creationPrefill && <button ref={(node) => registerCreateButton(entry.key, node)} type="button" className="wc-btn-secondary wc-resolution-create" disabled={busy || loading || Boolean(creationTarget)} onClick={() => onOpenCreation({ key: entry.key, generation: entry.generation, sourceText: entry.sourceText, initialValues: creationPrefill })}>+ Create Ingredient</button>}
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
    {creationTarget && <IngredientModal
      initialValues={creationTarget.initialValues}
      sourceContext={creationTarget.sourceText}
      onClose={onCloseCreation}
      onSubmit={createIngredient}
      onAuthorityLost={onAuthorityLost}
      onSuccess={(ingredient) => dispatch({
        type: 'INGREDIENT_CREATION_SUCCESS',
        generation: creationTarget.generation,
        key: creationTarget.key,
        ingredient,
      })}
    />}
  </section>;
}

export function IngredientResolutionPanelWithCreation(props) {
  const [creationTarget, setCreationTarget] = useState(null);
  const createButtonsRef = useRef(new Map());
  const closeCreation = () => {
    const key = creationTarget?.key;
    setCreationTarget(null);
    if (key && typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => createButtonsRef.current.get(key)?.focus());
    }
  };
  const registerCreateButton = (key, node) => {
    if (node) createButtonsRef.current.set(key, node);
    else createButtonsRef.current.delete(key);
  };
  return <IngredientResolutionPanel
    {...props}
    creationTarget={creationTarget}
    onOpenCreation={setCreationTarget}
    onCloseCreation={closeCreation}
    registerCreateButton={registerCreateButton}
  />;
}

export default function RecipeAuthoringSteps({ authoring, canUploadRecipeImage, onAuthorityLost }) {
  const { state, change, selectedFile, setSelectedFile, previewUrl, readiness, setStep, busy, dispatch } = authoring;
  const { form, currentStep, fieldErrors } = state;
  if (currentStep === 'review') return <RecipeReview
    form={form}
    readiness={readiness}
    onNavigate={setStep}
    recipeMeta={state}
    duplicateReview={state.duplicateReview}
    duplicateReviewStatus={state.duplicateReviewStatus}
    duplicateReviewError={state.duplicateReviewError}
    duplicateAcknowledgedDigest={state.duplicateAcknowledgedDigest}
    duplicateReviewFocusRequest={state.duplicateReviewFocusRequest}
    duplicateCheckNeedsSave={authoring.duplicateCheckNeedsSave}
    unresolvedIngredientCount={state.unresolvedIngredients?.length || 0}
    busy={busy}
    onCheckDuplicates={authoring.checkDuplicates}
    onAcknowledgeDuplicateReview={(value) => dispatch({ type: 'ACKNOWLEDGE_DUPLICATE_REVIEW', value })}
  />;

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
    return <div><IngredientResolutionPanelWithCreation state={state} dispatch={dispatch} busy={busy} onAuthorityLost={onAuthorityLost} /><div className="wc-author-section-intro"><p>Blank rows are ignored. Partially completed rows must be finished before saving.</p><button type="button" className="wc-btn-secondary" disabled={form.ingredients.length >= MAX_INGREDIENTS || busy} onClick={() => change('ingredients', [...form.ingredients, blankIngredient()])}><Plus size={15} /> Add ingredient</button></div><FieldError message={err(fieldErrors, 'ingredients')} />
      {form.ingredients.map((row, index) => <div className="wc-author-ingredient" key={row.key}>
        <span className="wc-author-row-number">{index + 1}</span><IngredientPicker value={row.ingredient} disabled={busy} ariaLabel={`Ingredient ${index + 1}`} onChange={(ingredient) => updateRow(index, { ingredient })} />
        <label>Quantity<input type="text" inputMode="decimal" placeholder="e.g. 1 1/2" disabled={row.unit === TO_TASTE_UNIT || busy} value={row.quantity} aria-invalid={Boolean(fieldErrors[`ingredients.${index}.quantity`])} onChange={(e) => updateRow(index, { quantity: e.target.value })} /></label>
        <label>Unit<select value={row.unit} disabled={busy} onChange={(e) => updateRow(index, { unit: e.target.value, quantity: e.target.value === TO_TASTE_UNIT ? '' : row.quantity })}>{RECIPE_UNITS.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}</select></label>
        <label className="wc-author-check"><input type="checkbox" checked={row.optional} disabled={busy} onChange={(e) => updateRow(index, { optional: e.target.checked })} /> Optional</label>
        <label className="wc-author-note">Note<input value={row.note} maxLength={200} disabled={busy} onChange={(e) => updateRow(index, { note: e.target.value })} /></label>
        <button type="button" className="wc-icon-btn danger" aria-label={`Remove ingredient ${index + 1}`} disabled={busy} onClick={() => change('ingredients', form.ingredients.length === 1 ? [blankIngredient()] : form.ingredients.filter((_, i) => i !== index))}><Trash2 size={15} /></button>
      </div>)}
      <CookingSpiceEditor form={form} change={change} busy={busy} errors={fieldErrors} />
    </div>;
  }

  if (currentStep === 'instructions') {
    const move = (from, to) => { const rows = [...form.instructions]; const [item] = rows.splice(from, 1); rows.splice(to, 0, item); change('instructions', rows); };
    return <div><div className="wc-author-section-intro"><p>Blank instructions are ignored and saved steps are renumbered automatically.</p><button type="button" className="wc-btn-secondary" disabled={form.instructions.length >= MAX_INSTRUCTIONS || busy} onClick={() => change('instructions', [...form.instructions, ''])}><Plus size={15} /> Add instruction</button></div><FieldError message={err(fieldErrors, 'instructions')} />
      {form.instructions.map((text, index) => <div className="wc-author-instruction" key={index}><span>{index + 1}</span><textarea rows="3" value={text} maxLength={MAX_INSTRUCTION_LENGTH} disabled={busy} aria-label={`Instruction ${index + 1}`} aria-invalid={Boolean(fieldErrors[`instructions.${index}`])} onChange={(e) => change('instructions', form.instructions.map((value, i) => i === index ? e.target.value : value))} />
        <div><button type="button" aria-label="Move up" disabled={index === 0 || busy} onClick={() => move(index, index - 1)}><ArrowUp size={14} /></button><button type="button" aria-label="Move down" disabled={index === form.instructions.length - 1 || busy} onClick={() => move(index, index + 1)}><ArrowDown size={14} /></button><button type="button" aria-label="Remove instruction" disabled={busy} onClick={() => change('instructions', form.instructions.length === 1 ? [''] : form.instructions.filter((_, i) => i !== index))}><Trash2 size={14} /></button></div></div>)}
      <CookingTimerEditor form={form} change={change} busy={busy} errors={fieldErrors} />
    </div>;
  }

  return <div className="wc-author-fields wc-author-details">
    <label>Difficulty<select value={form.difficulty} aria-invalid={Boolean(fieldErrors.difficulty)} onChange={(e) => change('difficulty', e.target.value)}><option value="">Not set</option>{RECIPE_DIFFICULTIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><FieldError message={fieldErrors.difficulty} />
    <div className="wc-author-grid"><label>Prep time (minutes)<input type="number" inputMode="numeric" min="1" max={MAX_PREP_TIME_MINUTES} step="1" value={form.prepTimeMinutes} aria-invalid={Boolean(fieldErrors.prepTimeMinutes)} onChange={(e) => change('prepTimeMinutes', e.target.value)} /></label><fieldset className="wc-author-duration"><legend>Cooking time</legend><div><label>Hours<input type="number" inputMode="numeric" min="0" max="24" step="1" value={form.cookTimeHours} aria-invalid={Boolean(fieldErrors.cookTimeMinutes)} onChange={(e) => change('cookTimeHours', e.target.value)} /></label><label>Minutes<input type="number" inputMode="numeric" min="0" max="59" step="1" value={form.cookTimeMinutePart} aria-invalid={Boolean(fieldErrors.cookTimeMinutes)} onChange={(e) => change('cookTimeMinutePart', e.target.value)} /></label></div></fieldset><label>Servings<input type="number" inputMode="numeric" min="1" max={MAX_SERVINGS} step="1" value={form.servings} aria-invalid={Boolean(fieldErrors.servings)} onChange={(e) => change('servings', e.target.value)} /></label></div>
    <FieldError message={fieldErrors.prepTimeMinutes || fieldErrors.cookTimeMinutes || fieldErrors.servings} />
    <div className="wc-author-grid"><label>Region<select value={form.region} aria-invalid={Boolean(fieldErrors.region)} onChange={(e) => change('region', e.target.value)}><option value="">Not set</option>{RECIPE_REGIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label>Category<select value={form.category} aria-invalid={Boolean(fieldErrors.category)} onChange={(e) => change('category', e.target.value)}><option value="">Not set</option>{RECIPE_CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label></div><FieldError message={fieldErrors.region || fieldErrors.category} />
    <fieldset><legend>Dietary tags</legend><div className="wc-author-tags">{RECIPE_DIETARY_TAGS.map((tag) => <label className="wc-author-check" key={tag.value}><input type="checkbox" checked={form.dietaryTags.includes(tag.value)} onChange={(e) => change('dietaryTags', e.target.checked ? [...form.dietaryTags, tag.value] : form.dietaryTags.filter((value) => value !== tag.value))} /> {tag.label}</label>)}</div></fieldset><FieldError message={fieldErrors.dietaryTags} />
    <fieldset className="wc-author-nutrition"><legend>Authoritative nutrition</legend>
      <label className="wc-author-check"><input type="checkbox" checked={form.nutrition !== null} disabled={busy} onChange={(event) => {
        change('nutrition', event.target.checked ? blankNutrition() : null);
        if (event.target.checked) change('nutritionSource', { kind: 'manual', label: '', url: '' });
      }} /> Nutrition is available</label>
      <p className="wc-author-hint">Values are fixed per serving and are never estimated or scaled.</p>
      {form.nutrition !== null && <>
        <div className="wc-nutrition-grid">{NUTRIENT_FIELDS.map(([field, label, unit]) => <label key={field}>{label} ({unit})<input type="number" inputMode="decimal" min="0" step="any" value={form.nutrition[field]} aria-invalid={Boolean(fieldErrors[`nutrition.${field}`])} onChange={(event) => change('nutrition', { ...form.nutrition, [field]: event.target.value })} /></label>)}</div>
        <FieldError message={err(fieldErrors, 'nutrition')} />
        <label>Source description<input value={form.nutritionSource.label} maxLength="500" aria-invalid={Boolean(fieldErrors['nutritionSource.label'])} onChange={(event) => change('nutritionSource', { ...form.nutritionSource, label: event.target.value })} /></label>
        <FieldError message={fieldErrors['nutritionSource.label']} />
        <label>Source URL (optional)<input type="url" value={form.nutritionSource.url} aria-invalid={Boolean(fieldErrors['nutritionSource.url'])} onChange={(event) => change('nutritionSource', { ...form.nutritionSource, url: event.target.value })} /></label>
        <FieldError message={fieldErrors['nutritionSource.url']} />
      </>}
    </fieldset>
  </div>;
}
