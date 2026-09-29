import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ApiError } from '../apiClient.js';
import * as recipeApi from '../recipeApi.js';
import {
  createDraft, getRecipe, publishRecipe, updateRecipe, uploadRecipeImage,
} from '../recipeApi.js';
import {
  createDraftAndRefresh, publishRecipeAndRefresh, updateRecipeAndRefresh,
} from '../recipeCatalogMutations.js';
import {
  AUTHORING_STEPS, buildStepPatch, createDraftBody, dirtySteps, formFromRecipe, mutationBody,
  publicationReadiness, publishBody, stepForField, validateStep,
} from './recipeAuthoringModel.js';
import {
  duplicateReviewGate, hasUnsavedChanges, initialAuthoringState, isMutationBusy, publishAcknowledgementGate,
  recipeAuthoringReducer, resolveBasicsImageUpload,
} from './recipeAuthoringState.js';

function errorMessage(error) {
  if (error instanceof ApiError) {
    if (error.isUnauthorized) return 'Your session has expired. Please sign in again.';
    return error.message;
  }
  return 'Something went wrong. Please try again.';
}

function errorsFromApi(error) {
  const errors = {};
  for (const detail of error?.details || []) errors[String(detail.field || 'form')] = detail.message;
  return errors;
}

function noPatchNotice(state) {
  if (hasUnsavedChanges(state)) return 'No changes to save for this step. Other edits remain unsaved.';
  return state.publicationStatus === 'published' ? 'All changes are saved.' : 'Draft is saved.';
}

