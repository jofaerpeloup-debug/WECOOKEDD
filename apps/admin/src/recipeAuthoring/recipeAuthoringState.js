import { dirtySteps, emptyRecipeForm, firstIncompleteStep, formFromRecipe } from './recipeAuthoringModel.js';
import {
  confirmIngredientResolution, createUnresolvedIngredientQueue, mergeIngredientResolutionResults,
} from './recipeIngredientResolution.js';

export const PUBLISH_ACKNOWLEDGEMENT_ERROR = 'Confirm that this recipe belongs to Filipino cuisine before publishing.';
export const DUPLICATE_REVIEW_REQUIRED_ERROR = 'Check for duplicates and variants before publishing.';

export function ingredientErrorFields(error, form) {
  const fields = {};
  for (const detail of Array.isArray(error?.details) ? error.details : []) {
    const field = String(detail?.field || '');
    const defaultIngredient = field === 'ingredients' || /^ingredients\.\d+\.(?:ingredient|ingredientId)$/.test(field);
    const alternativeIngredient = form?.cooking?.defaultSpiceLevel != null
      && /^cooking\.spiceAlternatives\.\d+\.ingredients(?:\.\d+\.(?:ingredient|ingredientId))?$/.test(field);
    if (defaultIngredient || alternativeIngredient) fields[field] = detail.message || error.message;
  }
  // Current Recipe API eligibility errors carry no field details. Keep their
  // repair message visible without guessing which authored list failed.
  return Object.keys(fields).length ? fields : { ingredients: error?.message || 'Review the recipe ingredients.' };
}

function emptyDuplicateReview() {
  return {
    duplicateReviewStatus: 'idle', duplicateReview: null, duplicateReviewError: '',
    duplicateAcknowledgedDigest: null, duplicateReviewFocusRequest: 0,
  };
}

function duplicateInputs(form) {
  return JSON.stringify({
    title: form?.title || '',
    ingredients: (form?.ingredients || []).map((row) => ({
      ingredientId: row.ingredient?.id || null, quantity: row.quantity, unit: row.unit,
    })),
    instructions: form?.instructions || [],
  });
}

function invalidateDuplicateReview(state) {
  return { ...state, ...emptyDuplicateReview(), duplicateReviewFocusRequest: state.duplicateReviewFocusRequest || 0 };
}

export function initialAuthoringState({ recipe = null, readOnly = false } = {}) {
  const form = formFromRecipe(recipe);
  return {
    mode: readOnly ? 'view' : recipe ? 'edit' : 'new', recipeId: recipe?.id || null,
    publicationStatus: recipe?.publicationStatus || (recipe ? 'published' : 'draft'), isActive: recipe?.isActive ?? true,
    saved: form, form, currentStep: recipe ? firstIncompleteStep(form) : 'basics',
    updatedAt: recipe?.updatedAt || null, status: recipe ? 'loading' : 'idle',
    fieldErrors: {}, formError: '', notice: '', conflict: false, publishAcknowledged: false, publishAcknowledgementError: '',
    closeConfirmation: false, reloadConfirmation: false, retainedUpload: null,
    unresolvedIngredients: [], ingredientResolutionGeneration: 0,
    ingredientResolutionStatus: 'idle', ingredientResolutionError: '', ingredientResolutionRequest: null,
    ...emptyDuplicateReview(),
  };
}

