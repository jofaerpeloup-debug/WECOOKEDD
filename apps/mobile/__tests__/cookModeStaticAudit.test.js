// M4 CookMode final-frontend reconciliation: source-level invariants are used
// because this workspace intentionally has no React Native renderer.

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const raw = read('screens/CookModeScreen.js');
const code = stripComments(raw);
const recipeDetail = stripComments(read('screens/RecipeDetailScreen.js'));
const rootNavigator = stripComments(read('navigation/RootNavigator.js'));
const mainTabs = stripComments(read('navigation/MainTabs.js'));

describe('CookMode uses only real route recipe data', () => {
  it('uses structured public steps with the real-instructions fallback adapter', () => {
    expect(raw).toMatch(/cookModeSteps\(recipe\)/);
    expect(raw).toMatch(/cookModeIngredientChecklist\(recipe, cookServings, params\.ingredients\)/);
  });

  it('has no mock recipe source or retired classifiers', () => {
    expect(code).not.toMatch(/mockData/);
    expect(code).not.toMatch(/\bcuisine\b/i);
    expect(code).not.toMatch(/\bvibe\b/i);
  });

  it('renders real recipe photography without a remote mock URL', () => {
    expect(code).toMatch(/source=\{recipe\.imageUrl \?\? recipe\.image\}/);
    expect(code).not.toMatch(/https?:\/\//);
  });
});

describe('CookMode preserves the teammate guided structure', () => {
  it('starts with prep, ingredient checklist, check-all, and Start cooking', () => {
    expect(code).toMatch(/useState\('prep'\)/);
    expect(code).toMatch(/Before you start/);
    expect(code).toMatch(/Gather your ingredients/);
    expect(code).toMatch(/styles\.checkRow/);
    expect(code).toMatch(/Check all/);
    expect(code).toMatch(/Start cooking/);
  });

  it('shows one current real step, numbered progress, and teammate navigation copy', () => {
    expect(code).toMatch(/steps\[safeStepIndex\]/);
    expect(code).toMatch(/styles\.dotsRow/);
    expect(code).toMatch(/index === safeStepIndex/);
    expect(code).toMatch(/Step \{step\.order\}/);
    expect(code).toMatch(/\{step\.text\}/);
    expect(code).toMatch(/Next Step/);
    expect(code).toMatch(/Finish Cooking/);
    expect(code).not.toMatch(/steps\.map\(\(step, i\).*step\.description/s);
  });

  it('uses clamped transitions and returns first-step Back to prep', () => {
    expect(code).toMatch(/const safeStepIndex = clampCookStepIndex\(stepIndex, steps\.length\)/);
    expect(code).toMatch(/if \(safeStepIndex === 0\) \{\s*setPhase\('prep'\)/);
    expect(code).toMatch(/clampCookStepIndex\(index - 1, steps\.length\)/);
    expect(code).toMatch(/clampCookStepIndex\(index \+ 1, steps\.length\)/);
    expect(code).toMatch(/if \(isLast\) \{\s*finishCooking\(\)/);
  });

  it('keeps long step text scrollable above fixed previous/next controls', () => {
    const scrollPosition = code.indexOf('contentContainerStyle={styles.stepScroll}');
    const instructionPosition = code.indexOf('{step.text}');
    const controlsPosition = code.indexOf('styles.btnRow');
    expect(scrollPosition).toBeGreaterThan(-1);
    expect(instructionPosition).toBeGreaterThan(scrollPosition);
    expect(controlsPosition).toBeGreaterThan(instructionPosition);
  });
});

describe('CookMode does not fake unsupported state', () => {
  it('never persists notes, cooked status, completion, or history', () => {
    expect(code).not.toMatch(/AsyncStorage|loadJSON|saveJSON|storageKey/);
    expect(code).not.toMatch(/markCooked|useCookedRecipes|CookedRecipesContext/);
    expect(code).not.toMatch(/setCooked|cookedAt|completedAt|streak|achievement|\bXP\b/);
  });

  it('keeps completion visible, reports the backend gap honestly, then pops normally', () => {
    expect(code).toMatch(/'Cook history is not available yet\.'/);
    expect(code).toMatch(/notify\('Nicely done!',[\s\S]*navigation\.goBack\(\)\)/);
  });

  it('does not port mock per-step timers or native timer side effects', () => {
    expect(code).toMatch(/Timer unavailable/);
    expect(code).toMatch(/does not include a timer for this step/);
    expect(code).not.toMatch(/setInterval|setTimeout|Vibration|\.seconds\b|scheduleNotification/);
  });
});

describe('CookMode route and stack ownership remain intact', () => {
  it('keeps the real RecipeDetail payload exactly', () => {
    expect(recipeDetail).toMatch(
      /navigation\.navigate\('CookMode', \{\s*recipeSource: 'api',\s*recipe,\s*ingredients: ingredientLines,\s*servings,\s*\}\);/
    );
  });

  it('is a root stack destination, never a bottom tab', () => {
    expect(rootNavigator).toMatch(/name="CookMode"\s+component=\{CookModeScreen\}/);
    expect(mainTabs).not.toMatch(/name="CookMode"/);
  });

  it('uses normal stack back and never resets or replaces MainTabs', () => {
    expect(code).toMatch(/navigation\.goBack\(\)/);
    expect(code).not.toMatch(/navigation\.(reset|replace)\s*\(/);
    expect(code).not.toMatch(/MainTabs/);
  });
});