export default function useRecipeAuthoring({ recipe, readOnly = false, onSaved, onPublished, onAuthorityLost }) {
  const [state, dispatch] = useReducer(recipeAuthoringReducer, { recipe, readOnly }, initialAuthoringState);
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const flightRef = useRef(false);
  useEffect(() => {
    if (!selectedFile) { setPreviewUrl(''); return undefined; }
    const url = URL.createObjectURL(selectedFile); setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [selectedFile]);

  const loadLatest = useCallback(async ({ keepStep = false } = {}) => {
    if (!recipe?.id && !state.recipeId) return null;
    dispatch({ type: 'LOAD_START' });
    try {
      const latest = await getRecipe(state.recipeId || recipe.id);
      dispatch({ type: 'LOAD_SUCCESS', recipe: latest, keepStep });
      setSelectedFile(null);
      return latest;
    } catch (error) {
      if (error instanceof ApiError && error.isForbidden) onAuthorityLost?.();
      dispatch({ type: 'SAVE_FAILURE', message: errorMessage(error) });
      return null;
    }
  }, [onAuthorityLost, recipe?.id, state.recipeId]);

  useEffect(() => { if (recipe?.id) loadLatest(); }, [recipe?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const change = useCallback((field, value) => dispatch({ type: 'CHANGE', field, value }), []);
  const setStep = useCallback((step) => dispatch({ type: 'SET_STEP', step }), []);

  const handleFailure = useCallback((error) => {
    if (error instanceof ApiError && error.isForbidden) onAuthorityLost?.();
    if (error?.code === 'RECIPE_EDIT_CONFLICT') { dispatch({ type: 'CONFLICT' }); return; }
    const fieldErrors = errorsFromApi(error);
    dispatch({ type: 'SAVE_FAILURE', fieldErrors, message: errorMessage(error) });
  }, [onAuthorityLost]);

  const saveCurrent = useCallback(async ({ advance = false } = {}) => {
    if (flightRef.current || readOnly || state.conflict || state.status === 'uncertain') return false;
    const step = state.currentStep === 'review' ? null : state.currentStep;
    if (!step) { dispatch({ type: 'SAVE_SUCCESS', preserveWorking: true, notice: noPatchNotice(state) }); return true; }
    const fieldErrors = validateStep(state.form, step, { published: state.publicationStatus === 'published' });
    if (Object.keys(fieldErrors).length) { dispatch({ type: 'SET_ERRORS', fieldErrors }); return false; }
    flightRef.current = true;
    dispatch({ type: 'MUTATION_START', status: selectedFile || state.retainedUpload ? 'uploading' : 'saving' });
    let draftCreated = false;
    try {
      let latest;
      let recipeId = state.recipeId;
      let token = state.updatedAt;
      let savedBase = state.saved;
      if (!recipeId) {
        latest = await createDraftAndRefresh(createDraftBody(state.form), onSaved, createDraft);
        draftCreated = true;
        recipeId = latest.id;
        token = latest.updatedAt;
        savedBase = formFromRecipe(latest);
        dispatch({ type: 'DRAFT_CREATED', recipe: latest, status: selectedFile ? 'uploading' : 'saving' });
        // Draft creation is independently authoritative. The mutation helper
        // has already refreshed the catalog before optional follow-up work.
      }

      let patch = buildStepPatch(savedBase, state.form, step);
      let uploaded = null;
      if (step === 'basics') {
        const resolvedUpload = await resolveBasicsImageUpload({
          selectedFile, retainedUpload: state.retainedUpload, upload: uploadRecipeImage,
        });
        uploaded = resolvedUpload.image;
        if (resolvedUpload.uploadedNow) dispatch({ type: 'RETAIN_UPLOAD', image: uploaded });
      }
      if (uploaded) {
        patch = { ...patch, imageUrl: uploaded.url, imageAssetId: uploaded.assetId };
      }
      if (Object.keys(patch).length) {
        latest = await updateRecipeAndRefresh(recipeId, mutationBody(patch, token), onSaved, updateRecipe);
      }
      else if (!latest) {
        dispatch({ type: 'SAVE_SUCCESS', preserveWorking: true, notice: noPatchNotice(state) });
        if (advance) setStep(AUTHORING_STEPS[AUTHORING_STEPS.indexOf(step) + 1]);
        return true;
      }

      dispatch({ type: 'SAVE_SUCCESS', recipe: latest, step, preserveWorking: true, clearUpload: Boolean(uploaded), notice: state.publicationStatus === 'published' ? 'Changes saved and visible to users.' : 'Draft saved.' });
      if (uploaded) setSelectedFile(null);
      if (advance) setStep(AUTHORING_STEPS[AUTHORING_STEPS.indexOf(step) + 1]);
      return true;
    } catch (error) {
      if (!state.recipeId && !draftCreated && error instanceof ApiError && error.isNetworkError) {
        dispatch({ type: 'UNCERTAIN', message: 'The Draft creation outcome is uncertain. Return to recipes or refresh before starting another Draft; do not retry this creation blindly.' });
      } else handleFailure(error);
      return false;
    } finally { flightRef.current = false; }
  }, [handleFailure, onSaved, readOnly, selectedFile, setStep, state]);

  const next = useCallback(() => saveCurrent({ advance: true }), [saveCurrent]);
  const back = useCallback(() => {
    const index = AUTHORING_STEPS.indexOf(state.currentStep);
    if (index > 0 && !isMutationBusy(state) && !state.conflict) setStep(AUTHORING_STEPS[index - 1]);
  }, [setStep, state]);

  const duplicateCheckNeedsSave = dirtySteps(state.saved, state.form).length > 0 || Boolean(selectedFile);
  const checkDuplicates = useCallback(async () => {
    if (flightRef.current || readOnly || !state.recipeId || state.publicationStatus !== 'draft') return;
    if (duplicateCheckNeedsSave) {
      dispatch({ type: 'DUPLICATE_CHECK_FAILURE', message: 'Save changes before checking for duplicates and variants.' });
      return;
    }
    const readiness = publicationReadiness(state.form);
    if (!readiness.complete) {
      dispatch({ type: 'DUPLICATE_CHECK_FAILURE', message: 'Complete and save the Recipe before checking for duplicates and variants.' });
      return;
    }
    flightRef.current = true;
    dispatch({ type: 'DUPLICATE_CHECK_START' });
    try {
      const review = await recipeApi.checkRecipeDuplicates(state.recipeId, state.updatedAt);
      dispatch({ type: 'DUPLICATE_CHECK_SUCCESS', review });
    } catch (error) {
      if (error instanceof ApiError && error.isForbidden) onAuthorityLost?.();
      if (error?.code === 'RECIPE_EDIT_CONFLICT') dispatch({ type: 'CONFLICT' });
      else dispatch({ type: 'DUPLICATE_CHECK_FAILURE', message: errorMessage(error) });
    } finally { flightRef.current = false; }
  }, [duplicateCheckNeedsSave, onAuthorityLost, readOnly, state]);

  const publish = useCallback(async () => {
    if (flightRef.current || !state.recipeId || state.status === 'uncertain') return;
    const acknowledgement = publishAcknowledgementGate(state);
    if (!acknowledgement.allowed) {
      dispatch({ type: 'PUBLISH_ACKNOWLEDGEMENT_REQUIRED' });
      return;
    }
    const readiness = publicationReadiness(state.form);
    if (!readiness.complete) {
      const step = AUTHORING_STEPS.slice(0, 4).find((name) => !readiness.sections[name].complete);
      dispatch({ type: 'SET_STEP', step });
      dispatch({ type: 'SET_ERRORS', fieldErrors: readiness.sections[step].errors, message: 'Complete the highlighted section before publishing.' });
      return;
    }
    const duplicateGate = duplicateReviewGate(state);
    if (!duplicateGate.allowed) {
      dispatch({ type: 'DUPLICATE_GATE_FAILURE', message: duplicateGate.error });
      return;
    }
    flightRef.current = true;
    dispatch({ type: 'MUTATION_START', status: 'publishing' });
    try {
      const latest = await publishRecipeAndRefresh(state.recipeId, publishBody(state.updatedAt, state.duplicateReview), onPublished, publishRecipe);
      dispatch({ type: 'LOAD_SUCCESS', recipe: latest, keepStep: true });
    } catch (error) {
      const freshDuplicateReview = error?.details?.find?.((detail) => detail?.field === 'duplicateReview')?.duplicateReview;
      if ((error?.code === 'RECIPE_DUPLICATE_REVIEW_STALE' || error?.code === 'RECIPE_DUPLICATE_REVIEW_REQUIRED') && freshDuplicateReview) {
        dispatch({ type: 'DUPLICATE_REVIEW_STALE', review: freshDuplicateReview, message: errorMessage(error) });
      }
      else if (error?.code === 'RECIPE_EDIT_CONFLICT') dispatch({ type: 'CONFLICT' });
      else if (error?.code === 'RECIPE_ARCHIVED') dispatch({ type: 'SAVE_FAILURE', message: 'Restore this archived Draft before publishing.' });
      else if (error?.code === 'RECIPE_INGREDIENT_NOT_FOUND' || error?.code === 'RECIPE_INGREDIENT_INACTIVE') {
        dispatch({ type: 'SET_STEP', step: 'ingredients' });
        dispatch({ type: 'SET_ERRORS', fieldErrors: { ingredients: errorMessage(error) }, message: 'Review the recipe ingredients before publishing.' });
      }
      else if (error?.code === 'RECIPE_INCOMPLETE' || error?.code === 'VALIDATION_ERROR') {
        const mapped = errorsFromApi(error); const first = Object.keys(mapped)[0]; const step = stepForField(first);
        dispatch({ type: 'SET_STEP', step }); dispatch({ type: 'SET_ERRORS', fieldErrors: mapped, message: errorMessage(error) });
      } else if (error instanceof ApiError && (error.isNetworkError || error.code === 'RECIPE_NOT_DRAFT')) {
        dispatch({ type: 'MUTATION_START', status: 'recovering' });
        try {
          const latest = await getRecipe(state.recipeId);
          if ((latest.publicationStatus || 'published') === 'published') { dispatch({ type: 'LOAD_SUCCESS', recipe: latest, keepStep: true }); onPublished?.(latest); }
          else dispatch({ type: 'SAVE_FAILURE', message: 'The recipe is still a Draft. You may explicitly try Publish again.' });
        } catch {
          dispatch({ type: 'UNCERTAIN', message: 'Publication outcome is uncertain and could not be verified. Keep this window open and refresh the recipe list before attempting Publish again.' });
        }
      } else handleFailure(error);
    } finally { flightRef.current = false; }
  }, [handleFailure, onPublished, state]);

  const requestClose = useCallback((close) => {
    if (isMutationBusy(state)) return;
    if (hasUnsavedChanges(state) || selectedFile) dispatch({ type: 'ASK_CLOSE' }); else close();
  }, [selectedFile, state]);

  const reloadLatest = useCallback(async () => {
    if (hasUnsavedChanges(state) && !state.reloadConfirmation) { dispatch({ type: 'ASK_RELOAD' }); return; }
    await loadLatest({ keepStep: true });
  }, [loadLatest, state]);

  return {
    state, dispatch, selectedFile, setSelectedFile, previewUrl, change, setStep, saveCurrent, next, back, publish,
    checkDuplicates, duplicateCheckNeedsSave,
    loadLatest, reloadLatest, requestClose, busy: isMutationBusy(state), dirty: hasUnsavedChanges(state) || Boolean(selectedFile),
    readiness: useMemo(() => publicationReadiness(state.form), [state.form]),
  };
}
