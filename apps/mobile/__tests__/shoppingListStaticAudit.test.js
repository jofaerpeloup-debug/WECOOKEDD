// Shopping List final-frontend port — static source validation.
//
// ShoppingListScreen.js is the teammate screen's final visible product
// (commit c1c86ed): back-circle + title + Edit/Done header (NO clear-all
// control — the teammate has none), an Edit/Done toggle that swaps the row
// checkbox for a remove marker, sectioned rows, and an inline free-text
// name+qty "Add Item" footer form. It stays backed exclusively by the real
// Shopping List REST API via ShoppingListContext for every interaction the
// backend actually supports (check/uncheck, remove, reload) — it never
// falls back to old WeCooked chrome (IngredientPickerModal, a clear button,
// a flat un-sectioned list) merely because a teammate-visible capability
// (free-text custom items, real categories) has no backend support yet;
// those gaps are reported in place with an honest message, never faked.
// The mobile workspace has no RN renderer (see jest.config.js), so these
// invariants are encoded as source assertions.
//
// "Forbidden" checks run against a comment-stripped copy so a phrase that
// only appears in an explanatory comment does not trip them; "must contain"
// checks run against the raw source.

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const raw = read('screens/ShoppingListScreen.js');
const code = stripComments(raw);

describe('Shopping List stays on the real backend-only data path', () => {
  it('imports only the real ShoppingListContext, never teammate mock data/context', () => {
    expect(raw).toMatch(/import \{ useShoppingList \} from '\.\.\/context\/ShoppingListContext'/);
    expect(code).toMatch(/useShoppingList\(\)/);
  });

  it('never imports mockData or a teammate-style local ShoppingListProvider', () => {
    expect(code).not.toMatch(/data\/mockData/);
    expect(code).not.toMatch(/\bmockData\b/);
    expect(code).not.toMatch(/ShoppingListProvider/);
    expect(code).not.toMatch(/addFromRecipe/);
  });

  it('never introduces AsyncStorage or any local-only persistence', () => {
    expect(code).not.toMatch(/AsyncStorage/);
    expect(code).not.toMatch(/loadJSON|saveJSON/);
    expect(code).not.toMatch(/wecooked:groceryList|wecooked:shoppingList/);
  });

  it('does not render cuisine, vibe, or region metadata', () => {
    expect(code).not.toMatch(/cuisine/i);
    expect(code).not.toMatch(/\bvibe\b/i);
    expect(code).not.toMatch(/\bregion\b/i);
  });

  it('carries no client/provider secrets or token material', () => {
    expect(code).not.toMatch(/clientId|CLIENT_ID|apiKey|API_KEY|secret|Bearer /i);
  });
});

describe('Shopping List header matches the teammate final screen exactly', () => {
  it('renders back-circle, title, and an Edit/Done toggle', () => {
    expect(code).toMatch(/styles\.backBtn/);
    expect(code).toMatch(/onPress=\{\(\)\s*=>\s*navigation\.goBack\(\)\}/);
    expect(code).toMatch(/setEditing\(\(v\)\s*=>\s*!v\)/);
    expect(code).toMatch(/\{editing \? 'Done' : 'Edit'\}/);
  });

  it('renders no clear-all control — the teammate header has none', () => {
    expect(code).not.toMatch(/>\s*Clear\s*</);
    expect(code).not.toMatch(/confirmClear/);
    expect(code).not.toMatch(/Clear shopping list\?/);
    expect(code).not.toMatch(/\bclear\(\)/);
    expect(code).not.toMatch(/\bclear\s*,/); // not destructured from useShoppingList()
  });
});

