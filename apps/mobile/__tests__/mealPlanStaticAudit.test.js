const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, '../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const screen = read('screens/MealPlanScreen.js');
const sheet = read('components/MealPlanSheet.js');
const moveSheet = read('components/MealPlanMoveSheet.js');
const service = read('api/mealPlanService.js');
const dates = read('utils/mealPlanDates.js');
const detail = read('screens/RecipeDetailScreen.js');
const shopping = read('utils/mealPlanShopping.js');

describe('MealPlan real backend integration', () => {
  it('fetches the selected Monday-Sunday range on focus and supports previous/next week', () => {
    expect(screen).toMatch(/useFocusEffect/);
    expect(screen).toMatch(/getMealPlan\(startDate, endDate\)/);
    expect(screen).toMatch(/shiftWeek\(date, -1\)/);
    expect(screen).toMatch(/shiftWeek\(date, 1\)/);
    expect(screen).toMatch(/formatWeekRange\(days\)/);
  });

  it('guards state by authenticated owner and selected range', () => {
    expect(screen).toMatch(/data\.ownerId === ownerId && data\.range === range/);
    expect(screen).toMatch(/generationRef/);
    expect(screen).toMatch(/ownerRef\.current !== ownerId/);
    expect(screen).toMatch(/rangeRef\.current !== requestRange/);
  });

  it('uses pessimistic create/remove/clear calls and honest unavailable cards', () => {
    expect(sheet).toMatch(/await createMealPlanEntry/);
    expect(screen).toMatch(/await removeMealPlanEntry/);
    expect(screen).toMatch(/await clearMealPlanRange/);
    expect(screen).toMatch(/Recipe unavailable/);
    expect(screen).toMatch(/can still be moved or removed/);
  });

  it('wires one conditional PATCH move and reconciles only from its returned entry', () => {
    expect(service).toMatch(/api\s*\.patch\(`\/meal-plan\/\$\{encodeURIComponent\(entryId\)\}`/);
    expect(service).toMatch(/body:\s*\{\s*dateKey,\s*expectedUpdatedAt\s*\}/);
    expect(screen).toMatch(/await moveMealPlanEntry\(submittedEntry\.id/);
    expect(screen).toMatch(/current\.updatedAt !== submittedEntry\.updatedAt/);
    expect(screen).toMatch(/old\.entries\.map\(\(entry\) => entry\.id === submittedEntry\.id \? returnedEntry : entry\)/);
    expect(screen).toMatch(/old\.entries\.filter\(\(entry\) => entry\.id !== submittedEntry\.id\)/);
    expect(screen).not.toMatch(/removeMealPlanEntry[\s\S]{0,300}createMealPlanEntry|createMealPlanEntry[\s\S]{0,300}removeMealPlanEntry/);
  });

  it('keeps Move real-date, accessible, pessimistic, and stale-refetch aware', () => {
    expect(moveSheet).toMatch(/accessibilityViewIsModal/);
    expect(moveSheet).toMatch(/accessibilityState=\{\{ disabled: moveDisabled, busy: pending \}\}/);
    expect(moveSheet).toMatch(/selectedDateKey === entry\.dateKey/);
    expect(moveSheet).toMatch(/Moving from/);
    expect(moveSheet).toMatch(/Selected target/);
    expect(moveSheet).toMatch(/shiftWeek\(date, -1\)/);
    expect(moveSheet).toMatch(/shiftWeek\(date, 1\)/);
    expect(screen).toMatch(/Your meal plan changed\. Reloading the latest plan\./);
    expect(screen).toMatch(/const reloadResult = await loadRef\.current\(\{ preserveOperation: operation \}\)/);
    expect(screen).toMatch(/generationRef\.current === operation\.generation/);
    expect(screen).toMatch(/operation\.attempt === moveAttemptRef\.current/);
  });
});

describe('real recipe picker and RecipeDetail flow', () => {
  it('uses paginated real recipe search and persists only recipeId/dateKey', () => {
    expect(sheet).toMatch(/listRecipes/);
    expect(sheet).toMatch(/pagination\.page \+ 1/);
    expect(sheet).toMatch(/createMealPlanEntry\(\{ dateKey, recipeId: selectedRecipeId \}\)/);
    expect(sheet).not.toMatch(/mockData|cuisine|vibe/i);
  });

  it('RecipeDetail opens the day sheet for the current local week', () => {
    expect(detail).toMatch(/import MealPlanSheet/);
    expect(detail).toMatch(/setMealPlanOpen\(true\)/);
    expect(detail).toMatch(/<MealPlanSheet[\s\S]*?recipeId=\{recipe\.id\}/);
    expect(sheet).toMatch(/weekDays\(startOfLocalWeek\(new Date\(\)\)\)/);
  });
});

describe('shopping-list and deferred boundaries', () => {
  it('deduplicates ids and reuses ShoppingListContext addRecipe sequentially', () => {
    expect(shopping).toMatch(/new Set\(entries\.filter/);
    expect(shopping).toMatch(/for \(const recipeId of recipeIds\)/);
    expect(shopping).toMatch(/await addRecipe\(recipeId\)/);
    expect(screen).toMatch(/Successful earlier additions remain/);
    expect(screen).not.toMatch(/ingredients\.map|mergeItem|addFromRecipe/);
  });

  it('has no mock/local source, meal types, reminders, AI, or global context', () => {
    for (const source of [screen, sheet, moveSheet]) {
      expect(source).not.toMatch(/AsyncStorage|MealPlanContext|useMealPlan|mockData|TimePickerSheet|expo-notifications/);
      expect(source).not.toMatch(/mealType|breakfast|lunch|dinner|generate plan|auto-plan/i);
    }
  });

  it('date helpers never use duration arithmetic or UTC serialization', () => {
    expect(dates).not.toMatch(/86400000|toISOString|setTime|getTime|Date\.UTC/);
    expect(dates).toMatch(/new Date\(year, monthIndex, day, 12/);
  });

  it('Meal Plan sources keep server authority and avoid local persistence, slots, and mock recipes', () => {
    for (const source of [screen, moveSheet, service]) {
      expect(source).not.toMatch(/AsyncStorage|mock(?:Recipe|Data)|Date\.UTC|86400000/i);
      expect(source).not.toMatch(/mealType|expo-notifications/i);
    }
    expect(screen).not.toMatch(/toISOString/);
    expect(moveSheet).not.toMatch(/toISOString/);
  });
});

describe('MOBILE-MEAL3 frozen drag contract', () => {
  it('uses only PanResponder and Animated with a deliberate handle-only threshold', () => {
    expect(screen).toMatch(/import \{[^}]*Animated[^}]*PanResponder[^}]*\} from 'react-native'/);
    expect(screen).toMatch(/PanResponder\.create/);
    expect(screen).toMatch(/onMoveShouldSetPanResponderCapture: shouldStartDrag/);
    expect(screen).toMatch(/Math\.hypot\([^)]*dx[^)]*dy[^)]*\) >= DRAG_ACTIVATION_DISTANCE/);
    expect(screen).toMatch(/function MealPlanDragHandle/);
    expect(screen).toMatch(/testID=\{`meal-plan-drag-\$\{entry\.id\}`\}/);
    expect(screen).toMatch(/accessibilityRole="button"/);
    expect(screen).toMatch(/accessibilityState=\{\{ disabled \}\}/);
    expect(screen).toMatch(/dragHandle: \{ width: 46, minHeight: 44/);
    expect(screen).toMatch(/disabled=\{status !== 'ready'/);
    expect(screen).not.toMatch(/GestureHandler|Draggable|Reanimated/);
  });

  it('keeps one shared conditional move path with exact entry id and captured version', () => {
    expect(screen).toMatch(/runConditionalMove\(moveEntry, dateKey, claim, 'sheet'\)/);
    expect(screen).toMatch(/runConditionalMove\(activeDrag\.entry, targetDateKey, activeDrag\.claim, 'drag', activeDrag, activeDrag\.authority\)/);
    expect(screen).toMatch(/moveMealPlanEntry\(submittedEntry\.id, \{\s*dateKey,\s*expectedUpdatedAt: submittedEntry\.updatedAt/);
    expect(screen).toMatch(/operationRef\.current === operation/);
    expect(screen).toMatch(/generationRef\.current === operation\.generation/);
    expect(screen).toMatch(/operation\.expectedUpdatedAt === operation\.submittedEntry\.updatedAt/);
    expect(screen).toMatch(/current\.updatedAt === submittedEntry\.updatedAt/);
    expect(screen).toMatch(/loadRef\.current = load/);
    expect(screen).toMatch(/authority: \{\s*ownerId,\s*range,\s*generation: generationRef\.current/);
  });

  it('keeps drag in-week, pessimistic, and server-response authoritative', () => {
    expect(screen).toMatch(/const target = days\.find/);
    expect(screen).toMatch(/targetDateKey !== activeDrag\.entry\.dateKey/);
    expect(screen).toMatch(/isCompleteMovedEntry\(returnedEntry, submittedEntry, dateKey\)/);
    expect(screen).toMatch(/entry\.id === submittedEntry\.id \? returnedEntry : entry/);
    expect(screen).not.toMatch(/setData[\s\S]{0,300}dateKey:\s*targetDateKey/);
    expect(screen).not.toMatch(/removeMealPlanEntry[\s\S]{0,300}createMealPlanEntry|createMealPlanEntry[\s\S]{0,300}removeMealPlanEntry/);
  });

  it('renders a non-touchable preview, dimmed source, valid target treatment, and accessible fallback', () => {
    expect(screen).toMatch(/pointerEvents="none"/);
    expect(screen).toMatch(/importantForAccessibility="no-hide-descendants"/);
    expect(screen).toMatch(/styles\.dragSource/);
    expect(screen).toMatch(/styles\.dayDropZone/);
    expect(screen).toMatch(/styles\.dayDropTarget/);
    expect(screen).toMatch(/scrollEnabled=\{dragState\?\.phase !== 'dragging'\}/);
    expect(screen).toMatch(/accessibilityHint="Drag to another day in this week\. Use Move to choose another week\."/);
    expect(screen).toMatch(/<Text style=\{styles\.moveText\}>Move<\/Text>/);
    expect(moveSheet).toMatch(/shiftWeek\(date, -1\)/);
    expect(moveSheet).toMatch(/shiftWeek\(date, 1\)/);
  });
});