export function recipeAuthoringReducer(state, action) {
  switch (action.type) {
    case 'LOAD_START': return { ...state, status: 'loading', formError: '' };
    case 'LOAD_SUCCESS': {
      const form = formFromRecipe(action.recipe);
      return { ...state, recipeId: action.recipe.id, publicationStatus: action.recipe.publicationStatus || 'published', isActive: action.recipe.isActive,
        saved: form, form, updatedAt: action.recipe.updatedAt, currentStep: action.keepStep ? state.currentStep : firstIncompleteStep(form),
        status: 'idle', fieldErrors: {}, formError: '', conflict: false, reloadConfirmation: false,
        publishAcknowledged: false, publishAcknowledgementError: '',
        retainedUpload: null, unresolvedIngredients: [], ingredientResolutionStatus: 'idle',
        ingredientResolutionError: '', ingredientResolutionRequest: null, ...emptyDuplicateReview() };
    }
    case 'CHANGE': {
      const form = { ...state.form, [action.field]: action.value };
      const clearedField = /^cookTime(?:Hours|MinutePart)$/.test(action.field) ? 'cookTimeMinutes' : action.field;
      const fieldErrors = { ...state.fieldErrors, [clearedField]: undefined };
      if (action.field === 'cooking') Object.keys(fieldErrors).filter((key) => key.startsWith('cooking.')).forEach((key) => { delete fieldErrors[key]; });
      const next = { ...state, form, notice: '', fieldErrors,
        publishAcknowledged: state.currentStep === 'review' ? false : state.publishAcknowledged,
        publishAcknowledgementError: state.currentStep === 'review' ? '' : state.publishAcknowledgementError };
      return ['title', 'ingredients', 'instructions', 'cooking'].includes(action.field) ? invalidateDuplicateReview(next) : next;
    }
    case 'SET_UNRESOLVED_INGREDIENTS': {
      const generation = state.ingredientResolutionGeneration + 1;
      return invalidateDuplicateReview({ ...state,
        unresolvedIngredients: createUnresolvedIngredientQueue(action.lines || [], generation),
        ingredientResolutionGeneration: generation, ingredientResolutionStatus: 'idle',
        ingredientResolutionError: '', ingredientResolutionRequest: null });
    }
    case 'INGREDIENT_RESOLUTION_START':
      if (action.generation !== state.ingredientResolutionGeneration) return state;
      return { ...state,
        unresolvedIngredients: state.unresolvedIngredients.map((entry) => entry.resolution?.match?.kind === 'none'
          ? { ...entry, resolution: null }
          : entry),
        ingredientResolutionStatus: 'loading', ingredientResolutionError: '',
        ingredientResolutionRequest: action.request };
    case 'INGREDIENT_RESOLUTION_SUCCESS':
      if (action.generation !== state.ingredientResolutionGeneration) return state;
      return { ...state, unresolvedIngredients: mergeIngredientResolutionResults(
        state.unresolvedIngredients, action.request, action.resolutions
      ), ingredientResolutionStatus: 'idle', ingredientResolutionError: '', ingredientResolutionRequest: null };
    case 'INGREDIENT_RESOLUTION_FAILURE':
      if (action.generation !== state.ingredientResolutionGeneration) return state;
      return { ...state, ingredientResolutionStatus: 'idle', ingredientResolutionError: action.message,
        ingredientResolutionRequest: null };
    case 'UPDATE_INGREDIENT_RESOLUTION':
      if (state.ingredientResolutionStatus === 'loading') return state;
      return { ...state, unresolvedIngredients: state.unresolvedIngredients.map((entry, index) => index === action.index
        ? { ...entry, ...action.patch, confirmationError: '' }
        : entry) };
    case 'INGREDIENT_CREATION_SUCCESS': {
      if (action.generation !== state.ingredientResolutionGeneration) return state;
      const ingredient = action.ingredient;
      if (!ingredient || typeof ingredient.id !== 'string' || typeof ingredient.name !== 'string') return state;
      let matched = false;
      const unresolvedIngredients = state.unresolvedIngredients.map((entry) => {
        if (entry.key !== action.key || entry.generation !== action.generation) return entry;
        matched = true;
        return { ...entry, selectedIngredient: { id: ingredient.id, name: ingredient.name }, confirmationError: '' };
      });
      return matched ? { ...state, unresolvedIngredients } : state;
    }
    case 'CONFIRM_INGREDIENT_RESOLUTION': {
      if (state.ingredientResolutionStatus === 'loading') return state;
      const result = confirmIngredientResolution(state.form, state.unresolvedIngredients, action.index);
      if (result.error) return { ...state, unresolvedIngredients: state.unresolvedIngredients.map((entry, index) => index === action.index
        ? { ...entry, confirmationError: result.error }
        : entry) };
      return invalidateDuplicateReview({ ...state, form: result.form, unresolvedIngredients: result.queue, notice: '' });
    }
    case 'DRAFT_CREATED': {
      const serverForm = formFromRecipe(action.recipe);
      return invalidateDuplicateReview({ ...state, recipeId: action.recipe.id, publicationStatus: 'draft', isActive: action.recipe.isActive,
        saved: serverForm, updatedAt: action.recipe.updatedAt, status: action.status || 'saving' });
    }
    case 'SET_STEP': return { ...state, currentStep: action.step, fieldErrors: {}, formError: '', publishAcknowledged: false, publishAcknowledgementError: '' };
    case 'MUTATION_START': return { ...state, status: action.status || 'saving', fieldErrors: {}, formError: '', notice: '' };
    case 'SAVE_SUCCESS': {
      const serverForm = action.recipe ? formFromRecipe(action.recipe) : state.saved;
      const form = action.preserveWorking ? { ...state.form } : serverForm;
      if (action.preserveWorking && action.step) copySection(form, serverForm, action.step, action.cookingSaved, action.savedFields);
      const next = { ...state, recipeId: action.recipe?.id || state.recipeId, publicationStatus: action.recipe?.publicationStatus || state.publicationStatus,
        isActive: action.recipe?.isActive ?? state.isActive, saved: serverForm, form, updatedAt: action.recipe?.updatedAt || state.updatedAt,
        status: 'idle', notice: action.notice || 'Saved.', fieldErrors: {}, formError: '', retainedUpload: action.clearUpload ? null : state.retainedUpload };
      return action.recipe && duplicateInputs(state.saved) !== duplicateInputs(serverForm)
        ? invalidateDuplicateReview(next)
        : next;
    }
    case 'SAVE_FAILURE': return { ...state, status: 'idle', fieldErrors: action.fieldErrors || {}, formError: action.message || 'The recipe could not be saved.' };
    case 'SET_ERRORS': return { ...state, fieldErrors: action.fieldErrors || {}, formError: action.message || '', status: 'idle' };
    case 'PUBLISH_ACKNOWLEDGEMENT_REQUIRED':
      return shouldShowPublishAcknowledgement(state) && !state.publishAcknowledged
        ? { ...state, publishAcknowledgementError: PUBLISH_ACKNOWLEDGEMENT_ERROR }
        : state;
    case 'ACKNOWLEDGE': return { ...state, publishAcknowledged: action.value, publishAcknowledgementError: action.value ? '' : state.publishAcknowledgementError };
    case 'DUPLICATE_CHECK_START':
      return { ...state, duplicateReviewStatus: 'checking', duplicateReview: null,
        duplicateReviewError: '', duplicateAcknowledgedDigest: null };
    case 'DUPLICATE_CHECK_SUCCESS': {
      const requiresAcknowledgement = action.review.truncated || action.review.candidates.length > 0;
      return { ...state, duplicateReviewStatus: requiresAcknowledgement ? 'results' : 'no_qualifying_evidence',
        duplicateReview: action.review, duplicateReviewError: '', duplicateAcknowledgedDigest: null };
    }
    case 'DUPLICATE_CHECK_FAILURE':
      return { ...state, duplicateReviewStatus: 'error', duplicateReview: null, duplicateReviewError: action.message,
        duplicateAcknowledgedDigest: null };
    case 'DUPLICATE_GATE_FAILURE':
      return { ...state, duplicateReviewError: action.message };
    case 'DUPLICATE_REVIEW_STALE':
      return { ...state, duplicateReviewStatus: 'stale', duplicateReview: action.review,
        duplicateReviewError: action.message, duplicateAcknowledgedDigest: null,
        duplicateReviewFocusRequest: state.duplicateReviewFocusRequest + 1, status: 'idle' };
    case 'ACKNOWLEDGE_DUPLICATE_REVIEW':
      return { ...state, duplicateAcknowledgedDigest: action.value ? state.duplicateReview?.resultDigest : null,
        duplicateReviewError: action.value ? '' : state.duplicateReviewError };
    case 'RETAIN_UPLOAD': return { ...state, retainedUpload: action.image, status: 'idle' };
    case 'CONFLICT': return { ...state, status: 'conflict', conflict: true, formError: 'This recipe was changed by another Moderator.' };
    case 'UNCERTAIN': return { ...state, status: 'uncertain', formError: action.message };
    case 'ASK_CLOSE': return { ...state, closeConfirmation: true };
    case 'CANCEL_CLOSE': return { ...state, closeConfirmation: false };
    case 'ASK_RELOAD': return { ...state, reloadConfirmation: true };
    case 'CANCEL_RELOAD': return { ...state, reloadConfirmation: false };
    default: return state;
  }
}

