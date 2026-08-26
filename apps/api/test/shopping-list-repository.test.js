const test = require('node:test');
const assert = require('node:assert/strict');

const ShoppingList = require('../src/modules/shopping-lists/shopping-list.model');
const shoppingListRepository = require('../src/modules/shopping-lists/shopping-list.repository');

const USER_ID = '507f1f77bcf86cd799439001';

test('findOrCreateByUserId issues an atomic upsert keyed on userId with an empty-items default', async (t) => {
  let capturedFilter;
  let capturedUpdate;
  let capturedOptions;
  t.mock.method(ShoppingList, 'findOneAndUpdate', (filter, update, options) => {
    capturedFilter = filter;
    capturedUpdate = update;
    capturedOptions = options;
    return Promise.resolve({ _id: 'list1', userId: USER_ID, items: [] });
  });

  const result = await shoppingListRepository.findOrCreateByUserId(USER_ID);

  assert.deepEqual(capturedFilter, { userId: USER_ID });
  assert.deepEqual(capturedUpdate, { $setOnInsert: { userId: USER_ID, items: [] } });
  assert.equal(capturedOptions.upsert, true);
  assert.equal(capturedOptions.new, true);
  assert.equal(result._id, 'list1');
});

test('findOrCreateByUserId falls back to reading the existing document when the upsert loses a duplicate-key race', async (t) => {
  t.mock.method(ShoppingList, 'findOneAndUpdate', () => {
    const err = new Error(
      'E11000 duplicate key error collection: wecooked.shoppinglists index: userId_1 dup key: { userId: ObjectId(...) }'
    );
    err.code = 11000;
    return Promise.reject(err);
  });
  let capturedFindOneFilter;
  t.mock.method(ShoppingList, 'findOne', (filter) => {
    capturedFindOneFilter = filter;
    return Promise.resolve({ _id: 'winner-list', userId: USER_ID, items: [] });
  });

  const result = await shoppingListRepository.findOrCreateByUserId(USER_ID);

  assert.deepEqual(capturedFindOneFilter, { userId: USER_ID });
  assert.equal(result._id, 'winner-list');
});

test('findOrCreateByUserId rethrows a duplicate-key race fallback failure if no document is found either (should not happen in practice)', async (t) => {
  t.mock.method(ShoppingList, 'findOneAndUpdate', () => {
    const err = new Error('duplicate key');
    err.code = 11000;
    return Promise.reject(err);
  });
  t.mock.method(ShoppingList, 'findOne', () => Promise.resolve(null));

  await assert.rejects(() => shoppingListRepository.findOrCreateByUserId(USER_ID), (err) => {
    assert.equal(err.code, 11000);
    return true;
  });
});

test('findOrCreateByUserId propagates an unrelated (non-duplicate-key) failure as-is', async (t) => {
  t.mock.method(ShoppingList, 'findOneAndUpdate', () => Promise.reject(new Error('mongo timeout')));

  await assert.rejects(
    () => shoppingListRepository.findOrCreateByUserId(USER_ID),
    (err) => {
      assert.equal(err.message, 'mongo timeout');
      return true;
    }
  );
});

test('save persists the document via its own .save()', async (t) => {
  let saveCalled = false;
  const fakeDoc = {
    save() {
      saveCalled = true;
      return Promise.resolve(this);
    },
  };

  const result = await shoppingListRepository.save(fakeDoc);

  assert.equal(saveCalled, true);
  assert.equal(result, fakeDoc);
});