import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasUnsavedChanges, initialAuthoringState, recipeAuthoringReducer, resolveBasicsImageUpload,
} from '../src/recipeAuthoring/recipeAuthoringState.js';
import { publicationReadiness } from '../src/recipeAuthoring/recipeAuthoringModel.js';

test('reducer tracks dirty state, save token replacement, conflict, and close confirmation', () => {
  let state = initialAuthoringState();
  state = recipeAuthoringReducer(state, { type: 'CHANGE', field: 'title', value: 'Draft' });
  assert.equal(hasUnsavedChanges(state), true);
  state = recipeAuthoringReducer(state, { type: 'ASK_CLOSE' });
  assert.equal(state.closeConfirmation, true);
  state = recipeAuthoringReducer(state, { type: 'SAVE_SUCCESS', recipe: { id: 'r1', title: 'Draft', publicationStatus: 'draft', isActive: true, updatedAt: 'new-token' }, step: 'basics', preserveWorking: true });
  assert.equal(state.updatedAt, 'new-token');
  assert.equal(hasUnsavedChanges(state), false);
  state = recipeAuthoringReducer(state, { type: 'CONFLICT' });
  assert.equal(state.status, 'conflict');
});

test('step changes reset acknowledgement and content changes on Review invalidate it', () => {
  let state = initialAuthoringState();
  state = { ...state, currentStep: 'review', publishAcknowledged: true };
  state = recipeAuthoringReducer(state, { type: 'CHANGE', field: 'title', value: 'Changed' });
  assert.equal(state.publishAcknowledged, false);
  state = recipeAuthoringReducer({ ...state, publishAcknowledged: true }, { type: 'SET_STEP', step: 'details' });
  assert.equal(state.publishAcknowledged, false);
});

test('saving one section preserves unrelated local edits', () => {
  let state = initialAuthoringState({ recipe: { id: 'r1', title: 'Old', description: '', publicationStatus: 'draft', isActive: true, updatedAt: 'one' } });
  state = { ...state, form: { ...state.form, title: 'New', difficulty: 'hard' } };
  state = recipeAuthoringReducer(state, { type: 'SAVE_SUCCESS', recipe: { id: 'r1', title: 'New', description: '', publicationStatus: 'draft', isActive: true, updatedAt: 'two' }, step: 'basics', preserveWorking: true });
  assert.equal(state.form.title, 'New');
  assert.equal(state.form.difficulty, 'hard');
  assert.equal(hasUnsavedChanges(state), true);
});

test('no-PATCH SAVE_SUCCESS explicitly preserves the complete working form', () => {
  const recipe = { id: 'r1', title: 'Saved title', description: '', publicationStatus: 'draft', isActive: true, updatedAt: 'one' };
  let state = initialAuthoringState({ recipe });
  const saved = state.saved;
  state = { ...state, currentStep: 'ingredients', status: 'saving', form: {
    ...state.form, title: 'Working title', description: 'Working description', prepTimeMinutes: '20',
    cookTimeHours: '1', cookTimeMinutePart: '10', servings: '6', instructions: ['Working instruction.'],
  } };

  state = recipeAuthoringReducer(state, { type: 'SAVE_SUCCESS', preserveWorking: true, notice: 'Draft is saved.' });

  assert.equal(state.saved, saved);
  assert.equal(state.updatedAt, 'one');
  assert.equal(state.status, 'idle');
  assert.equal(state.form.title, 'Working title');
  assert.equal(state.form.description, 'Working description');
  assert.equal(state.form.prepTimeMinutes, '20');
  assert.equal(state.form.cookTimeHours, '1');
  assert.equal(state.form.cookTimeMinutePart, '10');
  assert.equal(state.form.servings, '6');
  assert.deepEqual(state.form.instructions, ['Working instruction.']);
  assert.equal(hasUnsavedChanges(state), true);
  assert.equal(publicationReadiness(state.form).sections.details.complete, false, 'other incomplete fields still control completion');
});

