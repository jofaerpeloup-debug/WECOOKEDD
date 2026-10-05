const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FILE = path.join(__dirname, '../src/screens/IngredientStudioScreen.js');
const raw = fs.readFileSync(FILE, 'utf8');
const code = raw
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const OPEN_TO_CLOSE = { '(': ')', '[': ']', '{': '}' };
const CLOSERS = new Set(Object.values(OPEN_TO_CLOSE));

function exactAnchorIndexes(source, anchor) {
  const indexes = [];
  let from = 0;
  while (from <= source.length) {
    const index = source.indexOf(anchor, from);
    if (index === -1) break;
    indexes.push(index);
    from = index + anchor.length;
  }
  return indexes;
}

function balancedEnd(source, openingIndex, label) {
  const opening = source[openingIndex];
  if (!OPEN_TO_CLOSE[opening]) {
    throw new Error(`${label}: opening delimiter not found`);
  }

  const stack = [];
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = openingIndex; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (OPEN_TO_CLOSE[char]) {
      stack.push(char);
      continue;
    }
    if (CLOSERS.has(char)) {
      const expected = OPEN_TO_CLOSE[stack[stack.length - 1]];
      if (char !== expected) {
        throw new Error(`${label}: unbalanced delimiter`);
      }
      stack.pop();
      if (stack.length === 0) return index;
    }
  }

  throw new Error(`${label}: unbalanced delimiter`);
}

function extractUniqueBalanced(source, options) {
  const { anchor, opening, label, expectedEnd, after, openingAfterAnchor = false } = options;
  const indexes = exactAnchorIndexes(source, anchor);
  if (indexes.length === 0) throw new Error(`${label}: missing anchor`);
  if (indexes.length !== 1) throw new Error(`${label}: duplicate anchor`);

  const anchorIndex = indexes[0];
  const openingIndex = source.indexOf(
    opening,
    openingAfterAnchor ? anchorIndex + anchor.length : anchorIndex
  );
  if (openingIndex === -1) throw new Error(`${label}: opening delimiter not found`);
  const endIndex = balancedEnd(source, openingIndex, label);
  const region = source.slice(anchorIndex, endIndex + 1);

  if (expectedEnd && !expectedEnd.test(region)) {
    throw new Error(`${label}: incorrect closing boundary`);
  }
  if (after && !after.test(source.slice(endIndex + 1))) {
    throw new Error(`${label}: cross-block closing boundary`);
  }
  return region;
}

const extractSearchEffect = () => extractUniqueBalanced(code, {
  anchor: 'useEffect(function loadIngredientCatalog()',
  opening: '(',
  label: 'ingredient search effect',
  expectedEnd: /,\s*\[accountStateIsCurrent, authUserId, query, searchNonce\]\)$/,
  after: /^\s*;/,
});

const extractSubstitutionEffect = () => extractUniqueBalanced(code, {
  anchor: 'useEffect(function loadSubstitutions()',
  opening: '(',
  label: 'substitution effect',
  expectedEnd: /,\s*\[accountStateIsCurrent, authUserId, selected, substitutesNonce\]\)$/,
  after: /^\s*;/,
});

const extractRenderer = (source = code) => extractUniqueBalanced(source, {
  anchor: 'const renderSubstitutions = () =>',
  opening: '{',
  label: 'substitution renderer',
  expectedEnd: /\}$/,
  after: /^\s*;/,
});

const extractComponent = (source = code) => extractUniqueBalanced(source, {
  anchor: 'export default function IngredientStudioScreen({ navigation, route })',
  opening: '{',
  label: 'Ingredient Studio component',
  openingAfterAnchor: true,
  expectedEnd: /\}$/,
  after: /^\s*function makeStyles/,
});

const PAIRING_ASSIGNMENT = /const substitutionStateIsCurrent = sourceMatchesSelection\(\s*selected\?\.id,\s*substitutionState\.sourceIngredientId\s*\);/;

