// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const globals = require('globals');
const expoConfig = require('eslint-config-expo/flat');
const eslintConfigPrettier = require('eslint-config-prettier/flat');

module.exports = defineConfig([
  expoConfig,
  eslintConfigPrettier,
  {
    ignores: ['dist/*', 'node_modules/*', 'assets/design_handoff_wecooked/*'],
  },
  {
    // Node scripts and config files, not React Native app code.
    files: ['scripts/**/*.js', '*.config.js', 'babel.config.js'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    rules: {
      // `useRef(new Animated.Value(0)).current` and reading `scrollX.interpolate`
      // in render are the documented RN Animated pattern — the value is stable.
      'react-hooks/refs': 'off',
      // Apostrophes/quotes in UI copy are fine; escaping them hurts readability.
      'react/no-unescaped-entities': 'off',
      // Dependency hints are useful but frequently intentional here — warn, don't block.
      'react-hooks/exhaustive-deps': 'warn',
      // react-hooks v6 "React Compiler readiness" checks — good to see, not worth
      // blocking a demo build over. Surface them as warnings.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/use-memo': 'warn',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', ignoreRestSiblings: true }],
    },
  },
]);