test('resumed Draft and Published no-PATCH saves retain unrelated working edits', () => {
  for (const publicationStatus of ['draft', 'published']) {
    let state = initialAuthoringState({ recipe: {
      id: `r-${publicationStatus}`, title: 'Saved title', description: 'Saved description',
      publicationStatus, isActive: true, updatedAt: `${publicationStatus}-token`,
    } });
    state = { ...state, currentStep: 'ingredients', form: {
      ...state.form, prepTimeMinutes: '15', cookTimeHours: '0', cookTimeMinutePart: '45',
      servings: '4', instructions: ['Keep this local edit.'],
    } };
    state = recipeAuthoringReducer(state, { type: 'SAVE_SUCCESS', preserveWorking: true });

    assert.equal(state.publicationStatus, publicationStatus);
    assert.equal(state.updatedAt, `${publicationStatus}-token`);
    assert.equal(state.form.prepTimeMinutes, '15');
    assert.equal(state.form.cookTimeMinutePart, '45');
    assert.equal(state.form.servings, '4');
    assert.deepEqual(state.form.instructions, ['Keep this local edit.']);
    assert.equal(hasUnsavedChanges(state), true);
  }
});

test('real PATCH result remains authoritative for its section and refreshes the server token', () => {
  let state = initialAuthoringState({ recipe: {
    id: 'r1', title: 'Old title', description: '', publicationStatus: 'draft', isActive: true, updatedAt: 'old-token',
  } });
  state = { ...state, form: { ...state.form, title: 'Client title', description: 'Local description', servings: '8' } };
  state = recipeAuthoringReducer(state, { type: 'SAVE_SUCCESS', preserveWorking: true, step: 'basics', recipe: {
    id: 'r1', title: 'Server-normalized title', description: 'Server description',
    publicationStatus: 'draft', isActive: true, updatedAt: 'new-token',
  } });

  assert.equal(state.saved.title, 'Server-normalized title');
  assert.equal(state.form.title, 'Server-normalized title');
  assert.equal(state.form.description, 'Server description');
  assert.equal(state.form.servings, '8');
  assert.equal(state.updatedAt, 'new-token');
  assert.equal(hasUnsavedChanges(state), true);
});

test('authoritative conflict reload discards pending image attachment intent and adopts server truth', () => {
  const abandonedUpload = { url: 'https://images.example/abandoned.jpg', assetId: 'abandoned-asset' };
  const latestRecipe = {
    id: 'r1', title: 'Server title', description: '', imageUrl: 'https://images.example/server.jpg',
    imageAssetId: 'server-asset', publicationStatus: 'draft', isActive: true, updatedAt: 'latest-token',
  };
  let state = initialAuthoringState({
    recipe: { ...latestRecipe, title: 'Old title', imageUrl: 'https://images.example/old.jpg', updatedAt: 'old-token' },
  });
  state = recipeAuthoringReducer(state, { type: 'RETAIN_UPLOAD', image: abandonedUpload });
  state = recipeAuthoringReducer(state, { type: 'CONFLICT' });
  assert.equal(state.retainedUpload, abandonedUpload);
  assert.equal(state.conflict, true);

  state = recipeAuthoringReducer(state, { type: 'LOAD_SUCCESS', recipe: latestRecipe, keepStep: true });

  assert.equal(state.retainedUpload, null);
  assert.equal(state.conflict, false);
  assert.equal(state.status, 'idle');
  assert.equal(state.form.imageUrl, latestRecipe.imageUrl);
  assert.equal(state.saved.imageUrl, latestRecipe.imageUrl);
  assert.notEqual(state.form.imageUrl, abandonedUpload.url);
  assert.equal(state.updatedAt, 'latest-token');
});

test('recoverable PATCH failure retains an uploaded image and retry does not upload it twice', async () => {
  const selectedFile = { name: 'adobo.jpg' };
  const retainedUpload = { url: 'https://images.example/adobo.jpg', assetId: 'adobo-asset' };
  let uploadCalls = 0;
  const upload = async () => { uploadCalls += 1; return retainedUpload; };

  const firstAttempt = await resolveBasicsImageUpload({ selectedFile, retainedUpload: null, upload });
  let state = initialAuthoringState();
  state = recipeAuthoringReducer(state, { type: 'RETAIN_UPLOAD', image: firstAttempt.image });
  state = recipeAuthoringReducer(state, { type: 'SAVE_FAILURE', message: 'Network unavailable.' });
  assert.equal(state.retainedUpload, retainedUpload);

  const retry = await resolveBasicsImageUpload({ selectedFile, retainedUpload: state.retainedUpload, upload });
  assert.equal(retry.image, retainedUpload);
  assert.equal(retry.uploadedNow, false);
  assert.equal(uploadCalls, 1);
});
