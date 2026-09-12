// CookHistoryContext (M5C) — static source validation. The mobile workspace
// has no RN renderer (see jest.config.js), so the ownership-guard and
// sync invariants that matter most here (no cross-user stale Cooked count,
// Profile refreshing after a real CookMode completion, no local fake
// persistence) are encoded as source assertions, the same approach used for
// AuthContext's identity-guarded reconcileUser rule.

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const raw = read('context/CookHistoryContext.js');
const code = stripComments(raw);

describe('CookHistoryContext never leaks a previous user\'s Cooked stats', () => {
  it('derives authUserId from the real AuthContext, never a mock/local identity', () => {
    expect(raw).toMatch(/import \{ useAuth \} from '\.\/AuthContext'/);
    expect(code).toMatch(/const \{ status: authStatus, user \} = useAuth\(\)/);
  });

  it('bumps a session ref on every auth identity change and wipes prior stats before loading', () => {
    expect(code).toMatch(/const sessionRef = useRef\(0\)/);
    expect(code).toMatch(/sessionRef\.current \+= 1/);
    expect(code).toMatch(/setStats\(null\)/);
    expect(code).toMatch(/setOwnerId\(authUserId\)/);
  });

  it('only exposes stats when the loaded data belongs to the current user (ownerId === authUserId)', () => {
    expect(code).toMatch(/const trusted = !!authUserId && ownerId === authUserId/);
    expect(code).toMatch(/stats: trusted && effectiveStatus === 'ready' \? stats : null/);
  });

  it('reads as idle, never "ready", once signed out', () => {
    expect(code).toMatch(/const effectiveStatus = !authUserId \? 'idle' : trusted \? status : 'loading'/);
  });
});

describe('CookHistoryContext.recordCompletion is the real backend path', () => {
  it('calls the real cookHistoryService, never a local mutation', () => {
    expect(raw).toMatch(/import \* as cookHistoryService from '\.\.\/api\/cookHistoryService'/);
    expect(code).toMatch(/await cookHistoryService\.recordCompletion\(\{ recipeId, servings \}\)/);
  });

  it('always refetches authoritative stats from the server after a successful completion', () => {
    expect(code).toMatch(/const created = await cookHistoryService\.recordCompletion/);
    expect(code).toMatch(/await refreshStats\(\)/);
    // Never derives the new count itself (e.g. totalCooks + 1) — always a
    // fresh server read.
    expect(code).not.toMatch(/totalCooks \+ 1|uniqueRecipesCooked \+ 1/);
  });

  it('propagates a failed completion to the caller rather than swallowing it', () => {
    const fnMatch = code.match(/const recordCompletion = useCallback\(\s*async \(\{ recipeId, servings \}\) => \{([\s\S]*?)\},\s*\[refreshStats\]/);
    expect(fnMatch).toBeTruthy();
    // No try/catch inside recordCompletion itself — a rejection propagates to
    // the caller (CookModeScreen), which owns the honest error/retry UI.
    expect(fnMatch[1]).not.toMatch(/catch/);
  });
});

describe('CookHistoryContext has no local/fake persistence', () => {
  it('never touches AsyncStorage or any storage key', () => {
    expect(code).not.toMatch(/AsyncStorage|loadJSON|saveJSON|storageKey/);
  });

  it('never imports the teammate\'s mock CookedRecipesContext', () => {
    expect(code).not.toMatch(/CookedRecipesContext|useCookedRecipes/);
  });
});
