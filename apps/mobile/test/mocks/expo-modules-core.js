// Narrow test mock for `expo-modules-core`. B4.2A only uses
// `requireOptionalNativeModule` (src/native/googleSignIn.js). The default here
// mimics "native module absent" (Expo Go / no dev build); adapter tests that
// need a present module override this file with `jest.mock('expo-modules-core', …)`.

module.exports = {
  requireOptionalNativeModule: jest.fn(() => null),
  requireNativeModule: jest.fn(() => {
    throw new Error('requireNativeModule is not available in unit tests');
  }),
};