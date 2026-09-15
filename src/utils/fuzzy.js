// Lightweight fuzzy text matching for search — no dependency.
// fuzzyScore() returns 0 for no match, or a positive number (bigger = better),
// so callers can both filter (score > 0) and rank (sort by score).

function normalize(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents: "adóbo" -> "adobo"
    .trim();
}

// Levenshtein edit distance, bailing out early once it exceeds `max`.
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowBest = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      if (cur[j] < rowBest) rowBest = cur[j];
    }
    if (rowBest > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

// How well does `query` match `text`? 0 = not at all.
export function fuzzyScore(query, text) {
  const q = normalize(query);
  const t = normalize(text);
  if (!q || !t) return 0;

  // 1. Direct substring — best. A prefix beats a mid-string hit.
  const idx = t.indexOf(q);
  if (idx === 0) return 100;
  if (idx > 0) return 80 - Math.min(idx, 20);

  // 2. Per-word typo tolerance: "adbo" ~ "adobo", "tinlong" ~ "tinolang".
  const qWords = q.split(/\s+/).filter(Boolean);
  const tWords = t.split(/\s+/).filter(Boolean);
  let wordScore = 0;
  for (const qw of qWords) {
    if (qw.length < 3) continue;
    let best = 0;
    for (const tw of tWords) {
      if (tw.includes(qw)) {
        best = Math.max(best, 50);
        continue;
      }
      const tol = qw.length >= 6 ? 2 : 1;
      const d = editDistance(qw, tw, tol);
      if (d <= tol) best = Math.max(best, 40 - d * 10);
    }
    wordScore += best;
  }
  if (wordScore > 0) return Math.min(wordScore, 70);

  // 3. Subsequence — every query char appears in order somewhere. Loose, low score.
  let ti = 0;
  for (const ch of q.replace(/\s+/g, '')) {
    ti = t.indexOf(ch, ti);
    if (ti === -1) return 0;
    ti += 1;
  }
  return 15;
}

export function fuzzyIncludes(query, text) {
  return fuzzyScore(query, text) > 0;
}

// Best score of `query` against any of a recipe's searchable fields, with the
// title weighted highest.
export function recipeSearchScore(query, recipe) {
  if (!query || !query.trim()) return 1;
  const scores = [
    fuzzyScore(query, recipe.title) * 2,
    fuzzyScore(query, recipe.description || ''),
    ...(recipe.ingredients || []).map((ing) => fuzzyScore(query, ing.name) * 0.75),
    ...(recipe.tags || []).map((tag) => fuzzyScore(query, tag)),
  ];
  return Math.max(0, ...scores);
}
