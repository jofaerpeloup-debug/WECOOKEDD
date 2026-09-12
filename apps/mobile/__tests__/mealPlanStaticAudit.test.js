const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, '../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const screen = read('screens/MealPlanScreen.js');
const sheet = read('components/MealPlanSheet.js');
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
    expect(screen).toMatch(/can still be removed/);
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
    for (const source of [screen, sheet]) {
      expect(source).not.toMatch(/AsyncStorage|MealPlanContext|useMealPlan|mockData|TimePickerSheet|expo-notifications/);
      expect(source).not.toMatch(/mealType|breakfast|lunch|dinner|generate plan|auto-plan/i);
    }
  });

  it('date helpers never use duration arithmetic or UTC serialization', () => {
    expect(dates).not.toMatch(/86400000|toISOString|setTime|getTime|Date\.UTC/);
    expect(dates).toMatch(/new Date\(year, monthIndex, day, 12/);
  });
});
