import { useState } from 'react';
import { ArrowDown, ArrowUp, ImageOff, Plus, Trash2 } from 'lucide-react';
import IngredientPicker from '../IngredientPicker.jsx';
import {
  MAX_DESCRIPTION_LENGTH, MAX_INGREDIENTS, MAX_INSTRUCTION_LENGTH,
  MAX_INSTRUCTIONS, MAX_PREP_TIME_MINUTES, MAX_SERVINGS,
  RECIPE_DIETARY_TAGS, RECIPE_DIFFICULTIES, RECIPE_UNITS, TO_TASTE_UNIT,
} from '../recipeOptions.js';
import { blankIngredient } from './recipeAuthoringModel.js';
import { createRecipeIntakeHandlers } from './recipeIntake.js';
import RecipeReview from './RecipeReview.jsx';

function FieldError({ message }) { return message ? <div className="wc-author-field-error" role="alert">{message}</div> : null; }
function err(errors, prefix) { return errors[prefix] || Object.entries(errors).find(([key]) => key.startsWith(`${prefix}.`))?.[1]; }

function RecipeIntake({ form, change, busy }) {
  const [input, setInput] = useState('');
  const [preview, setPreview] = useState(null);
  const [application, setApplication] = useState(null);
  const { previewInput, applyPreview } = createRecipeIntakeHandlers({
    input, form, preview, change, setPreview,
    setApplication,
  });
  return <section className="wc-recipe-intake" aria-labelledby="recipe-intake-title">
    <h2 id="recipe-intake-title">Prefill from Recipe JSON-LD</h2>
    <p>Paste one Recipe object to preview safe fields. Nothing is saved or published automatically.</p>
    <label>Recipe JSON-LD<textarea rows="6" value={input} disabled={busy} onChange={(event) => { setInput(event.target.value); setPreview(null); setApplication(null); }} /></label>
    <div className="wc-recipe-intake-actions"><button type="button" className="wc-btn-secondary" disabled={busy || !input.trim()} onClick={previewInput}>Preview</button>{preview?.ok && preview.mapped.length > 0 && <button type="button" className="wc-btn-secondary" disabled={busy} onClick={applyPreview}>Apply blank fields</button>}</div>
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

export default function RecipeAuthoringSteps({ authoring, canUploadRecipeImage }) {
  const { state, change, selectedFile, setSelectedFile, previewUrl, readiness, setStep, busy, dispatch } = authoring;
  const { form, currentStep, fieldErrors } = state;
  if (currentStep === 'review') return <RecipeReview form={form} readiness={readiness} onNavigate={setStep} recipeMeta={state} />;

  if (currentStep === 'basics') return <div className="wc-author-fields">
    {!state.recipeId && <RecipeIntake form={form} change={change} busy={busy} />}
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
    return <div><div className="wc-author-section-intro"><p>Blank rows are ignored. Partially completed rows must be finished before saving.</p><button type="button" className="wc-btn-secondary" disabled={form.ingredients.length >= MAX_INGREDIENTS || busy} onClick={() => change('ingredients', [...form.ingredients, blankIngredient()])}><Plus size={15} /> Add ingredient</button></div><FieldError message={err(fieldErrors, 'ingredients')} />
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