describe('Shopping List uses the real mutations for every backend-supported interaction', () => {
  it('destructures the real mutation/status surface actually used by this screen', () => {
    for (const name of [
      'items',
      'status',
      'error',
      'isInitializing',
      'isMutating',
      'isItemPending',
      'reload',
      'setChecked',
      'removeItem',
    ]) {
      expect(code).toMatch(new RegExp(`\\b${name}\\b`));
    }
  });

  it('checks/unchecks an item via the real setChecked mutation, not local state', () => {
    expect(code).toMatch(/setChecked\(item\.id,\s*!item\.isChecked\)/);
  });

  it('removes an item via the real removeItem mutation', () => {
    expect(code).toMatch(/removeItem\(item\.id\)/);
  });

  it('normal mode toggles check; edit mode removes — the teammate row-press contract', () => {
    expect(code).toMatch(/onPress=\{editing \? onRemove : onToggle\}/);
  });

  it('reconciles with server truth on focus and supports pull-to-refresh', () => {
    expect(code).toMatch(/useFocusEffect\(/);
    expect(code).toMatch(/reload\(\)/);
    expect(code).toMatch(/<RefreshControl\b/);
  });
});

describe('Manual add ports the teammate inline form without faking persistence', () => {
  it('never opens the canonical IngredientPickerModal from this screen', () => {
    expect(code).not.toMatch(/IngredientPickerModal/);
    expect(code).not.toMatch(/addItem/);
  });

  it('renders the teammate free-text name + qty inputs and Add Item/Done Adding toggle', () => {
    expect(code).toMatch(/<TextInput\b[\s\S]{0,120}placeholder="Item"/);
    expect(code).toMatch(/<TextInput\b[\s\S]{0,120}placeholder="Qty"/);
    expect(code).toMatch(/\{adding \? 'Done Adding' : 'Add Item'\}/);
  });

  it('keeps the draft as transient component state only — no persistence call on submit', () => {
    expect(code).toMatch(/const \[name, setName\] = useState\(''\)/);
    expect(code).toMatch(/const \[qty, setQty\] = useState\(''\)/);
    expect(code).toMatch(/function submitAdd|submitAdd = /);
    // submitAdd must not call any shopping-list mutation or storage API.
    const submitAddBody = code.match(/submitAdd = useCallback\(\(\) => \{([\s\S]*?)\}, \[name\]\)/);
    expect(submitAddBody).not.toBeNull();
    expect(submitAddBody[1]).not.toMatch(/addItem|addCustom|setItems|AsyncStorage|shoppingListService/);
  });

  it('submitting shows an honest unsupported-capability message, not a fabricated item', () => {
    expect(code).toMatch(/Alert\.alert\('Custom shopping items are not available yet\.'\)/);
  });

  it('does NOT clear the name/qty draft on an unsupported submit — the item was never persisted, so the draft is not discarded', () => {
    const submitAddBody = code.match(/submitAdd = useCallback\(\(\) => \{([\s\S]*?)\}, \[name\]\)/);
    expect(submitAddBody).not.toBeNull();
    expect(submitAddBody[1]).not.toMatch(/setName\(/);
    expect(submitAddBody[1]).not.toMatch(/setQty\(/);
  });

  it('never guesses an ingredient id or fabricates a shopping-list item shape', () => {
    expect(code).not.toMatch(/ingredientId:\s*genId|ingredientId:\s*name/);
    expect(code).not.toMatch(/\bgenId\(/);
  });
});

describe('Category grouping is honest, not keyword guessing', () => {
  it('never ports the teammate keyword-based category guesser', () => {
    expect(code).not.toMatch(/CAT_HINTS/);
    expect(code).not.toMatch(/\bcatFor\(/);
    expect(code).not.toMatch(/item\.cat\b|it\.cat\b/);
    expect(code).not.toMatch(/['"]Produce['"]|['"]Meat['"]|['"]Pantry['"]/);
  });

  it('groups every real item into a single honest fallback section', () => {
    expect(code).toMatch(/function itemCategory/);
    expect(code).toMatch(/function groupItems/);
    expect(code).toMatch(/return 'Other'/);
  });

  it('renders a sectioned presentation (group label + rows), not a flat un-sectioned list', () => {
    expect(code).toMatch(/sections\.map\(\(\{ category, rows \}\)/);
    expect(code).toMatch(/styles\.groupLabel/);
    expect(code).toMatch(/rows\.map\(\(item\)/);
  });
});

describe('No unavailable badge — the teammate source has no such control', () => {
  it('never imports or renders the Badge component', () => {
    expect(raw).not.toMatch(/import Badge from/);
    expect(code).not.toMatch(/<Badge\b/);
  });

  it('still shows an honest generic label for an archived/deleted ingredient (a real null field, not a decoration)', () => {
    expect(code).toMatch(/Unavailable ingredient/);
  });
});

describe('Shopping List has honest loading/error/empty states', () => {
  it('shows a loading indicator before first data, and a retry affordance on initial failure', () => {
    expect(code).toMatch(/isInitializing\s*&&\s*items\.length\s*===\s*0/);
    expect(code).toMatch(/status\s*===\s*'error'\s*&&\s*items\.length\s*===\s*0/);
    expect(code).toMatch(/onPress=\{\(\)\s*=>\s*reload\(\)\}/);
  });

  it('never shows a spinner with no way out on failure', () => {
    expect(code).toMatch(/retryBtn/);
  });

  it('renders an honest empty state, no fabricated demo groceries', () => {
    expect(code).toMatch(/Your shopping list is empty/);
    expect(code).not.toMatch(/Chicken|Garlic|Onion|Tomato|Bacon/);
  });
});

describe('Shopping List navigation stays a plain stack destination', () => {
  it('goes back via navigation.goBack(), never resets/replaces into MainTabs', () => {
    expect(code).toMatch(/navigation\.goBack\(\)/);
    expect(code).not.toMatch(/navigation\s*\.\s*replace\s*\(/);
    expect(code).not.toMatch(/navigation\s*\.\s*reset\s*\(/);
    expect(code).not.toMatch(/MainTabs/);
  });

  it('navigates nowhere else — this screen has no forward navigation targets', () => {
    const targets = [...code.matchAll(/navigation\.navigate\(\s*['"`]([^'"`]+)/g)].map((m) => m[1]);
    expect(targets).toEqual([]);
  });

  it('holds no authentication, session, or token state of its own', () => {
    expect(code).not.toMatch(/SecureStore|expo-secure-store|tokenStore/);
    expect(code).not.toMatch(/accessToken|refreshToken|idToken/);
    expect(code).not.toMatch(/useAuth\(/);
  });
});

describe('the List route registration is unchanged', () => {
  const nav = fs.readFileSync(path.join(SRC, 'navigation/RootNavigator.js'), 'utf8');

  it('RootNavigator still registers ShoppingListScreen at the "List" route name', () => {
    expect(nav).toMatch(/<Stack\.Screen name="List" component=\{ShoppingListScreen\} \/>/);
  });

  it('RecipeDetail still calls the real addRecipe mutation, unbroken by this port', () => {
    const recipeDetail = fs.readFileSync(path.join(SRC, 'screens/RecipeDetailScreen.js'), 'utf8');
    expect(recipeDetail).toMatch(/const \{ addRecipe, isMutating, pendingAction \} = useShoppingList\(\);/);
    expect(recipeDetail).toMatch(/await addRecipe\(recipe\.id\)/);
  });

  it('existing callers still navigate to the "List" route name', () => {
    const savedScreen = fs.readFileSync(path.join(SRC, 'screens/SavedScreen.js'), 'utf8');
    expect(savedScreen).toMatch(/navigation\.navigate\('List'\)/);
  });
});

describe('ShoppingListContext still exports real capabilities this screen no longer surfaces', () => {
  const ctx = fs.readFileSync(path.join(SRC, 'context/ShoppingListContext.js'), 'utf8');

  it('clear() and addItem() remain intact for any future real surface', () => {
    expect(ctx).toMatch(/const clear = useCallback/);
    expect(ctx).toMatch(/const addItem = useCallback/);
    expect(ctx).toMatch(/\n\s*clear,/);
    expect(ctx).toMatch(/\n\s*addItem,/);
  });
});
