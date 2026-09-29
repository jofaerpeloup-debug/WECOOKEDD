import { useEffect, useRef } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, X } from 'lucide-react';
import useRecipeAuthoring from './useRecipeAuthoring.js';
import { AUTHORING_STEPS, STEP_LABELS } from './recipeAuthoringModel.js';
import { shouldShowPublishAcknowledgement } from './recipeAuthoringState.js';
import RecipeAuthoringSteps from './RecipeAuthoringSteps.jsx';
import './recipeAuthoring.css';

export default function RecipeAuthoringWizard({ recipe, onClose, onSaved, onPublished, canUploadRecipeImage, onAuthorityLost }) {
  const authoring = useRecipeAuthoring({ recipe, onSaved, onPublished, onAuthorityLost });
  const { state, busy, back, next, saveCurrent, publish, requestClose, dispatch, reloadLatest } = authoring;
  const stepIndex = AUTHORING_STEPS.indexOf(state.currentStep);
  const dialogRef = useRef(null);
  const acknowledgementRef = useRef(null);
  const close = () => requestClose(onClose);
  useEffect(() => {
    if (Object.keys(state.fieldErrors).length) dialogRef.current?.querySelector('[aria-invalid="true"]')?.focus();
  }, [state.fieldErrors]);
  useEffect(() => {
    if (state.publishAcknowledgementError) acknowledgementRef.current?.focus();
  }, [state.publishAcknowledgementError]);

  return <div className="wc-author-overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }} onKeyDown={(e) => { if (e.key === 'Escape') close(); }}>
    <div ref={dialogRef} className="wc-author-dialog" role="dialog" aria-modal="true" aria-labelledby="recipe-author-title">
      <header><div><span className="wc-author-kicker">{state.recipeId ? (state.publicationStatus === 'draft' ? 'Recipe Draft' : 'Published recipe') : 'New recipe'}</span><h1 id="recipe-author-title">{state.recipeId ? state.form.title || 'Untitled recipe' : 'Add recipe'}</h1></div><button type="button" className="wc-modal-close" aria-label="Close recipe authoring" disabled={busy} onClick={close}><X size={19} /></button></header>
      <nav className="wc-author-stepper" aria-label="Recipe authoring progress">{AUTHORING_STEPS.map((step, index) => <button type="button" key={step} className={state.currentStep === step ? 'current' : index < stepIndex ? 'visited' : ''} aria-current={state.currentStep === step ? 'step' : undefined} disabled={busy || index >= stepIndex} onClick={() => authoring.setStep(step)}><span>{index + 1}</span>{STEP_LABELS[step]}</button>)}</nav>

      {state.publicationStatus === 'published' && <div className="wc-author-banner">Changes to a Published recipe are visible to users immediately.</div>}
      {!state.isActive && <div className="wc-author-banner archived">This recipe is archived. Saved changes will become visible when it is restored.</div>}
      {state.formError && <div className="wc-author-error" role="alert"><AlertTriangle size={17} /><span>{state.formError}</span></div>}
      {state.notice && <div className="wc-author-notice" role="status">{state.notice}</div>}
      {state.conflict && <div className="wc-author-conflict"><strong>This recipe was changed by another Moderator.</strong><p>Reload the latest version before making another change.</p><button type="button" className="wc-btn-secondary" onClick={reloadLatest}>Reload latest version</button><button type="button" className="wc-btn-secondary" onClick={close}>Close</button></div>}

      <main aria-busy={busy}><RecipeAuthoringSteps authoring={authoring} canUploadRecipeImage={canUploadRecipeImage} onAuthorityLost={onAuthorityLost} /></main>

      {shouldShowPublishAcknowledgement(state) && <div className={`wc-author-ack${state.publishAcknowledgementError ? ' error' : ''}`}><label><input ref={acknowledgementRef} type="checkbox" checked={state.publishAcknowledged} disabled={busy || state.conflict || state.status === 'uncertain'} aria-invalid={state.publishAcknowledgementError ? 'true' : undefined} aria-errormessage={state.publishAcknowledgementError ? 'publish-acknowledgement-error' : undefined} aria-describedby={state.publishAcknowledgementError ? 'publish-acknowledgement-error' : undefined} onChange={(e) => dispatch({ type: 'ACKNOWLEDGE', value: e.target.checked })} /> I confirm that this recipe belongs to Filipino cuisine.</label>{state.publishAcknowledgementError && <div id="publish-acknowledgement-error" className="wc-author-ack-error" role="alert">{state.publishAcknowledgementError}</div>}</div>}
      <footer><div><button type="button" className="wc-btn-secondary" disabled={busy} onClick={close}>Cancel</button>{stepIndex > 0 && <button type="button" className="wc-btn-secondary" disabled={busy || state.conflict} onClick={back}><ChevronLeft size={16} /> Back</button>}</div><div>
        <button type="button" className="wc-btn-secondary" disabled={busy || state.conflict || state.status === 'uncertain'} onClick={() => saveCurrent()}>{state.status === 'saving' || state.status === 'uploading' ? 'Saving…' : state.publicationStatus === 'published' ? 'Save changes' : 'Save Draft'}</button>
        {state.currentStep !== 'review' ? <button type="button" className="wc-btn-primary" disabled={busy || state.conflict || state.status === 'uncertain'} onClick={next}>Next <ChevronRight size={16} /></button> : state.publicationStatus === 'draft' && <button type="button" className="wc-btn-primary" disabled={busy || state.conflict || state.status === 'uncertain'} onClick={publish}>{state.status === 'publishing' || state.status === 'recovering' ? 'Checking publication…' : 'Publish'}</button>}
      </div></footer>
    </div>

    {state.closeConfirmation && <div className="wc-author-confirm-overlay"><div className="wc-author-confirm" role="alertdialog" aria-modal="true" aria-labelledby="discard-title"><h2 id="discard-title">Discard unsaved changes?</h2><p>Your saved Draft or recipe will remain, but local changes will be lost.</p><div><button type="button" autoFocus className="wc-btn-secondary" onClick={() => dispatch({ type: 'CANCEL_CLOSE' })}>Keep editing</button><button type="button" className="wc-btn-primary" onClick={onClose}>Discard unsaved changes</button></div></div></div>}
    {state.reloadConfirmation && <div className="wc-author-confirm-overlay"><div className="wc-author-confirm" role="alertdialog" aria-modal="true" aria-labelledby="reload-title"><h2 id="reload-title">Replace local changes?</h2><p>Reloading will discard your unsaved local work.</p><div><button type="button" autoFocus className="wc-btn-secondary" onClick={() => dispatch({ type: 'CANCEL_RELOAD' })}>Keep editing</button><button type="button" className="wc-btn-primary" onClick={reloadLatest}>Reload latest version</button></div></div></div>}
  </div>;
}
