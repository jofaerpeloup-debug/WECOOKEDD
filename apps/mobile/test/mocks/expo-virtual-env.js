// Test stand-in for Expo's ESM virtual env module (`expo/virtual/env.js`, which
// is literally `export const env = process.env`). babel-preset-expo's
// inline-env plugin injects an import of it into any source that reads
// `process.env.EXPO_PUBLIC_*` (e.g. src/api/config.js). Jest doesn't transform
// node_modules by default, so we map it here instead.

module.exports = { env: process.env };