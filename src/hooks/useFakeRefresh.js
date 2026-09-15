import { useCallback, useState } from 'react';
import { tapLight } from '../utils/haptics';

// This app's data is all local mock state (no backend to actually re-fetch
// from), so "pull to refresh" is a deliberately brief, honest-feeling no-op
// spinner — it satisfies the gesture without pretending to sync anything.
export default function useFakeRefresh(delay = 600) {
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(() => {
    tapLight();
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), delay);
  }, [delay]);

  return { refreshing, onRefresh };
}
