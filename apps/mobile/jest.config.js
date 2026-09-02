// Minimal Jest config for the WeCooked mobile workspace (Expo SDK 54).
//
// B4.2A test scope is orchestration / config-plugin / native-adapter / error
// mapping only — no component rendering, no native compilation, no RN runtime.
//
// It deliberately does NOT use `preset: 'jest-expo'`: that preset assumes a
// hoisted node_modules, which conflicts with this repo's
// `.npmrc install-strategy=nested` (it directly requires undeclared transitive
// packages such as @react-native/assets-registry). Instead we run plain Jest
// with Jest's built-in babel-jest transform (picks up apps/mobile/babel.config.js
// -> babel-preset-expo) and narrow explicit mocks for the only platform modules
// these units touch.

module.exports = {
  testEnvironment: 'node',
  clearMocks: true,
  testMatch: ['<rootDir>/__tests__/**/*.test.js'],
  moduleNameMapper: {
    '^react-native$': '<rootDir>/test/mocks/react-native.js',
    '^expo-secure-store$': '<rootDir>/test/mocks/expo-secure-store.js',
    '^expo-modules-core$': '<rootDir>/test/mocks/expo-modules-core.js',
    // babel-preset-expo's inline-env plugin rewrites `process.env.EXPO_PUBLIC_*`
    // to a named import from this ESM virtual module; Jest's default
    // transformIgnorePatterns won't parse it. The real module is just
    // `export const env = process.env`.
    '^expo/virtual/env$': '<rootDir>/test/mocks/expo-virtual-env.js',
  },
};