jest.mock('../src/api/client', () => ({ api: { post: jest.fn() } }));

const { api } = require('../src/api/client');
const {
  AssistantServiceError,
  MALFORMED_ASSISTANT_RESPONSE,
  sendAssistantMessage,
} = require('../src/api/assistantService');

beforeEach(() => jest.clearAllMocks());

it('posts only the supplied transcript and returns the trimmed reply', async () => {
  const messages = [{ role: 'user', content: 'What can I make with lentils?' }];
  api.post.mockResolvedValue({ reply: '  Make a lentil soup.  ', ignored: 'value' });

  await expect(sendAssistantMessage(messages)).resolves.toBe('Make a lentil soup.');
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(api.post).toHaveBeenCalledWith('/assistant/chat', { body: { messages } });
});

it.each([undefined, null, {}, { reply: 42 }, { reply: '   ' }])(
  'rejects malformed successful data without creating a reply: %p',
  async (data) => {
    api.post.mockResolvedValue(data);

    await expect(sendAssistantMessage([])).rejects.toMatchObject({
      name: 'AssistantServiceError',
      code: MALFORMED_ASSISTANT_RESPONSE,
    });
  }
);

it('uses a dedicated safe error type for malformed successful data', () => {
  expect(new AssistantServiceError()).toBeInstanceOf(Error);
});

it('propagates API failures for safe mapping at the Assistant boundary', async () => {
  const failure = new Error('transport detail');
  api.post.mockRejectedValue(failure);
  await expect(sendAssistantMessage([])).rejects.toBe(failure);
});
