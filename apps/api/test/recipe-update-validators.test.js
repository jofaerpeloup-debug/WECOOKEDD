// recipe.repository.js#updateById persists PATCH replacements via
// Recipe.findByIdAndUpdate(..., { runValidators: true }) — a query-based
// update, not document.save(). Mongoose does NOT run document middleware
// (pre('validate')/pre('save') hooks) for query-based updates in general,
// so it would be wrong to assume the toTaste/quantity cross-field hook on
// recipeIngredientSchema (recipe.model.js) applies here just because it
// applies to `new Recipe(...).validate()`.
//
// This suite verifies, empirically, that it *does* still apply on this
// exact path: this Mongoose version's update-validator implementation for
// DocumentArray elements (see node_modules/mongoose/lib/schema/
// subdocument.js#doValidate) constructs a real subdocument instance for
// each array element being set and calls its full `.validate()`, which
// does run pre('validate') hooks.
//
// No live MongoDB connection is needed for this: Mongoose runs
// `runValidators` entirely client-side, before the query ever reaches the
// network (see Query.prototype._findOneAndUpdate in mongoose/lib/query.js,
// where `await this.validate(...)` precedes `this.mongooseCollection.
// findOneAndUpdate(...)`). A rejected update therefore throws a
// ValidationError in a few milliseconds, with no connection required. An
// *accepted* update goes on to attempt the real (unavailable) DB call, so
// bufferTimeoutMS is lowered here to fail that fast too — the assertion for
// those cases is simply that the resulting error is NOT a ValidationError,
// i.e. schema validation itself passed.
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

mongoose.set('bufferTimeoutMS', 200);

const Recipe = require('../src/modules/recipes/recipe.model');

const CHICKEN_ID = '507f1f77bcf86cd799439011';
const RECIPE_ID = '507f1f77bcf86cd799439099';

async function attemptIngredientsUpdate(ingredients) {
  try {
    await Recipe.findByIdAndUpdate(
      RECIPE_ID,
      { $set: { ingredients } },
      { new: true, runValidators: true }
    );
    return null;
  } catch (err) {
    return err;
  }
}

test('findByIdAndUpdate rejects a replacement ingredient with unit "toTaste" and a quantity', async () => {
  const err = await attemptIngredientsUpdate([{ ingredientId: CHICKEN_ID, quantity: 1, unit: 'toTaste' }]);
  assert.ok(err, 'expected the update to be rejected');
  assert.equal(err.name, 'ValidationError');
  assert.match(err.message, /quantity must be omitted when unit is "toTaste"/);
});

test('findByIdAndUpdate rejects a replacement ingredient with a measurable unit and quantity omitted', async () => {
  const err = await attemptIngredientsUpdate([{ ingredientId: CHICKEN_ID, unit: 'tbsp' }]);
  assert.ok(err, 'expected the update to be rejected');
  assert.equal(err.name, 'ValidationError');
  assert.match(err.message, /quantity is required/);
});

test('findByIdAndUpdate accepts a replacement ingredient with unit "toTaste" and quantity omitted', async () => {
  const err = await attemptIngredientsUpdate([{ ingredientId: CHICKEN_ID, unit: 'toTaste' }]);
  // No live MongoDB in this test environment: schema validation passing
  // means the query goes on to attempt the actual DB call and fails with a
  // connection/buffering error instead — the point of this assertion is
  // that it is specifically NOT a ValidationError.
  assert.ok(err, 'expected a connection-buffering error since no MongoDB is available in this test environment');
  assert.notEqual(err.name, 'ValidationError');
});

test('findByIdAndUpdate accepts a replacement ingredient with a measurable unit and a quantity', async () => {
  const err = await attemptIngredientsUpdate([{ ingredientId: CHICKEN_ID, quantity: 2, unit: 'tbsp' }]);
  assert.ok(err, 'expected a connection-buffering error since no MongoDB is available in this test environment');
  assert.notEqual(err.name, 'ValidationError');
});