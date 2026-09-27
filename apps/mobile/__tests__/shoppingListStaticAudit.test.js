const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../src');
const read = (relativePath) => fs.readFileSync(path.join(SRC, relativePath), 'utf8');
const stripComments = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const raw = read('screens/ShoppingListScreen.js');
const code = stripComments(raw);
const pickerRaw = read('components/IngredientPickerModal.js');
const pickerCode = stripComments(pickerRaw);
const contextCode = stripComments(read('context/ShoppingListContext.js'));

function occurrences(source, anchor) {
  return source.split(anchor).length - 1;
}

function uniqueRegion(source, start, end) {
  expect(occurrences(source, start)).toBe(1);
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to + end.length);
}

function region(start, end) {
  return uniqueRegion(code, start, end);
}

describe('Shopping List authoritative bindings', () => {
  it('uses the real context and wires every supported screen mutation', () => {
    expect(raw).toMatch(/useShoppingList.*ShoppingListContext/);
    const bindings = region('    items,', '} = useShoppingList();');
    for (const name of ['items', 'reload', 'addItem', 'setChecked', 'removeItem', 'clear']) {
      expect(bindings).toMatch(new RegExp(`\\b${name}\\b`));
    }
    expect(code).toMatch(/setChecked\(item\.id, !item\.isChecked\)/);
    expect(code).toMatch(/removeItem\(item\.id\)/);
  });

  it('does not create free-text, mock, local, or duplicate list authority', () => {
    expect(code).not.toMatch(/TextInput|addCustom|setItems|AsyncStorage|mockData|ShoppingListProvider/);
    expect(code).not.toMatch(/ingredientId:\s*(name|genId)|\bgenId\(/);
  });
});

describe('Shopping List destructive clear flow', () => {
  const clearHandler = uniqueRegion(
    code,
    'const confirmClear = useCallback(() => {',
    '}, [clear]);'
  );

  it('requires confirmation and keeps clear exclusively inside the destructive confirm callback', () => {
    expect(clearHandler).toMatch(/Alert\.alert\('Clear shopping list\?'/);
    expect(clearHandler).toMatch(/\{ text: 'Cancel', style: 'cancel' \}/);
    const cancelPath = clearHandler.slice(
      clearHandler.indexOf("{ text: 'Cancel'"),
      clearHandler.indexOf("text: 'Clear List'")
    );
    const confirmPath = clearHandler.slice(clearHandler.indexOf("text: 'Clear List'"));
    expect(cancelPath).not.toMatch(/\bclear\(\)/);
    expect(confirmPath).toMatch(/onPress: async \(\) => \{[\s\S]*?const result = await clear\(\)/);
    expect(clearHandler.match(/\bclear\(\)/g)).toHaveLength(1);
  });

  it('keeps duplicate protection and truthful failure handling', () => {
    const clearControl = region('{editing ? (', ') : null}');
    expect(clearControl).toMatch(/onPress=\{confirmClear\}/);
    expect(clearControl).toMatch(/disabled=\{isMutating\}/);
    expect(clearControl).toMatch(/accessibilityState=\{\{ disabled: isMutating \}\}/);
    expect(clearHandler).toMatch(/!result\.ok && result\.error/);
    expect(clearHandler).toMatch(/Alert\.alert\('Could not clear list', result\.error\)/);
    expect(contextCode).toMatch(/if \(mutatingRef\.current\) return \{ ok: false, busy: true \}/);
  });

  it('never clears local list state from the screen', () => {
    expect(clearHandler).not.toMatch(/setItems|filter\(|splice\(|AsyncStorage/);
    const contextClear = uniqueRegion(
      contextCode,
      'const clear = useCallback(',
      '[runMutation]'
    );
    expect(contextClear).toMatch(/runMutation\(\{ type: 'clear' \}, \(\) => shoppingListService\.clearItems\(\)\)/);
  });
});

describe('Canonical picker add authority chain', () => {
  it('derives the real payload from the selected canonical id, unit, and parsed quantity', () => {
    const submit = uniqueRegion(
      pickerCode,
      'const submit = useCallback(async () => {',
      '}, [submitting, selected, unit, qty, onAdd, onClose]);'
    );
    expect(submit).toMatch(/if \(!selected\)/);
    expect(submit).toMatch(/if \(!unit\)/);
    expect(submit).toMatch(/const parsed = parseQuantity\(qty\)/);
    expect(submit).toMatch(/quantity = parsed/);
    expect(submit).toMatch(/result = await onAdd\(\{ ingredientId: selected\.id, unit, quantity \}\)/);
    expect(submit).not.toMatch(/ingredientId:\s*(query|name)|setItems|shoppingListService/);
  });

  it('mounts that picker with context addItem and preserves the provider/service mutation path', () => {
    const picker = region('<IngredientPickerModal', '/>');
    expect(picker).toMatch(/visible=\{pickerVisible\}/);
    expect(picker).toMatch(/onClose=\{\(\) => setPickerVisible\(false\)\}/);
    expect(picker).toMatch(/onAdd=\{addItem\}/);

    const addItem = uniqueRegion(contextCode, 'const addItem = useCallback(', 'const addRecipe = useCallback(');
    expect(addItem).toMatch(/\(\{ ingredientId, unit, quantity \}\) =>/);
    expect(addItem).toMatch(/runMutation\(\{ type: 'addItem' \}/);
    expect(addItem).toMatch(/shoppingListService\.addItem\(\{ ingredientId, unit, quantity \}\)/);
  });
});

describe('Ingredient picker accessibility follows real UI state', () => {
  it('labels the heading and existing close action', () => {
    const header = uniqueRegion(pickerCode, '<View style={styles.header}>', '</View>');
    expect(header).toMatch(/<Text style=\{styles\.title\} accessibilityRole="header">Add Item<\/Text>/);
    expect(header).toMatch(/onPress=\{onClose\}[\s\S]*?accessibilityRole="button"[\s\S]*?accessibilityLabel="Close add item"/);
  });

  it('identifies every ingredient result using its real name', () => {
    const results = uniqueRegion(pickerCode, '{results.map((ing) => (', '))}');
    expect(results).toMatch(/key=\{ing\.id\}/);
    expect(results).toMatch(/onPress=\{\(\) => pickIngredient\(ing\)\}/);
    expect(results).toMatch(/accessibilityRole="button"/);
    expect(results).toMatch(/accessibilityLabel=\{`Select \$\{ing\.name\}`\}/);
    expect(results).not.toMatch(/selected: true|disabled: true/);
  });

  it('ties unit labels and selected state to the rendered unit and active predicate', () => {
    const units = uniqueRegion(pickerCode, '{RECIPE_UNITS.map((u) => {', '})}');
    expect(units).toMatch(/const active = unit === u/);
    expect(units).toMatch(/onPress=\{\(\) => pickUnit\(u\)\}/);
    expect(units).toMatch(/accessibilityRole="button"/);
    expect(units).toMatch(/accessibilityLabel=\{`\$\{unitLabel\(u\)\} unit`\}/);
    expect(units).toMatch(/accessibilityState=\{\{ selected: active \}\}/);
    expect(units).not.toMatch(/selected: true/);
  });

  it('exposes search busy state from the real searchLoading value', () => {
    const busyBinding = uniqueRegion(
      pickerCode,
      'searchLoading && results.length === 0',
      '/>'
    );
    expect(busyBinding).toMatch(/<ActivityIndicator[\s\S]*?accessible/);
    expect(busyBinding).toMatch(/accessibilityLabel="Searching ingredients"/);
    expect(busyBinding).toMatch(/accessibilityState=\{\{ busy: searchLoading \}\}/);
    expect(pickerCode).toMatch(/searchLoading && results\.length === 0/);
    expect(pickerCode).not.toMatch(/busy: true/);
  });

  it('ties submit semantics to the same submit, canSubmit, and submitting values as Button', () => {
    const footer = uniqueRegion(pickerCode, '<View style={styles.footer}>', '</KeyboardAvoidingView>');
    expect(footer).toMatch(/accessible[\s\S]*?accessibilityRole="button"/);
    expect(footer).toMatch(/accessibilityLabel="Add item to shopping list"/);
    expect(footer).toMatch(/accessibilityState=\{\{ disabled: !canSubmit, busy: submitting \}\}/);
    expect(footer).toMatch(/onAccessibilityTap=\{submit\}/);
    expect(footer).toMatch(/onPress=\{submit\}/);
    expect(footer).toMatch(/disabled=\{!canSubmit\}/);
    expect(footer).toMatch(/loading=\{submitting\}/);
    expect(footer).not.toMatch(/disabled: (true|false)|busy: (true|false)/);
  });
});

describe('Shopping List identity, states, and navigation', () => {
  it('keys and mutates rows with the real item id and separated control state', () => {
    const rows = region('rows.map((item)', '              ))}');
    expect(rows).toMatch(/key=\{item\.id\}/);
    expect(rows).toMatch(/pending=\{isItemPending\(item\.id\)\}/);
    expect(rows).toMatch(/onToggle=\{\(\) => onToggle\(item\)\}/);
    expect(rows).toMatch(/onRemove=\{\(\) => onRemove\(item\)\}/);
    const row = region('function ItemRow', 'export default function ShoppingListScreen');
    expect(row).toMatch(/accessibilityRole=\{editing \? 'button' : 'checkbox'\}/);
    expect(row).toMatch(/checked: !!item\.isChecked/);
    expect(row).toMatch(/disabled,[\s\S]*busy: pending/);
  });

  it('keeps truthful load, error, refresh, empty, and grouping states', () => {
    expect(code).toMatch(/useFocusEffect\([\s\S]*?reload\(\)/);
    expect(code).toMatch(/<RefreshControl[\s\S]*?onRefresh=\{onRefresh\}/);
    expect(code).toMatch(/isInitializing && items\.length === 0/);
    expect(code).toMatch(/status === 'error' && items\.length === 0/);
    expect(code).toMatch(/error && items\.length > 0/);
    expect(code).toMatch(/Your shopping list is empty/);
    const grouping = region('function groupItems', 'function ItemRow');
    expect(grouping).toMatch(/category: 'Items'/);
    expect(grouping).not.toMatch(/Produce|Meat|Pantry|catFor|CAT_HINTS/);
  });

  it('keeps the existing List route and recipe-add integration', () => {
    const nav = read('navigation/RootNavigator.js');
    const recipe = read('screens/RecipeDetailScreen.js');
    expect(code).toMatch(/navigation\.goBack\(\)/);
    expect(code).not.toMatch(/navigation\.(navigate|reset|replace)\(/);
    expect(nav).toMatch(/<Stack\.Screen name="List" component=\{ShoppingListScreen\} \/>/);
    expect(recipe).toMatch(/await addRecipe\(recipe\.id\)/);
  });
});
