const fs = require('fs');
const path = require('path');

const MOBILE = path.join(__dirname, '..');
const SRC = path.join(MOBILE, 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

describe('production-reachable deferred features remain honest', () => {
  it('activates Assistant only through the WeCooked service without fake or persisted replies', () => {
    const assistant = read('screens/AssistantScreen.js');
    const service = read('api/assistantService.js');
    expect(assistant).toMatch(/KeyboardAvoidingView/);
    expect(assistant).toMatch(/QUICK_PROMPTS/);
    expect(assistant).toMatch(/styles\.prompts/);
    expect(assistant).toMatch(/styles\.composer/);
    expect(assistant).toMatch(/placeholder="Ask anything\.\.\."/);
    expect(assistant).toMatch(/sendAssistantMessage/);
    expect(service).toMatch(/api\.post\('\/assistant\/chat'/);
    expect(`${assistant}\n${service}`).not.toMatch(
      /data\/mockData|AsyncStorage|loadJSON|saveJSON|setTimeout|\bfetch\s*\(|EXPO_PUBLIC_OPENAI_/
    );
  });

  it('preserves the Community shell while using the real M10A service without fabricated activity', () => {
    const community = read('screens/CommunityScreen.js');
    expect(community).toMatch(/styles\.composeCard/);
    expect(community).toMatch(/Tag a recipe \(optional\)/);
    expect(community).toMatch(/placeholder="Share what you're cooking\.\.\."/);
    expect(community).toMatch(/<Text style=\{styles\.postBtnText\}>Post<\/Text>/);
    expect(community).toMatch(/listCommunityPosts/);
    expect(community).toMatch(/createCommunityPost/);
    expect(community).toMatch(/No posts yet/);
    expect(community).not.toMatch(/data\/mockData|CommunityContext|AsyncStorage|communityPosts/);
  });

  it('uses the live catalog in the teammate Substitute Finder shell', () => {
    const studio = read('screens/IngredientStudioScreen.js');
    expect(studio).toMatch(/searchIngredients/);
    expect(studio).toMatch(/getSubstitutesFor/);
    expect(studio).toMatch(/Catalog Swaps/);
    expect(studio).toMatch(/styles\.heroCircleWrap/);
    expect(studio).toMatch(/styles\.swapCard/);
    expect(studio).toMatch(/navigation\.navigate\('SwapDetail'/);
    expect(studio).not.toMatch(/data\/mockData|ingredientSwaps|molecularSwap/);
  });

  it('preserves SwapDetail composition while marking unsupported data and actions honestly', () => {
    const detail = read('screens/SwapDetailScreen.js');
    expect(detail).toMatch(/Molecular/);
    expect(detail).toMatch(/COOKING SCIENCE/);
    expect(detail).toMatch(/Add Substitute to Shopping/);
    expect(detail).toMatch(/Not provided/);
    expect(detail).not.toMatch(/Apply Substitute to Formula|No recipe was changed/);
    expect(detail).toMatch(/lockedIngredient=\{hasCatalogResult \? \{ id: substituteId, name: substituteName \} : null\}/);
    expect(detail).toMatch(/onAdd=\{addItem\}/);
    expect(detail).not.toMatch(/data\/mockData|molecularSwap|systemMatch|confidenceText/);
  });

  it('keeps ING2 free of local authority, inferred quantities, and AI domain writes', () => {
    const studio = read('screens/IngredientStudioScreen.js');
    const detail = read('screens/SwapDetailScreen.js');
    const picker = read('components/IngredientPickerModal.js');
    const assistant = read('screens/AssistantScreen.js');
    const service = read('api/substitutionService.js');
    const bounded = `${studio}\n${detail}\n${picker}\n${assistant}\n${service}`;

    expect(bounded).not.toMatch(/AsyncStorage|EXPO_PUBLIC_OPENAI_|api\.openai\.com|\bfetch\s*\(/);
    expect(picker).not.toMatch(/\bratio\b|shoppingListService|setItems/i);
    expect(picker).toMatch(/const \[qty, setQty\] = useState\(''\)/);
    expect(picker).toMatch(/const \[unit, setUnit\] = useState\(null\)/);
    expect(detail).not.toMatch(/applySubstitute|recipeService|updateRecipe|createIngredient|createSubstitution/);
    expect(assistant).not.toMatch(/createIngredient|createSubstitution|addItem|ShoppingList|AsyncStorage/);
  });

  it('does not mount legacy mock persistence providers in production', () => {
    const app = fs.readFileSync(path.join(MOBILE, 'App.js'), 'utf8');
    expect(app).not.toMatch(/SavedRecipesProvider|CommunityProvider/);
  });

  it('keeps NOTIF2, MEAL4, and NOTIF3 deferred without fake inbox authority', () => {
    const files = [
      read('api/notificationService.js'),
      read('context/NotificationsContext.js'),
      read('components/NotificationsDropdown.js'),
      read('screens/NotificationsScreen.js'),
    ].join('\n');
    expect(files).not.toMatch(/AsyncStorage|mockData|expo-notifications|pushToken|deviceToken|requestPermissions|scheduleNotification|setInterval/i);
    expect(files).not.toMatch(/createNotification|seedNotification|fakeNotification/i);
  });

  it('Help Center makes no unsupported AI, offline, subscription, or support-address claim', () => {
    const help = read('screens/HelpCenterScreen.js');
    expect(help).not.toMatch(/data\/mockData|Chef AI|subscription|support@wecooked\.app/);
    expect(help).toMatch(/Support unavailable/);
  });
});
