import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mutationBody, publishBody } from '../src/recipeAuthoring/recipeAuthoringModel.js';
import {
  initialAuthoringState, PUBLISH_ACKNOWLEDGEMENT_ERROR, publishAcknowledgementGate,
  recipeAuthoringReducer, shouldShowPublishAcknowledgement,
} from '../src/recipeAuthoring/recipeAuthoringState.js';

test('Filipino acknowledgement is gated to the Review step of a Draft', () => {
  assert.equal(shouldShowPublishAcknowledgement({ currentStep: 'review', publicationStatus: 'draft' }), true);
  assert.equal(shouldShowPublishAcknowledgement({ currentStep: 'basics', publicationStatus: 'draft' }), false);
  assert.equal(shouldShowPublishAcknowledgement({ currentStep: 'review', publicationStatus: 'published' }), false);
});

test('acknowledgement is user-controlled and only the explicit Publish payload sends it', () => {
  let state = { ...initialAuthoringState(), currentStep: 'review', publicationStatus: 'draft' };
  assert.equal(state.publishAcknowledged, false);
  state = recipeAuthoringReducer(state, { type: 'ACKNOWLEDGE', value: true });
  assert.equal(state.publishAcknowledged, true);
  state = recipeAuthoringReducer(state, { type: 'ACKNOWLEDGE', value: false });
  assert.equal(state.publishAcknowledged, false);

  assert.deepEqual(publishBody('token'), { confirmFilipinoCuisine: true, expectedUpdatedAt: 'token' });
  assert.deepEqual(mutationBody({ title: 'Adobo' }, 'token'), { title: 'Adobo', expectedUpdatedAt: 'token' });
  assert.equal('confirmFilipinoCuisine' in mutationBody({ title: 'Adobo' }, 'token'), false);
});

test('unchecked Publish attempt records client validation and does not proceed to the API', () => {
  const originalForm = initialAuthoringState().form;
  let state = {
    ...initialAuthoringState(), recipeId: 'recipe-1', currentStep: 'review', publicationStatus: 'draft', form: originalForm,
  };
  let publishApiCalls = 0;

  const gate = publishAcknowledgementGate(state);
  if (gate.allowed) publishApiCalls += 1;
  if (!gate.allowed) state = recipeAuthoringReducer(state, { type: 'PUBLISH_ACKNOWLEDGEMENT_REQUIRED' });

  assert.equal(gate.allowed, false);
  assert.equal(gate.error, PUBLISH_ACKNOWLEDGEMENT_ERROR);
  assert.equal(publishApiCalls, 0);
  assert.equal(state.publishAcknowledgementError, PUBLISH_ACKNOWLEDGEMENT_ERROR);
  assert.equal(state.currentStep, 'review');
  assert.equal(state.form, originalForm);
});

test('checking acknowledgement clears its error and permits Publish; a later unchecked attempt validates again', () => {
  let state = {
    ...initialAuthoringState(), recipeId: 'recipe-1', currentStep: 'review', publicationStatus: 'draft',
  };
  state = recipeAuthoringReducer(state, { type: 'PUBLISH_ACKNOWLEDGEMENT_REQUIRED' });
  assert.equal(state.publishAcknowledgementError, PUBLISH_ACKNOWLEDGEMENT_ERROR);

  state = recipeAuthoringReducer(state, { type: 'ACKNOWLEDGE', value: true });
  assert.equal(state.publishAcknowledgementError, '');
  let publishApiCalls = 0;
  if (publishAcknowledgementGate(state).allowed) publishApiCalls += 1;
  assert.equal(publishApiCalls, 1);

  state = recipeAuthoringReducer(state, { type: 'ACKNOWLEDGE', value: false });
  assert.equal(state.publishAcknowledgementError, '');
  assert.equal(publishAcknowledgementGate(state).allowed, false);
  state = recipeAuthoringReducer(state, { type: 'PUBLISH_ACKNOWLEDGEMENT_REQUIRED' });
  assert.equal(state.publishAcknowledgementError, PUBLISH_ACKNOWLEDGEMENT_ERROR);
});

test('Published edit mode exposes neither acknowledgement control nor acknowledgement validation', () => {
  let state = {
    ...initialAuthoringState({ recipe: { id: 'recipe-1', title: 'Adobo', publicationStatus: 'published' } }),
    currentStep: 'review',
  };

  assert.equal(shouldShowPublishAcknowledgement(state), false);
  assert.deepEqual(publishAcknowledgementGate(state), { allowed: true, error: '' });
  state = recipeAuthoringReducer(state, { type: 'PUBLISH_ACKNOWLEDGEMENT_REQUIRED' });
  assert.equal(state.publishAcknowledgementError, '');
});

test('active RecipeAuthoringWizard renders and focuses accessible acknowledgement validation', () => {
  const source = readFileSync(new URL('../src/recipeAuthoring/RecipeAuthoringWizard.jsx', import.meta.url), 'utf8');
  assert.match(source, /shouldShowPublishAcknowledgement\(state\)/);
  assert.match(source, /checked=\{state\.publishAcknowledged\}/);
  assert.match(source, /type: 'ACKNOWLEDGE', value: e\.target\.checked/);
  assert.match(source, /I confirm that this recipe belongs to Filipino cuisine\./);
  assert.match(source, /onClick=\{publish\}/);
  assert.match(source, /aria-invalid=\{state\.publishAcknowledgementError/);
  assert.match(source, /aria-errormessage=\{state\.publishAcknowledgementError/);
  assert.match(source, /role="alert">\{state\.publishAcknowledgementError\}/);
  assert.match(source, /acknowledgementRef\.current\?\.focus\(\)/);
  assert.doesNotMatch(source, /disabled=\{[^}]*!state\.publishAcknowledged/);
});