function pairingWiringEvidence(source = code) {
  const component = extractComponent(source);
  const assignmentMatches = component.match(new RegExp(PAIRING_ASSIGNMENT.source, 'g')) || [];
  if (assignmentMatches.length !== 1) {
    throw new Error('pairing wiring: missing, duplicate, or disconnected predicate assignment');
  }

  const assignmentIndex = component.search(PAIRING_ASSIGNMENT);
  const rendererStart = component.indexOf('const renderSubstitutions = () =>');
  const renderer = extractRenderer(source);
  const gateIndex = renderer.indexOf(
    'if (!substitutionStateIsCurrent || substitutionState.loading)'
  );
  const resultIndex = renderer.indexOf('substitutionState.substitutes.map');
  const navigationIndex = renderer.indexOf("navigation.navigate('SwapDetail'");

  if (
    assignmentIndex < 0
    || rendererStart <= assignmentIndex
    || gateIndex < 0
    || resultIndex <= gateIndex
    || navigationIndex <= resultIndex
  ) {
    throw new Error('pairing wiring: predicate is not connected to gated actionable results');
  }

  return { component, renderer };
}

const ASSERTED_PRODUCT_CLAIMS = [
  /\b\d{1,3}\s*%\s*(?:compatible|compatibility|confidence|similarity|match)\b/i,
  /\b(?:compatible|compatibility|confidence|similarity|match)\b\s*(?:score\s*)?(?::|=|is)?\s*\d{1,3}\s*%/i,
  /\bbest\s+(?:available\s+)?substitute\b/i,
  /\bhighly\s+recommended\b/i,
  /\bsafe\s+for\s+(?:allergies|allergens|any diet|dietary needs)\b/i,
  /\b(?:allergen|allergy|dietary|diet)[- ]*(?:safe|free|guaranteed)\b/i,
  /\b(?:nutritionally|scientifically|health-wise)\s+equivalent\b/i,
  /\b\d+(?:\.\d+)?\s*:\s*\d+(?:\.\d+)?\s+(?:substitution\s+)?ratio\b/i,
  /\bAI\s+(?:recommends?|suggests?|reasons?)\b/i,
  /\branked?\s*(?:#|number\s*)?\d+\b/i,
  /\b(?:confidence|compatibility|similarity|health)\s+score\s*(?::|=|is)\s*\d+/i,
];

const LIMITATION_LANGUAGE = /\b(?:no|not|never|without|unavailable|unsupported|not provided|not assumed|does not|isn't|aren't)\b/i;

function assertedProductClaims(source) {
  const segments = source
    .replace(/<[^>]+>/g, '\n')
    .split(/[\r\n.!?;]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  return segments.flatMap((segment) => {
    if (LIMITATION_LANGUAGE.test(segment)) return [];
    return ASSERTED_PRODUCT_CLAIMS
      .filter((pattern) => pattern.test(segment))
      .map((pattern) => ({ pattern: pattern.source, segment }));
  });
}

describe('balanced source extraction fails closed', () => {
  const baseOptions = {
    anchor: 'target',
    opening: '(',
    label: 'mutation',
    expectedEnd: /\)$/,
    after: /^\s*;/,
  };

  it('rejects missing and duplicate anchors', () => {
    expect(() => extractUniqueBalanced('other(() => {});', baseOptions)).toThrow('missing anchor');
    expect(() => extractUniqueBalanced('target(() => {}); target(() => {});', baseOptions))
      .toThrow('duplicate anchor');
  });

  it('rejects unbalanced blocks and parentheses', () => {
    expect(() => extractUniqueBalanced('target(() => { value(); );', baseOptions))
      .toThrow('unbalanced delimiter');
    expect(() => extractUniqueBalanced('target((value);', baseOptions))
      .toThrow('unbalanced delimiter');
  });

  it('rejects a closing delimiter at an incorrect cross-block boundary', () => {
    expect(() => extractUniqueBalanced(
      'target(() => {}); unrelated(() => {});',
      { ...baseOptions, after: /^\s*expectedBoundary/ }
    )).toThrow('cross-block closing boundary');
  });
});

describe('Ingredient Studio real catalog integration', () => {
  it('keeps one freshness-guarded canonical ingredient search effect', () => {
    const effect = extractSearchEffect();

    expect(effect).toMatch(/const generation = \+\+searchGeneration\.current/);
    expect(effect).toMatch(/searchIngredientsStrict\(\{\s*search: trimmed \|\| undefined,\s*limit: SEARCH_LIMIT/);
    expect(effect).toMatch(/generation !== searchGeneration\.current/);
    expect(effect).toMatch(/ownerId !== authOwnerRef\.current/);
    expect(effect).toMatch(/setIngredients\(result\.ingredients\)/);
    expect(effect).toMatch(/setSelected\(result\.ingredients\[0\] \|\| null\)/);
    expect(effect).toMatch(/setConfirmedEmptyQuery\(trimmed && result\.ingredients\.length === 0 \? trimmed : null\)/);
    expect(effect).toMatch(/setSearchError\(getIngredientErrorMessage\(err\)\)/);
    expect(effect).toMatch(/clearTimeout\(timer\)/);
  });

  it('exposes Assistant only for the current confirmed nonblank empty search', () => {
    const component = extractComponent();
    expect(component).toMatch(/confirmedEmptyQuery === query\.trim\(\) && query\.trim\(\)/);
    expect(component).toMatch(/assistantHandoffRef\.current/);
    expect(component).toMatch(/navigation\.navigate\('Assistant', \{\s*initialPrompt:/);
    expect(component).toMatch(/searchLoading \|\|\s*searchError \|\|\s*selected/);
    expect(component).toMatch(/setSelected\(null\)/);
    expect(component).toMatch(/setConfirmedEmptyQuery\(null\)/);
  });

  it('keeps one source-tagged, freshness-guarded substitution lookup', () => {
    const effect = extractSubstitutionEffect();

    expect(effect).toMatch(/if \(!selected\?\.id\)/);
    expect(effect).toMatch(/const generation = \+\+substitutesGeneration\.current/);
    expect(effect).toMatch(/getSubstitutesFor\(selected\.id\)/);
    expect(effect).toMatch(/generation === substitutesGeneration\.current/);
    expect(effect).toMatch(/ownerId === authOwnerRef\.current/);
    expect(effect).toMatch(
      /sourceIngredientId: selected\.id,\s*substitutes: result\.substitutes,\s*loading: false,\s*error: null/
    );
    expect(effect).toMatch(
      /sourceIngredientId: selected\.id,\s*substitutes: \[\],\s*loading: false,\s*error: getSubstitutionErrorMessage\(err\)/
    );
  });

  it('invalidates A results immediately when B is selected and accepts only B results', () => {
    const helper = extractUniqueBalanced(code, {
      anchor: 'function sourceMatchesSelection',
      opening: '{',
      label: 'source pairing predicate',
      expectedEnd: /\}$/,
      after: /^\s*function compactContextLabel/,
    });
    const sourceMatchesSelection = vm.runInNewContext(`(${helper})`);
    const ingredientA = 'aaaaaaaaaaaaaaaaaaaaaaaa';
    const ingredientB = 'bbbbbbbbbbbbbbbbbbbbbbbb';

    expect(sourceMatchesSelection(ingredientA, ingredientA)).toBe(true);
    expect(sourceMatchesSelection(ingredientB, ingredientA)).toBe(false);
    expect(sourceMatchesSelection(ingredientB, ingredientB)).toBe(true);

    const { renderer } = pairingWiringEvidence();
    expect(renderer).toMatch(/return \(\s*<View style=\{styles\.resultStatus\}[^>]*>/);
  });

  it('fails closed if the real predicate assignment is disconnected or forced true', () => {
    const disconnected = code.replace(PAIRING_ASSIGNMENT, 'const substitutionStateIsCurrent = true;');
    expect(disconnected).not.toBe(code);
    expect(() => pairingWiringEvidence(disconnected)).toThrow(
      'missing, duplicate, or disconnected predicate assignment'
    );
  });

  it('binds returned fields and navigates with the exact paired source and substitution', () => {
    const renderer = extractRenderer();

    expect(renderer).toMatch(/substitution\.substitute\.name/);
    expect(renderer).toMatch(/substitution\.contexts\[0\]/);
    expect(renderer).toMatch(/substitution\.notes/);
    expect(renderer).toMatch(
      /navigation\.navigate\('SwapDetail', \{\s*sourceIngredient: selected,\s*substitution,\s*\}\)/
    );
  });

  it('retains scoped loading, error/retry, empty, and selection states', () => {
    const searchEffect = extractSearchEffect();
    const renderer = extractRenderer();
    const component = extractComponent();

    expect(searchEffect).toMatch(/setSearchLoading\(true\)/);
    expect(component).toMatch(/searchLoading && ingredients\.length === 0/);
    expect(component).toMatch(/setSearchNonce\(\(n\) => n \+ 1\)/);
    expect(component).toMatch(/No ingredients match/);
    expect(component).toMatch(/onPress=\{\(\) => setSelected\(ingredient\)\}/);
    expect(renderer).toMatch(/substitutionState\.loading/);
    expect(renderer).toMatch(/setSubstitutesNonce\(\(n\) => n \+ 1\)/);
    expect(renderer).toMatch(/substitutionState\.substitutes\.length === 0/);
    expect(renderer).toMatch(/No substitutions available/);
  });

  it('keeps long context presentation compact without discarding real context data', () => {
    const renderer = extractRenderer();
    const compactLabel = extractUniqueBalanced(code, {
      anchor: 'function compactContextLabel',
      opening: '{',
      label: 'compact context label',
      expectedEnd: /\}$/,
      after: /^\s*export default function IngredientStudioScreen/,
    });

    expect(renderer).toMatch(/const primaryContext = substitution\.contexts\[0\] \|\| 'Catalog'/);
    expect(renderer).toMatch(/label=\{compactContextLabel\(primaryContext\)\}/);
    expect(renderer).toMatch(/accessibilityLabel=\{`[^`]*Context: \$\{primaryContext\}`\}/);
    expect(renderer).toMatch(/sourceIngredient: selected,\s*substitution,/);
    expect(compactLabel).toMatch(/context\.slice\(0, COMPACT_CONTEXT_MAX_LENGTH - 1\)/);
    expect(code).toMatch(/contextBadgeWrap: \{\s*flexShrink: 1,\s*maxWidth: '42%',\s*overflow: 'hidden'/);
  });

  it('distinguishes affirmative unsupported claims from truthful limitations', () => {
    const rejectedClaims = [
      '95% compatible',
      'Compatibility score: 95%',
      'Best substitute',
      'Highly recommended',
      'Safe for allergies',
      'Nutritionally equivalent',
      '1:1 substitution ratio',
      'AI recommends this swap',
      'Ranked #1',
      'Confidence score: 92',
    ];
    const allowedLimitations = [
      'No quantity ratio is assumed',
      'No confidence score is provided',
      'Nutrition equivalence is unavailable',
      'Compatibility score is not provided',
      'No allergen safety guarantee is made',
      'AI recommendations are unavailable',
      'We do not claim a best substitute',
    ];

    rejectedClaims.forEach((claim) => {
      expect(assertedProductClaims(claim)).not.toHaveLength(0);
    });
    allowedLimitations.forEach((limitation) => {
      expect(assertedProductClaims(limitation)).toEqual([]);
    });

    const affirmativeOutsideRenderer = code.replace(
      'INGREDIENT CATALOG',
      '95% compatible'
    );
    const limitationOutsideRenderer = code.replace(
      'INGREDIENT CATALOG',
      'No confidence score is provided'
    );
    expect(affirmativeOutsideRenderer).not.toBe(code);
    expect(assertedProductClaims(extractComponent(affirmativeOutsideRenderer)))
      .not.toHaveLength(0);
    expect(assertedProductClaims(extractComponent(limitationOutsideRenderer))).toEqual([]);
  });

  it('rejects unsupported semantics across the complete executable component', () => {
    const component = extractComponent();

    expect(component).toMatch(/No quantity ratio is assumed/);
    expect(assertedProductClaims(component)).toEqual([]);
    expect(code).not.toMatch(
      /substitution\.(?:ratio|score|rank|confidence|compatibility|similarity|nutrition|health|science)\b/i
    );
    expect(code).not.toMatch(/Math\.(?:round|floor|ceil)\([\s\S]*?(?:score|rank|confidence|percent)/i);
    expect(code).not.toMatch(
      /\b(?:calculate|compute|derive|estimate)(?:Confidence|Compatibility|Similarity|Nutrition|Health|Rank|Score|Ratio)\s*\(/i
    );
    expect(code).not.toMatch(/\b(?:convertQuantity|convertAmount|calculateRatio|applyRatio)\s*\(/i);
    expect(code).not.toMatch(/\b(?:askChef|useAi|generateRecommendation|generateReasoning)\s*\(/i);
    expect(code).not.toMatch(/data\/mockData|ingredientSwaps|molecularSwap|askChef|useAi|\bfetch\s*\(/);
    expect(code).not.toMatch(
      /const\s+\w*(?:substitut|swap|replacement)\w*\s*=\s*(?:\[|\{|new Map)/i
    );
    expect(code).not.toMatch(/\bnew Map\s*\(/);
  });
});
