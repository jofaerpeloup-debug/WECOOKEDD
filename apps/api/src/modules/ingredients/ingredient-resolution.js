const { toResolutionIngredient } = require('./ingredient.serializer');

const MAX_CANDIDATES = 10;
const UNIT_TOKENS = new Map([
  ['g', 'g'], ['gram', 'g'], ['grams', 'g'],
  ['kg', 'kg'], ['kilogram', 'kg'], ['kilograms', 'kg'],
  ['lb', 'lb'], ['lbs', 'lb'], ['pound', 'lb'], ['pounds', 'lb'],
  ['oz', 'oz'], ['ounce', 'oz'], ['ounces', 'oz'],
  ['ml', 'ml'], ['milliliter', 'ml'], ['milliliters', 'ml'], ['millilitre', 'ml'], ['millilitres', 'ml'],
  ['l', 'l'], ['liter', 'l'], ['liters', 'l'], ['litre', 'l'], ['litres', 'l'],
  ['tsp', 'tsp'], ['teaspoon', 'tsp'], ['teaspoons', 'tsp'],
  ['tbsp', 'tbsp'], ['tablespoon', 'tbsp'], ['tablespoons', 'tbsp'],
  ['cup', 'cup'], ['cups', 'cup'], ['piece', 'piece'], ['pieces', 'piece'],
  ['clove', 'clove'], ['cloves', 'clove'], ['slice', 'slice'], ['slices', 'slice'],
  ['can', 'can'], ['cans', 'can'], ['pack', 'pack'], ['packs', 'pack'],
  ['bunch', 'bunch'], ['bunches', 'bunch'], ['pinch', 'pinch'], ['pinches', 'pinch'],
]);

function normalizeUnitToken(token) {
  const normalized = token.toLowerCase();
  const baseToken = normalized.endsWith('.') ? normalized.slice(0, -1) : normalized;
  return UNIT_TOKENS.get(baseToken) || null;
}

function normalizeResolverName(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/gu, ' ');
}

function hasMalformedNumericContinuation(rest) {
  const firstTokenMatch = rest.match(/^(\S+)(?:\s+|$)/u);
  if (!firstTokenMatch) return false;
  const firstToken = firstTokenMatch[1];
  if (normalizeUnitToken(firstToken)) return false;
  if (/\p{Number}/u.test(firstToken)) return true;
  const afterFirstToken = rest.slice(firstTokenMatch[0].length).trimStart();
  return /^(?:\p{Number}|\.\p{Number})/u.test(afterFirstToken);
}

function parseQuantityPrefix(text) {
  const patterns = [
    /^(\d+)\s+(\d+)\s*\/\s*(\d+)(?=\s|$)/u,
    /^(\d+)\s*\/\s*(\d+)(?=\s|$)/u,
    /^((?:\d+(?:\.\d+)?|\.\d+))(?=\s|$)/u,
  ];
  for (let index = 0; index < patterns.length; index += 1) {
    const match = text.match(patterns[index]);
    if (!match) continue;
    let quantity;
    if (index === 0) {
      const numerator = Number(match[2]);
      const denominator = Number(match[3]);
      if (numerator <= 0 || denominator <= 0) return { rejected: true };
      quantity = Number(match[1]) + (numerator / denominator);
    } else if (index === 1) {
      const numerator = Number(match[1]);
      const denominator = Number(match[2]);
      if (numerator <= 0 || denominator <= 0) return { rejected: true };
      quantity = numerator / denominator;
    }
    else quantity = Number(match[1]);
    if (!Number.isFinite(quantity) || quantity <= 0) return { rejected: true };
    const rest = text.slice(match[0].length).trim();
    if (/^(?:\d|\.\d|\/)/u.test(rest) || hasMalformedNumericContinuation(rest)) return { rejected: true };
    return { quantity, rest };
  }
  return /^(?:\d|\.\d)/u.test(text) ? { rejected: true } : null;
}

