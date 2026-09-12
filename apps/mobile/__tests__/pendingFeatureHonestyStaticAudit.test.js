const fs = require('fs');
const path = require('path');

const MOBILE = path.join(__dirname, '..');
const SRC = path.join(MOBILE, 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

describe('production-reachable deferred features remain honest', () => {
  it('preserves the Assistant shell but never fakes or persists a conversation', () => {
    const assistant = read('screens/AssistantScreen.js');
    expect(assistant).toMatch(/KeyboardAvoidingView/);
    expect(assistant).toMatch(/QUICK_PROMPTS/);
    expect(assistant).toMatch(/styles\.prompts/);
    expect(assistant).toMatch(/styles\.composer/);
    expect(assistant).toMatch(/placeholder="Ask anything\.\.\."/);
    expect(assistant).toMatch(/Your message was not sent or saved/);
    expect(assistant).not.toMatch(/data\/mockData|AsyncStorage|loadJSON|saveJSON|setTimeout/);
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
    expect(detail).toMatch(/Apply Substitute to Formula/);
    expect(detail).toMatch(/Not provided/);
    expect(detail).toMatch(/No recipe was changed/);
    expect(detail).not.toMatch(/data\/mockData|molecularSwap|systemMatch|confidenceText/);
  });

  it('does not mount legacy mock persistence providers in production', () => {
    const app = fs.readFileSync(path.join(MOBILE, 'App.js'), 'utf8');
    expect(app).not.toMatch(/SavedRecipesProvider|CommunityProvider/);
  });

  it('Help Center makes no unsupported AI, offline, subscription, or support-address claim', () => {
    const help = read('screens/HelpCenterScreen.js');
    expect(help).not.toMatch(/data\/mockData|Chef AI|subscription|support@wecooked\.app/);
    expect(help).toMatch(/Support unavailable/);
  });
});
