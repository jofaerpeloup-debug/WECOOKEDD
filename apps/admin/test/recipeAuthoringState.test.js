import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasUnsavedChanges, initialAuthoringState, recipeAuthoringReducer, resolveBasicsImageUpload,
} from '../src/recipeAuthoring/recipeAuthoringState.js';

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
