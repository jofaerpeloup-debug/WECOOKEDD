import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  createRecipeRefreshLifecycle, subscribeToRecipeAppState,
} from './recipeRefreshLifecycle';

// Recipe screens already own their request state and stale-response guards.
// This hook only supplies lifecycle refresh signals; it is not a cache or an
// event bus. The initial focus is skipped because each caller already performs
// its normal initial/query-driven load.
export default function useRecipeScreenRefresh(refresh) {
  const lifecycleRef = useRef(null);
  if (!lifecycleRef.current) {
    // AppState may briefly report null during native startup. The lifecycle
    // helper treats that as active so the first resolved active event does not
    // duplicate the caller's mount load.
    lifecycleRef.current = createRecipeRefreshLifecycle({
      initialAppState: AppState.currentState || 'active',
      refresh,
    });
  }
  lifecycleRef.current.setRefresh(refresh);

  useFocusEffect(
    useCallback(() => {
      lifecycleRef.current.focus();
      return () => lifecycleRef.current.blur();
    }, [])
  );

  useEffect(() => subscribeToRecipeAppState(AppState, lifecycleRef.current), []);
}
