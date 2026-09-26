const {
  createRecipeRefreshLifecycle,
  shouldRefreshForAppState,
  subscribeToRecipeAppState,
} = require('../src/hooks/recipeRefreshLifecycle');
const {
  classifyRecipeDetailFailure,
  recipeCollectionPhaseAfterFailure,
  shouldBlockRecipeFailure,
} = require('../src/utils/recipeFreshnessState');

describe('recipe lifecycle freshness', () => {
  it('recognizes only a transition back to the active app state', () => {
    expect(shouldRefreshForAppState('background', 'active')).toBe(true);
    expect(shouldRefreshForAppState('inactive', 'active')).toBe(true);
    expect(shouldRefreshForAppState('active', 'active')).toBe(false);
    expect(shouldRefreshForAppState('active', 'background')).toBe(false);
  });

  it('does not double-fetch on initial focus and refreshes on a later focus', () => {
    const refresh = jest.fn();
    const lifecycle = createRecipeRefreshLifecycle({ refresh, now: () => 1000 });

    lifecycle.focus();
    expect(refresh).not.toHaveBeenCalled();

    lifecycle.blur();
    lifecycle.focus();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenLastCalledWith('focus');
  });

  it('refreshes on foreground while focused', () => {
    const refresh = jest.fn();
    const lifecycle = createRecipeRefreshLifecycle({ initialAppState: 'active', refresh, now: () => 1000 });
    lifecycle.focus();

    lifecycle.appStateChanged('background');
    lifecycle.appStateChanged('active');

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith('foreground');
  });

  it('does not refresh on foreground while unfocused', () => {
    const refresh = jest.fn();
    const lifecycle = createRecipeRefreshLifecycle({ initialAppState: 'active', refresh });
    lifecycle.focus();
    lifecycle.blur();
    lifecycle.appStateChanged('background');
    lifecycle.appStateChanged('active');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('removes the AppState listener during cleanup', () => {
    const remove = jest.fn();
    let listener;
    const appState = {
      addEventListener: jest.fn((_event, callback) => {
        listener = callback;
        return { remove };
      }),
    };
    const lifecycle = { appStateChanged: jest.fn() };

    const cleanup = subscribeToRecipeAppState(appState, lifecycle);
    listener('background');
    cleanup();

    expect(appState.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    expect(lifecycle.appStateChanged).toHaveBeenCalledWith('background');
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('Dashboard preserves latest recipes and search results after background failures', () => {
    const latest = [{ id: 'latest-1' }];
    const results = [{ id: 'search-1' }];
    expect(shouldBlockRecipeFailure(new Error('offline'), latest, { background: true })).toBe(false);
    expect(shouldBlockRecipeFailure(new Error('offline'), results, { background: true })).toBe(false);
    expect(latest).toEqual([{ id: 'latest-1' }]);
    expect(results).toEqual([{ id: 'search-1' }]);
    expect(shouldBlockRecipeFailure(null, latest, { background: true })).toBe(false);
  });

  it('Dashboard initial failure still uses the blocking error state', () => {
    expect(shouldBlockRecipeFailure(new Error('offline'), [], { background: true })).toBe(true);
  });

  it('Discover preserves rows and ready phase after a refresh failure', () => {
    const rows = [{ id: 'recipe-1' }];
    expect(recipeCollectionPhaseAfterFailure(rows, { background: true })).toBe('ready');
    expect(rows).toEqual([{ id: 'recipe-1' }]);
    expect(recipeCollectionPhaseAfterFailure([], { background: false })).toBe('error');
  });

  it('Detail preserves valid content after a normal refresh failure', () => {
    expect(classifyRecipeDetailFailure(new Error('offline'), true)).toBe('preserve');
  });

  it('Detail treats RECIPE_NOT_FOUND as unavailable even with valid content', () => {
    expect(classifyRecipeDetailFailure({ code: 'RECIPE_NOT_FOUND' }, true)).toBe('unavailable');
    expect(classifyRecipeDetailFailure({ isNotFound: true }, true)).toBe('unavailable');
  });
});
