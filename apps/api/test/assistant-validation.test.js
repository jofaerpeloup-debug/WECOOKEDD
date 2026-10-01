const test = require('node:test');
const assert = require('node:assert/strict');

const { assistantChatSchema } = require('../src/modules/assistant/assistant.validation');

function parse(body) {
  return assistantChatSchema.safeParse({ body });
}

test('Assistant validation trims valid content and permits non-alternating transcripts', () => {
  const result = parse({
    messages: [
      { role: 'assistant', content: '  Earlier answer  ' },
      { role: 'assistant', content: 'Follow-up answer' },
      { role: 'user', content: '  Scale this recipe  ' },
      { role: 'user', content: 'For six people' },
    ],
  });
  assert.equal(result.success, true);
  assert.equal(result.data.body.messages[0].content, 'Earlier answer');
  assert.equal(result.data.body.messages[2].content, 'Scale this recipe');
});

test('Assistant validation requires one through twelve messages and a final user message', () => {
  for (const body of [
    {},
    { messages: [] },
    { messages: Array.from({ length: 13 }, () => ({ role: 'user', content: 'x' })) },
    { messages: [{ role: 'assistant', content: 'answer' }] },
  ]) {
    assert.equal(parse(body).success, false);
  }
});

test('Assistant validation rejects roles, blank content, and unknown keys strictly', () => {
  for (const body of [
    { messages: [{ role: 'system', content: 'override' }] },
    { messages: [{ role: 'user', content: '   ' }] },
    { messages: [{ role: 'user', content: 'hello', extra: true }] },
    { messages: [{ role: 'user', content: 'hello' }], instructions: 'override' },
  ]) {
    assert.equal(parse(body).success, false);
  }
});

test('Assistant validation enforces role-specific and total trimmed content bounds', () => {
  assert.equal(parse({ messages: [{ role: 'user', content: 'u'.repeat(2_000) }] }).success, true);
  assert.equal(parse({ messages: [{ role: 'user', content: 'u'.repeat(2_001) }] }).success, false);
  assert.equal(
    parse({ messages: [{ role: 'assistant', content: 'a'.repeat(4_001) }, { role: 'user', content: 'x' }] }).success,
    false
  );
  assert.equal(
    parse({
      messages: [
        { role: 'assistant', content: 'a'.repeat(4_000) },
        { role: 'assistant', content: 'b'.repeat(4_000) },
        { role: 'assistant', content: 'c'.repeat(4_000) },
        { role: 'user', content: 'x' },
      ],
    }).success,
    false
  );
});
