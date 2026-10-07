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

describe('CookMode Finish is real, M5C Cook History backend', () => {
  it('never uses the teammate\'s local mock cooked persistence', () => {
    expect(code).not.toMatch(/AsyncStorage|loadJSON|saveJSON|storageKey/);
    expect(code).not.toMatch(/markCooked|useCookedRecipes|CookedRecipesContext/);
    expect(code).not.toMatch(/setCooked|streak|achievement|\bXP\b/);
  });

  it('records a completion through the real CookHistoryContext, not a fabricated local state', () => {
    expect(raw).toMatch(/import \{ useCookHistory \} from '\.\.\/context\/CookHistoryContext'/);
    expect(code).toMatch(/const \{ recordCompletion \} = useCookHistory\(\)/);
    expect(code).toMatch(/await recordCompletion\(\{ recipeId: recipe\.id, servings: cookServings \}\)/);
  });

  it('only attempts to record a completion for a real backend recipe (recipeSource === \'api\')', () => {
    expect(code).toMatch(/const isApiRecipe = params\.recipeSource === 'api'/);
    expect(code).toMatch(/if \(!isApiRecipe\) \{/);
    expect(code).toMatch(/Cook history isn.t available for this recipe\./);
  });

  it('serializes Finish with a synchronous ref guard so a rapid double-tap can never fire a second POST', () => {
    // A ref, not just state: state updates are async, so two onPress calls in
    // the same tick could both read a stale `isFinishing` closure. The ref is
    // set/read synchronously and is the actual guard; `isFinishing` state
    // only drives the disabled/opacity UI.
    expect(code).toMatch(/const isFinishingRef = useRef\(false\)/);
    expect(code).toMatch(/if \(isFinishingRef\.current\) return;/);
    expect(code).toMatch(/isFinishingRef\.current = true;/);
    expect(code).toMatch(/isFinishingRef\.current = false;/);
    expect(code).toMatch(/const \[isFinishing, setIsFinishing\] = useState\(false\)/);
    expect(code).toMatch(/setIsFinishing\(true\)/);
    expect(code).toMatch(/setIsFinishing\(false\)/);
    expect(code).toMatch(/disabled=\{isLast && isFinishing\}/);
  });

  it('on success, shows real completion feedback then pops normally — never before the request resolves', () => {
    expect(code).toMatch(
      /await recordCompletion\([\s\S]*?notify\('Nicely done! 👏',[\s\S]*?navigation\.goBack\(\)\)/
    );
  });

  it('on failure, shows an honest error and never fakes success, fake local state, or a silent navigation', () => {
    expect(code).toMatch(/catch \(err\) \{[\s\S]*?notify\('Could not save', getCookHistoryErrorMessage\(err\)\)/);
    // The catch block must not itself navigate or mark anything cooked.
    const catchBlock = code.match(/catch \(err\) \{([\s\S]*?)\} finally/);
    expect(catchBlock).toBeTruthy();
    expect(catchBlock[1]).not.toMatch(/navigation\.(goBack|reset|replace)/);
    expect(catchBlock[1]).not.toMatch(/markCooked|setCooked/);
  });

  it('adds only an explicit manual timer and never derives duration from recipe steps', () => {
    expect(raw).toMatch(/validateCookTimerDuration\(timerInput\)/);
    expect(raw).toMatch(/createCookTimerEndAt\(Date\.now\(\), validation\.durationMs\)/);
    expect(code).toMatch(/\['hours', 'Hours', 1\]/);
    expect(code).toMatch(/\['minutes', 'Minutes', 2\]/);
    expect(code).toMatch(/\['seconds', 'Seconds', 2\]/);
    expect(code).toMatch(/accessibilityLabel=\{label\}/);
    expect(code).not.toMatch(/parseInstructionDuration|step\.seconds|recipe\.cookTimeMinutes/);
    expect(code).not.toMatch(/Vibration|scheduleNotification|AsyncStorage/);
  });

  it('keeps the absolute clock, lifecycle cleanup, completion isolation, and active-exit guard explicit', () => {
    expect(code).toMatch(/getCookTimerRemainingMs\(current\.endAtMs, nowMs\)/);
    expect(code).toMatch(/AppState\.addEventListener\('change'/);
    expect(code).toMatch(/navigation\.addListener\('beforeRemove'/);
    expect(code).toMatch(/clearInterval\(intervalRef\.current\)/);
    expect(code).toMatch(/AccessibilityInfo\.announceForAccessibility/);
    const completeTimer = code.match(/const completeTimer = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[commitTimer\]\);/);
    expect(completeTimer).toBeTruthy();
    expect(completeTimer[1]).not.toMatch(/goNext|finishCooking|recordCompletion|navigation/);
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
