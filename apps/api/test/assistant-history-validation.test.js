const test = require('node:test');
const assert = require('node:assert/strict');
const schemas = require('../src/modules/assistant/assistant-history.validation');
const requestId = '6f476b68-91d7-4b16-99dc-5cc0b0dacdbb';
const conversationId = '507f1f77bcf86cd799439011';
const input = (body = {}, params = {}, query = {}) => ({ body, params, query });

test('Create accepts only UUID requestId and normalizes its casing', () => {
  assert.deepEqual(schemas.createConversationSchema.parse(input({ requestId: requestId.toUpperCase() })).body, { requestId });
  for (const body of [undefined, {}, { requestId: 'x' }, { requestId, userId: conversationId },
    { requestId, createdAt: new Date().toISOString() }, { requestId, expiresAt: new Date().toISOString() },
    { requestId, role: 'user' }, { requestId, messages: [] }, { requestId, model: 'x' }]) {
    assert.equal(schemas.createConversationSchema.safeParse({ body, params: {}, query: {} }).success, false);
  }
  assert.equal(schemas.createConversationSchema.safeParse(input({ requestId }, {}, { userId: conversationId })).success, false);
});

for (const [name, schema, params] of [
  ['List', schemas.listConversationsSchema, {}],
  ['Open', schemas.openConversationSchema, { conversationId }],
]) {
  test(`${name} enforces strict pagination and empty body`, () => {
    assert.equal(schema.parse(input(undefined, params)).query.limit, 20);
    for (const limit of ['1', '20', '50']) assert.equal(schema.parse(input({}, params, { limit })).query.limit, Number(limit));
    for (const limit of ['0', '51', '-1', '1.1', 'Infinity', '', ' ', '01', '1e1', ['20'], { x: 20 }]) {
      assert.equal(schema.safeParse(input({}, params, { limit })).success, false, String(limit));
    }
    assert.equal(schema.safeParse(input({}, params, { cursor: 'x'.repeat(1000) })).success, true);
    for (const query of [{ cursor: '' }, { cursor: 'x'.repeat(1001) }, { userId: conversationId }, { extra: 'x' }]) {
      assert.equal(schema.safeParse(input({}, params, query)).success, false);
    }
    assert.equal(schema.safeParse(input({ messages: [] }, params)).success, false);
  });
}

test('Open/Delete reuse ObjectId validation and reject caller authority/extra params', () => {
  for (const schema of [schemas.openConversationSchema, schemas.deleteConversationSchema]) {
    assert.equal(schema.safeParse(input({}, { conversationId })).success, true);
    assert.equal(schema.safeParse(input({}, { conversationId: 'bad' })).success, false);
    assert.equal(schema.safeParse(input({}, { conversationId, userId: conversationId })).success, false);
  }
  assert.equal(schemas.deleteConversationSchema.safeParse(input({}, { conversationId }, { limit: '20' })).success, false);
  assert.equal(schemas.deleteConversationSchema.safeParse(input({ userId: conversationId }, { conversationId })).success, false);
});
