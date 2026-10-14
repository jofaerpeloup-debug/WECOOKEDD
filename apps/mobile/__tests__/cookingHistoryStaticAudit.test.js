const fs = require('fs');
const path = require('path');
const { lightColors, darkColors } = require('../src/theme/theme');

const sourcePath = path.join(__dirname, '../src/screens/CookingHistoryScreen.js');
const raw = fs.readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');

function contrastRatio(foreground, background) {
  const luminance = (hex) => {
    const channels = hex.slice(1).match(/../g).map((value) => parseInt(value, 16) / 255);
    const linear = channels.map((value) =>
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    );
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };
  const light = Math.max(luminance(foreground), luminance(background));
  const dark = Math.min(luminance(foreground), luminance(background));
  return (light + 0.05) / (dark + 0.05);
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function occurrences(source, value) {
  return source.split(value).length - 1;
}

function matchingBrace(source, openIndex) {
  expect(source[openIndex]).toBe('{');
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = openIndex; index < source.length; index += 1) {
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
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
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
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  throw new Error('Unbalanced production block.');
}

function extractHandler(source, declaration) {
  expect(occurrences(source, declaration)).toBe(1);
  const start = source.indexOf(declaration);
  const arrow = source.indexOf('=> {', start + declaration.length);
  expect(arrow).toBeGreaterThan(start);
  const open = arrow + 3;
  const close = matchingBrace(source, open);
  return { start, open, close, text: source.slice(open + 1, close) };
}

function extractDoWhile(handlerText) {
  expect((handlerText.match(/\bdo\s*\{/g) || [])).toHaveLength(1);
  const doIndex = handlerText.search(/\bdo\s*\{/);
  const open = handlerText.indexOf('{', doIndex);
  const close = matchingBrace(handlerText, open);
  const tail = handlerText.slice(close + 1);
  const conditionMatch = tail.match(/^\s*while\s*\(([^;]+)\);/);
  expect(conditionMatch).not.toBeNull();
  return {
    body: handlerText.slice(open + 1, close),
    condition: conditionMatch[1].trim(),
  };
}

function extractControlBlock(handlerText, startPattern) {
  const matches = [...handlerText.matchAll(startPattern)];
  expect(matches).toHaveLength(1);
  const start = matches[0].index;
  const open = handlerText.indexOf('{', start);
  expect(open).toBeGreaterThanOrEqual(start);
  const close = matchingBrace(handlerText, open);
  return handlerText.slice(open + 1, close);
}

function expectOrdered(source, anchors) {
  let previous = -1;
  for (const anchor of anchors) {
    expect(occurrences(source, anchor)).toBe(1);
    const index = source.indexOf(anchor);
    expect(index).toBeGreaterThan(previous);
    previous = index;
  }
}

function replaceOnce(source, before, after) {
  expect(occurrences(source, before)).toBe(1);
  return source.replace(before, after);
}

function mutateHandler(source, declaration, mutate) {
  const handler = extractHandler(source, declaration);
  const mutatedBody = mutate(handler.text);
  expect(mutatedBody).not.toBe(handler.text);
  return source.slice(0, handler.open + 1) + mutatedBody + source.slice(handler.close);
}

function auditEmptyPageContinuation(handlerText, collectionName) {
  const loop = extractDoWhile(handlerText);
  expect(loop.condition).toBe(`${collectionName}.length === 0 && pagination.page < pagination.totalPages`);
  expectOrdered(loop.body, [
    "const result = await getHistory({ page: nextPage, limit: PAGE_LIMIT, sort: 'newest' });",
    `${collectionName} = ${collectionName}.concat(result.cookHistory);`,
    'pagination = result.pagination;',
    'nextPage = pagination.page + 1;',
  ]);
  expect(loop.body).not.toMatch(/nextPage\s*=\s*pagination\.page\s*;/);
  return loop;
}

function auditLoadMoreControlFlow(loadMore) {
  const loop = auditEmptyPageContinuation(loadMore, 'appended');
  const catchBlock = extractControlBlock(loadMore, /catch\s*\(requestError\)\s*\{/g);
  const finallyBlock = extractControlBlock(loadMore, /finally\s*\{/g);

  expectOrdered(loadMore, [
    "if (loadingMoreRef.current || phase !== 'ready' || !currentPagination) return;",
    'loadingMoreRef.current = true;',
    'try {',
    "const result = await getHistory({ page: nextPage, limit: PAGE_LIMIT, sort: 'newest' });",
  ]);
  expect(loadMore.indexOf('loadingMoreRef.current = true;')).toBeLessThan(loadMore.indexOf('await '));

  expect(loadMore).toMatch(/const generation = generationRef\.current;/);
  expectOrdered(loop.body, [
    "const result = await getHistory({ page: nextPage, limit: PAGE_LIMIT, sort: 'newest' });",
    'if (!mountedRef.current || generation !== generationRef.current) return;',
    'appended = appended.concat(result.cookHistory);',
  ]);
  expectOrdered(catchBlock, [
    'if (!mountedRef.current || generation !== generationRef.current) return;',
    'setLoadMoreError(historyErrorMessage(requestError));',
  ]);
  expect(finallyBlock).toMatch(/mountedRef\.current && generation === generationRef\.current/);
  expectOrdered(finallyBlock, [
    'loadingMoreRef.current = false;',
    'setLoadingMore(false);',
  ]);

  expect(catchBlock).not.toMatch(/(?:setHistory|setItems|setCookHistory)\s*\([\s\S]*?\[\s*\][\s\S]*?\)/);
  expect(catchBlock).not.toMatch(/(?:historyRef|itemsRef|cookHistoryRef)\.current\s*=\s*\[\s*\]/);

  const mergeStart = loadMore.indexOf('const merged =');
  const mergeEndAnchor = 'paginationRef.current = pagination;';
  const mergeEnd = loadMore.indexOf(mergeEndAnchor, mergeStart);
  expect(mergeStart).toBeGreaterThan(-1);
  expect(mergeEnd).toBeGreaterThan(mergeStart);
  const aggregation = loadMore.slice(mergeStart, mergeEnd + mergeEndAnchor.length);
  expect(aggregation).toMatch(/const merged = historyRef\.current\.concat\(appended\);/);
  expect(aggregation).toMatch(/historyRef\.current = merged;/);
  expect(aggregation).toMatch(/setHistory\(merged\);/);
  expect(aggregation).not.toMatch(/\brecipe\b/);
  expect(aggregation).not.toMatch(/\b(?:reduce|filter|findIndex)\s*\(|new\s+(?:Map|Set)\s*\(|Object\.(?:fromEntries|groupBy)\s*\(/);
}

function auditHistorySource(input) {
  const source = stripComments(input);
  const firstPage = extractHandler(source, 'const loadFirstPage = useCallback(async');
  const loadMore = extractHandler(source, 'const loadMore = useCallback(async');

  expect(source).toMatch(/import \{ getHistory \} from '\.\.\/api\/cookHistoryService'/);
  expect(source).toMatch(/keyExtractor=\{\(item\) => item\.id\}/);
  expect(source).not.toMatch(/keyExtractor=\{\(item\) => item\.recipe\.id\}/);

  expect(source).toMatch(/item\.recipe\.title/);
  expect(source).toMatch(/item\.recipe\.imageUrl/);
  expect(source).toMatch(/recipe\.region/);
  expect(source).toMatch(/recipe\.category/);
  expect(source).toMatch(/recipe\.difficulty/);
  expect(source).toMatch(/recipe\.prepTimeMinutes/);
  expect(source).toMatch(/recipe\.cookTimeMinutes/);
  expect(source).toMatch(/item\.servings/);
  expect(source).toMatch(/formatCompletedAt\(item\.completedAt\)/);
  expect(source).not.toMatch(/Date\.now\(|new Date\(\)/);

  expect(source).toMatch(/navigation\.navigate\('RecipeDetail',\s*\{\s*recipeSource: 'api',\s*recipeId: item\.recipe\.id,?\s*\}\)/);
  expect(source).not.toMatch(/recipe:\s*item\.recipe|initialRecipe|mockRecipe/);

  auditEmptyPageContinuation(firstPage.text, 'accumulated');
  auditLoadMoreControlFlow(loadMore.text);
  expect(source).not.toMatch(/\.length\s*===?\s*PAGE_LIMIT|\.length\s*===?\s*limit/);

  expect(firstPage.text).toMatch(/const generation = \+\+generationRef\.current/);
  expect(firstPage.text).toMatch(/generation !== generationRef\.current/);
  expect(firstPage.text).toMatch(/firstPageGenerationRef/);

  expect(source).toMatch(/phase === 'loading'/);
  expect(source).toMatch(/phase === 'error'/);
  expect(source).toMatch(/No cooking history yet/);
  expect(source).toMatch(/Retry loading cooking history/);
  expect(source).toMatch(/Retry loading more cooking history/);
  expect(source).toMatch(/RefreshControl/);
  expect(source).toMatch(/title="Cooking History"/);
  expect(source).toMatch(/history\.length > 0/);
  expect(source).toMatch(/accessibilityRole="header">\s*\{history\.length\}.*loaded/s);
  expect(source).not.toMatch(/\{paginationRef\.current\?\.total\}.*dishes/s);
  expect(source).toMatch(/weekday: 'short'/);
  expect(source).toMatch(/hour: 'numeric'/);
  expect(source).toMatch(/image: \{ width: 52, height: 52/);
  expect(source).toMatch(/accessibilityLabel=\{`\$\{item\.recipe\.title\}, cooked \$\{completedDate\}`\}/);

  expect(source).not.toMatch(/AsyncStorage|SecureStore|Date\.now|generated.*id|seed|fixture|mockData/i);
}

describe('CookingHistoryScreen binds the server-authoritative history contract', () => {
  it('keeps normal-sized metadata and completion dates at AA contrast on both paper palettes', () => {
    expect(raw).toMatch(/meta: \{[^}]*color: colors\.inkSoft[^}]*\}/);
    expect(raw).toMatch(/date: \{[^}]*color: colors\.inkSoft[^}]*\}/);
    for (const palette of [lightColors, darkColors]) {
      expect(contrastRatio(palette.inkSoft, palette.paper)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('passes the complete production structural audit', () => {
    auditHistorySource(raw);
  });

  it('uses the event id key and rejects a recipe-id replacement', () => {
    const mutated = replaceOnce(raw, 'keyExtractor={(item) => item.id}', 'keyExtractor={(item) => item.recipe.id}');
    expect(() => auditHistorySource(mutated)).toThrow();
  });

  it('uses only completedAt and rejects a client-time replacement', () => {
    const mutated = replaceOnce(raw, 'formatCompletedAt(item.completedAt)', 'formatCompletedAt(Date.now())');
    expect(() => auditHistorySource(mutated)).toThrow();
  });
});

describe('required control-flow mutation counterexamples', () => {
  it('A rejects an empty-page continuation that requests the same page again', () => {
    const mutated = mutateHandler(raw, 'const loadFirstPage = useCallback(async', (handler) =>
      replaceOnce(handler, 'nextPage = pagination.page + 1;', 'nextPage = pagination.page;')
    );
    expect(() => auditHistorySource(mutated)).toThrow();
  });

  it('B rejects load-more success handling without its stale-generation guard', () => {
    const mutated = mutateHandler(raw, 'const loadMore = useCallback(async', (handler) =>
      replaceOnce(
        handler,
        'if (!mountedRef.current || generation !== generationRef.current) return;\n        appended = appended.concat(result.cookHistory);',
        'appended = appended.concat(result.cookHistory);'
      )
    );
    expect(() => auditHistorySource(mutated)).toThrow();
  });

  it('C rejects a later-page error path that clears already-loaded rows', () => {
    const mutated = mutateHandler(raw, 'const loadMore = useCallback(async', (handler) =>
      replaceOnce(
        handler,
        'setLoadMoreError(historyErrorMessage(requestError));',
        'setHistory([]);\n      setLoadMoreError(historyErrorMessage(requestError));'
      )
    );
    expect(() => auditHistorySource(mutated)).toThrow();
  });

  it('D rejects alternate recipe-id deduplication introduced with reduce', () => {
    const mutated = mutateHandler(raw, 'const loadMore = useCallback(async', (handler) =>
      replaceOnce(
        handler,
        'const merged = historyRef.current.concat(appended);',
        'const merged = historyRef.current.concat(appended).reduce((events, item) => '
          + 'events.some((event) => event.recipe.id === item.recipe.id) ? events : events.concat(item), []);'
      )
    );
    expect(() => auditHistorySource(mutated)).toThrow();
  });

  it('E rejects loadingMoreRef acquisition moved after the first await', () => {
    const request = "const result = await getHistory({ page: nextPage, limit: PAGE_LIMIT, sort: 'newest' });";
    const mutated = mutateHandler(raw, 'const loadMore = useCallback(async', (handler) => {
      const withoutAcquisition = replaceOnce(handler, 'loadingMoreRef.current = true;', '');
      return replaceOnce(withoutAcquisition, request, `${request}\n        loadingMoreRef.current = true;`);
    });
    expect(() => auditHistorySource(mutated)).toThrow();
  });
});

describe('empty-page behavior counterexamples', () => {
  it('continues from an empty non-final page and stops at the server final page', () => {
    for (const [declaration, collectionName] of [
      ['const loadFirstPage = useCallback(async', 'accumulated'],
      ['const loadMore = useCallback(async', 'appended'],
    ]) {
      const handler = extractHandler(stripComments(raw), declaration);
      const { condition } = extractDoWhile(handler.text);
      const shouldContinue = new Function(collectionName, 'pagination', `return (${condition});`);
      expect(shouldContinue([], { page: 1, totalPages: 3 })).toBe(true);
      expect(shouldContinue([], { page: 3, totalPages: 3 })).toBe(false);
      expect(shouldContinue([{ id: 'event' }], { page: 1, totalPages: 3 })).toBe(false);
    }
  });

  it('rejects treating any empty page as final regardless of totalPages', () => {
    const mutated = raw.replace(/ && pagination\.page < pagination\.totalPages/g, '');
    expect(mutated).not.toBe(raw);
    expect(() => auditHistorySource(mutated)).toThrow();
  });

  it('rejects item-count-as-limit has-more logic', () => {
    const mutated = raw.replace(/pagination\.page < pagination\.totalPages/g, 'appended.length === PAGE_LIMIT');
    expect(mutated).not.toBe(raw);
    expect(() => auditHistorySource(mutated)).toThrow();
  });
});
