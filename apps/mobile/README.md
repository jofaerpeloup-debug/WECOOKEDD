# WeCooked

A recipe & ingredient-swap app, built in React Native (Expo SDK 54) from the "Sage & Stone" mockup set.

## Requirements

- **Expo Go SDK 54** on your phone. Expo Go on the App Store / Play Store always runs the *latest* published SDK, so if your installed Expo Go is newer than 54, update this project's `expo` package to match instead of downgrading Expo Go (see [Upgrading](#upgrading-to-a-newer-sdk) below).
- Node 18+.

## Screens

| # | Screen | Notes |
|---|--------|-------|
| 1 | Landing | Hero image, "Artistry in every swap" |
| 2 | Login | Sage glass panel over background photo |
| 3 | Dashboard (Home) | Greeting, search, featured recipe, quick tools |
| 4 | Recipe Discovery | Filter pills + recipe feed |
| 5 | Ingredient Studio | Artistic swap suggestions for an ingredient |
| 6 | Shopping List | Categorized, checkable items + add-item bar |
| 7 | AI Assistant | Chat with embedded suggestion cards |
| 8 | Saved Recipes | Featured card + 2-column grid |
| 9 | Swap Detail ("Molecular Precision") | Scientific data tables, confidence badges |
| 10 | Profile Settings | Avatar, editable fields, dietary chips |
| 11 | Settings | Grouped account/preferences/support list |
| 12 | Admin Insights | Metric cards + SVG growth chart |

(Recipe Detail is a 13th screen, added because Dashboard/Discover/Saved all link into it — it wasn't in the original mockups but is styled to match.)

## Design tokens

Colors, type, spacing, and radii are centralized in `src/theme/theme.js`, sampled directly from the mockups:

- Background: `#FAF9F6` (cream)
- Primary/brand: `#4A5D4E` (deep sage) — buttons, active nav, app icon
- Panels: `#C0D5C2` (light sage) — login card
- Display type: Playfair Display (serif) — headlines, recipe titles
- Body type: Inter — UI chrome, labels, buttons

App icon, splash screen, and Android adaptive icon are generated assets (`assets/`) using a leaf mark consistent with the in-app brand logo (sage rounded badge + cream leaf, seen in the top bar).

## Setup

```bash
npm install
npx expo start
```

Then press `i` for iOS simulator, `a` for Android emulator, or scan the QR code with Expo Go on a physical device.

## Upgrading to a newer SDK

If your Expo Go app has moved past SDK 54:

```bash
npx expo install expo@latest
npx expo install --fix
npx expo start -c
```

`--fix` re-aligns every `expo-*`/`react-native-*` package to the versions the new SDK expects. If you do this, also re-check `babel-preset-expo` in `devDependencies` — bump it to match the new SDK line (see note below).

## Project structure

```
App.js                        Root component, font loading
index.js                      Entry point (registerRootComponent)
app.json                      Expo config: icon, splash, newArchEnabled, edgeToEdgeEnabled
assets/                       icon.png, adaptive-icon.png, splash-icon.png, favicon.png
src/
  theme/theme.js               Design tokens (colors, type, spacing, radius)
  components/                  Shared UI: Button, Input, Badge, TopBar, TabBar
  navigation/
    RootNavigator.js           Stack: Landing → Login → MainTabs + detail screens
    MainTabs.js                Bottom tabs: Home, Discover, Assistant, Saved, List
  screens/                     One file per screen
  data/mockData.js             Mock content (recipes, swaps, chat, settings)
```

## Notes on dependencies

- Every package version was pulled from the npm registry and cross-checked against Expo's own SDK-54 compatibility table (`expo`'s `bundledNativeModules.json`) — nothing here is guessed. React Navigation is on v7 (a major bump from v6); the custom `tabBar` prop shape, `navigation.replace()`, and nested-navigator auto-routing were all individually verified against the installed package's type definitions.
- **`babel-preset-expo` is listed explicitly in `devDependencies`.** It's normally a transitive dependency of `expo` and doesn't need to be listed directly — but in this dependency tree npm doesn't hoist it to the top level, and Babel's own config loader only resolves preset names via an upward directory walk from `babel.config.js`, not into nested `node_modules`. Without the explicit entry, `expo start`/`expo export` fails with `Cannot find module 'babel-preset-expo'`. This is reproducible on a completely untouched `create-expo-app` SDK 54 template too — it's not specific to this project. If you bump the SDK, bump this version to match.
- New Architecture (Fabric/TurboModules) is enabled by default at SDK 54 (`newArchEnabled: true`); all native-touching libraries here (`react-native-svg`, `react-native-screens`, `react-native-safe-area-context`, `expo-linear-gradient`, `@expo/vector-icons`) are the exact versions Expo bundles for SDK 54, so they're New Architecture–compatible out of the box.
- Android edge-to-edge display is enabled (`edgeToEdgeEnabled: true`); all screens already use `useSafeAreaInsets()` for top/bottom spacing, so no layout changes were needed.
- All data is mocked in `src/data/mockData.js` — swap in real API calls there when ready.
- Photos are placeholder Unsplash images; replace with your own asset pipeline for production.
- Expo Go cannot preview the custom splash screen (Expo Go always shows your app icon instead, since SDK 52) — this is expected; test the real splash via a preview/production build.

## Verified

- Full dependency graph bundles cleanly via Metro for iOS and Android (dev + minified production builds), from a clean `npm ci` against the exact shipped lockfile.
- `expo-doctor` (Expo's own project health-check): 16/18 checks pass; the remaining 2 require reaching external validation servers not relevant to local project correctness.
- ESLint (React, Hooks, React Native rules): no real issues.
- 60+ logic/data-shape assertions covering chart math, list-toggle state, and every screen's mock-data expectations.
