import { dirtySteps, emptyRecipeForm, firstIncompleteStep, formFromRecipe } from './recipeAuthoringModel.js';
import {
  confirmIngredientResolution, createUnresolvedIngredientQueue, mergeIngredientResolutionResults,
} from './recipeIngredientResolution.js';

export const PUBLISH_ACKNOWLEDGEMENT_ERROR = 'Confirm that this recipe belongs to Filipino cuisine before publishing.';

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
        ingredientResolutionError: '', ingredientResolutionRequest: null };
    }
    case 'CHANGE': {
      const form = { ...state.form, [action.field]: action.value };
      const clearedField = /^cookTime(?:Hours|MinutePart)$/.test(action.field) ? 'cookTimeMinutes' : action.field;
      return { ...state, form, notice: '', fieldErrors: { ...state.fieldErrors, [clearedField]: undefined },
        publishAcknowledged: state.currentStep === 'review' ? false : state.publishAcknowledged,
        publishAcknowledgementError: state.currentStep === 'review' ? '' : state.publishAcknowledgementError };
    }
    case 'SET_UNRESOLVED_INGREDIENTS': {
      const generation = state.ingredientResolutionGeneration + 1;
      return { ...state,
        unresolvedIngredients: createUnresolvedIngredientQueue(action.lines || [], generation),
        ingredientResolutionGeneration: generation, ingredientResolutionStatus: 'idle',
        ingredientResolutionError: '', ingredientResolutionRequest: null };
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
      return { ...state, form: result.form, unresolvedIngredients: result.queue, notice: '' };
    }
    case 'DRAFT_CREATED': {
      const serverForm = formFromRecipe(action.recipe);
      return { ...state, recipeId: action.recipe.id, publicationStatus: 'draft', isActive: action.recipe.isActive,
        saved: serverForm, updatedAt: action.recipe.updatedAt, status: action.status || 'saving' };
    }
    case 'SET_STEP': return { ...state, currentStep: action.step, fieldErrors: {}, formError: '', publishAcknowledged: false, publishAcknowledgementError: '' };
    case 'MUTATION_START': return { ...state, status: action.status || 'saving', fieldErrors: {}, formError: '', notice: '' };
    case 'SAVE_SUCCESS': {
      const serverForm = action.recipe ? formFromRecipe(action.recipe) : state.saved;
      const form = action.preserveWorking ? { ...state.form } : serverForm;
      if (action.preserveWorking && action.step) copySection(form, serverForm, action.step);
      return { ...state, recipeId: action.recipe?.id || state.recipeId, publicationStatus: action.recipe?.publicationStatus || state.publicationStatus,
        isActive: action.recipe?.isActive ?? state.isActive, saved: serverForm, form, updatedAt: action.recipe?.updatedAt || state.updatedAt,
        status: 'idle', notice: action.notice || 'Saved.', fieldErrors: {}, formError: '', retainedUpload: action.clearUpload ? null : state.retainedUpload };
    }
    case 'SAVE_FAILURE': return { ...state, status: 'idle', fieldErrors: action.fieldErrors || {}, formError: action.message || 'The recipe could not be saved.' };
    case 'SET_ERRORS': return { ...state, fieldErrors: action.fieldErrors || {}, formError: action.message || '', status: 'idle' };
    case 'PUBLISH_ACKNOWLEDGEMENT_REQUIRED':
      return shouldShowPublishAcknowledgement(state) && !state.publishAcknowledged
        ? { ...state, publishAcknowledgementError: PUBLISH_ACKNOWLEDGEMENT_ERROR }
        : state;
    case 'ACKNOWLEDGE': return { ...state, publishAcknowledged: action.value, publishAcknowledgementError: action.value ? '' : state.publishAcknowledgementError };
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

function copySection(target, source, step) {
  const fields = {
    basics: ['title', 'description', 'imageUrl'], ingredients: ['ingredients'], instructions: ['instructions'],
    details: ['difficulty', 'prepTimeMinutes', 'cookTimeHours', 'cookTimeMinutePart', 'servings', 'region', 'category', 'dietaryTags'],
  }[step] || [];
  fields.forEach((field) => { target[field] = source[field]; });
}

export function hasUnsavedChanges(state) {
  return state.unresolvedIngredients?.length > 0
    || dirtySteps(state.saved || emptyRecipeForm(), state.form).length > 0;
}
export function isMutationBusy(state) { return ['loading', 'saving', 'uploading', 'publishing', 'recovering'].includes(state.status); }
export function shouldShowPublishAcknowledgement(state) {
  return state.currentStep === 'review' && state.publicationStatus === 'draft';
}

export function publishAcknowledgementGate(state) {
  const error = shouldShowPublishAcknowledgement(state) && !state.publishAcknowledged
    ? PUBLISH_ACKNOWLEDGEMENT_ERROR
    : '';
  return { allowed: !error, error };
}

export async function resolveBasicsImageUpload({ selectedFile, retainedUpload, upload }) {
  if (retainedUpload) return { image: retainedUpload, uploadedNow: false };
  if (!selectedFile) return { image: null, uploadedNow: false };
  return { image: await upload(selectedFile), uploadedNow: true };
}
