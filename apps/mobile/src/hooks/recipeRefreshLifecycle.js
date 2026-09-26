export function shouldRefreshForAppState(previousState, nextState) {
  return previousState !== 'active' && nextState === 'active';
}

export function createRecipeRefreshLifecycle({
  initialAppState = 'active',
  refresh,
  now = Date.now,
  pairedSignalWindowMs = 250,
}) {
  let refreshCurrent = refresh;
  let focused = false;
  let hasFocused = false;
  let appState = initialAppState || 'active';
  let lastRefresh = null;

  const trigger = (reason) => {
    const at = now();
    if (lastRefresh && lastRefresh.reason !== reason && at - lastRefresh.at < pairedSignalWindowMs) return;
    lastRefresh = { at, reason };
    refreshCurrent(reason);
  };

  return {
    setRefresh(nextRefresh) {
      refreshCurrent = nextRefresh;
    },
    focus() {
      focused = true;
      if (hasFocused) trigger('focus');
      hasFocused = true;
    },
    blur() {
      focused = false;
    },
    appStateChanged(nextState) {
      const previousState = appState;
      appState = nextState;
      if (focused && shouldRefreshForAppState(previousState, nextState)) trigger('foreground');
    },
  };
}

export function subscribeToRecipeAppState(appState, lifecycle) {
  const subscription = appState.addEventListener('change', (nextState) => {
    lifecycle.appStateChanged(nextState);
  });
  return () => subscription.remove();
}
