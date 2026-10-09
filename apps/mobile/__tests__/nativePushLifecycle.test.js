const lifecycle = require('../src/notifications/nativePushLifecycle');

it('classifies granted, requestable, and denied without repeatedly prompting denied permission', () => {
  expect(lifecycle.permissionState({ status: 'granted', granted: true })).toBe('granted');
  expect(lifecycle.permissionState({ status: 'undetermined', canAskAgain: true })).toBe('requestable');
  expect(lifecycle.permissionState({ status: 'denied', canAskAgain: false })).toBe('denied');
});

it('runs the registered pre-logout hook and can remove it', async () => {
  const handler = jest.fn();
  lifecycle.setBeforePushLogout(handler);
  await lifecycle.runBeforePushLogout({ localOnly: false });
  expect(handler).toHaveBeenCalledWith({ localOnly: false });
  lifecycle.setBeforePushLogout(null);
  await lifecycle.runBeforePushLogout();
  expect(handler).toHaveBeenCalledTimes(1);
});

it('uses stable response identity only for real notification responses', () => {
  expect(lifecycle.responseKey({ notification: { request: { identifier: 'request-1' } }, actionIdentifier: 'default' }))
    .toBe('request-1:default');
  expect(lifecycle.responseKey({})).toBeNull();
});