function parseIngredientLine(sourceText) {
  const source = String(sourceText);
  let remaining = source.trim();
  const initialQuantityMatch = parseQuantityPrefix(remaining);
  if (initialQuantityMatch?.rejected) return { quantity: null, unit: null, name: remaining || null };
  const toTaste = /(?:^|\s)to taste$/iu.test(remaining);
  if (toTaste) remaining = remaining.replace(/(?:^|\s)to taste$/iu, '').trim();

  const quantityMatch = parseQuantityPrefix(remaining);
  let quantity = quantityMatch?.quantity ?? null;
  if (quantityMatch) remaining = quantityMatch.rest;

  let unit = null;
  if (quantityMatch) {
    const tokenMatch = remaining.match(/^(\S+)(?:\s+|$)/u);
    const mapped = tokenMatch && normalizeUnitToken(tokenMatch[1]);
    if (mapped) {
      unit = mapped;
      remaining = remaining.slice(tokenMatch[0].length).trim();
      if (/^of(?:\s+|$)/iu.test(remaining)) remaining = remaining.replace(/^of(?:\s+|$)/iu, '').trim();
    }
  }
  if (toTaste) {
    quantity = null;
    unit = 'toTaste';
  }

  return { quantity, unit, name: remaining || null };
}

function containsContiguous(haystack, needle) {
  if (!needle.length || needle.length > haystack.length) return false;
  for (let index = 0; index <= haystack.length - needle.length; index += 1) {
    if (needle.every((token, offset) => haystack[index + offset] === token)) return true;
  }
  return false;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function evidenceFor(parsedName, ingredient) {
  const query = normalizeResolverName(parsedName);
  const queryTokens = query.split(' ');
  const fields = [
    { matchedOn: 'name', matchedText: ingredient.name },
    ...(ingredient.aliases || []).map((matchedText) => ({ matchedOn: 'alias', matchedText })),
  ];
  const evidence = [];
  for (const field of fields) {
    const normalized = normalizeResolverName(field.matchedText);
    const tokens = normalized.split(' ');
    if (normalized === query) evidence.push({ ...field, rank: 0, difference: 0 });
    else if (containsContiguous(tokens, queryTokens) || containsContiguous(queryTokens, tokens)) {
      evidence.push({ ...field, rank: 1, difference: Math.abs(tokens.length - queryTokens.length) });
    }
  }
  evidence.sort((a, b) => a.rank - b.rank
    || (a.matchedOn === 'name' ? -1 : 1) - (b.matchedOn === 'name' ? -1 : 1)
    || a.difference - b.difference
    || compareText(normalizeResolverName(a.matchedText), normalizeResolverName(b.matchedText)));
  return evidence[0] || null;
}

function compareCandidates(a, b) {
  return a.evidence.rank - b.evidence.rank
    || a.evidence.difference - b.evidence.difference
    || (a.evidence.matchedOn === 'name' ? -1 : 1) - (b.evidence.matchedOn === 'name' ? -1 : 1)
    || compareText(normalizeResolverName(a.ingredient.name), normalizeResolverName(b.ingredient.name))
    || compareText(String(a.ingredient._id), String(b.ingredient._id));
}

function resolveIngredientLine(sourceText, catalog, index = 0) {
  const parsed = parseIngredientLine(sourceText);
  if (!parsed.name) {
    return { index, sourceText, parsed, match: { kind: 'unparsed', totalCandidates: 0, truncated: false, candidates: [] } };
  }
  const candidates = catalog.map((ingredient) => ({ ingredient, evidence: evidenceFor(parsed.name, ingredient) }))
    .filter(({ evidence }) => evidence);
  const exact = candidates.filter(({ evidence }) => evidence.rank === 0);
  const classified = (exact.length ? exact : candidates).sort(compareCandidates);
  const kind = exact.length === 1 ? 'exact' : exact.length > 1 ? 'ambiguous' : classified.length ? 'possible' : 'none';
  const returned = classified.slice(0, MAX_CANDIDATES).map(({ ingredient, evidence }) => ({
    ingredient: toResolutionIngredient(ingredient),
    matchedOn: evidence.matchedOn,
    matchedText: evidence.matchedText,
  }));
  return {
    index,
    sourceText,
    parsed,
    match: {
      kind,
      totalCandidates: classified.length,
      truncated: classified.length > MAX_CANDIDATES,
      candidates: returned,
    },
  };
}

function resolveIngredientLines(lines, catalog) {
  return lines.map((line, index) => resolveIngredientLine(line, catalog, index));
}

module.exports = {
  MAX_CANDIDATES,
  normalizeResolverName,
  parseIngredientLine,
  resolveIngredientLine,
  resolveIngredientLines,
};