function copySection(target, source, step, cookingSaved = false, savedFields = []) {
  const fields = {
    basics: ['title', 'description', 'imageUrl'], ingredients: ['ingredients'], instructions: ['instructions'],
    details: ['difficulty', 'prepTimeMinutes', 'cookTimeHours', 'cookTimeMinutePart', 'servings', 'region', 'category', 'dietaryTags', 'nutrition', 'nutritionSource'],
  }[step] || [];
  fields.forEach((field) => { target[field] = source[field]; });
  if (cookingSaved) target.cooking = source.cooking;
  for (const field of ['ingredients', 'instructions', 'servings']) {
    if (savedFields.includes(field)) target[field] = source[field];
  }
}

export function hasUnsavedChanges(state) {
  return state.unresolvedIngredients?.length > 0
    || dirtySteps(state.saved || emptyRecipeForm(), state.form).length > 0;
}
export function isMutationBusy(state) { return ['loading', 'saving', 'uploading', 'publishing', 'recovering'].includes(state.status) || state.duplicateReviewStatus === 'checking'; }
export function shouldShowPublishAcknowledgement(state) {
  return state.currentStep === 'review' && state.publicationStatus === 'draft';
}

export function publishAcknowledgementGate(state) {
  const error = shouldShowPublishAcknowledgement(state) && !state.publishAcknowledged
    ? PUBLISH_ACKNOWLEDGEMENT_ERROR
    : '';
  return { allowed: !error, error };
}

export function duplicateReviewGate(state) {
  const review = state.duplicateReview;
  if (!review || state.duplicateReviewStatus === 'idle' || state.duplicateReviewStatus === 'error'
    || state.duplicateReviewStatus === 'checking' || state.duplicateReviewStatus === 'stale') {
    return { allowed: false, error: DUPLICATE_REVIEW_REQUIRED_ERROR };
  }
  const acknowledgementRequired = review.truncated || review.candidates.length > 0;
  if (acknowledgementRequired && state.duplicateAcknowledgedDigest !== review.resultDigest) {
    return { allowed: false, error: 'Review the current result and confirm that you want to continue as a distinct Recipe or variant.' };
  }
  return { allowed: true, error: '' };
}

export async function resolveBasicsImageUpload({ selectedFile, retainedUpload, upload }) {
  if (retainedUpload) return { image: retainedUpload, uploadedNow: false };
  if (!selectedFile) return { image: null, uploadedNow: false };
  return { image: await upload(selectedFile), uploadedNow: true };
}
