const test = require('node:test');
const assert = require('node:assert/strict');

const Collection = require('../src/modules/collections/collection.model');

const USER_ID = '507f1f77bcf86cd799439001';

test('userId is required and references User', () => {
  const userIdPath = Collection.schema.path('userId');
  assert.equal(userIdPath.options.ref, 'User');
  assert.equal(userIdPath.options.required, true);
});

test('name is required, trimmed, and bounded', () => {
  const namePath = Collection.schema.path('name');
  assert.equal(namePath.options.required, true);
  assert.equal(namePath.options.trim, true);
  assert.equal(namePath.options.maxlength, Collection.NAME_MAX_LENGTH);
});

test('description is optional, trimmed, and bounded', () => {
  const descriptionPath = Collection.schema.path('description');
  assert.equal(!!descriptionPath.options.required, false);
  assert.equal(descriptionPath.options.trim, true);
  assert.equal(descriptionPath.options.maxlength, Collection.DESCRIPTION_MAX_LENGTH);
});

test('validation fails when userId or name is missing', async () => {
  const missingBoth = new Collection({});
  await assert.rejects(() => missingBoth.validate(), (err) => {
    assert.ok(err.errors.userId);
    assert.ok(err.errors.name);
    return true;
  });

  const missingName = new Collection({ userId: USER_ID });
  await assert.rejects(() => missingName.validate());
});

test('a complete document passes validation', async () => {
  const collection = new Collection({ userId: USER_ID, name: 'My Weeknight Meals' });
  await assert.doesNotReject(() => collection.validate());
});

test('a document with a description passes validation', async () => {
  const collection = new Collection({
    userId: USER_ID,
    name: 'Family Favorites',
    description: 'Recipes everyone asks for again.',
  });
  await assert.doesNotReject(() => collection.validate());
});

test('there is a { userId, createdAt } index backing the list-my-collections query', () => {
  const index = Collection.schema
    .indexes()
    .find(([spec]) => spec.userId === 1 && spec.createdAt === -1 && Object.keys(spec).length === 2);
  assert.ok(index, 'expected an index on { userId: 1, createdAt: -1 }');
});

test('timestamps are enabled', () => {
  assert.equal(Collection.schema.options.timestamps, true);
});

test('the schema has no other persisted fields beyond userId/name/description/timestamps', () => {
  const paths = Object.keys(Collection.schema.paths).filter((p) => p !== '_id' && p !== '__v');
  assert.deepEqual(
    paths.sort(),
    ['createdAt', 'description', 'name', 'updatedAt', 'userId'].sort()
  );
});
