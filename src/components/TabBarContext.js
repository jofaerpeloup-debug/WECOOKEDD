import React, { createContext, useCallback, useContext, useRef } from 'react';
import { Animated } from 'react-native';

// The floating tab pill overlaps screen content, so scroll views need this much
// bottom padding to keep their last row clear of it.
export const TAB_BAR_CLEARANCE = 116;

const TabBarContext = createContext(null);

// Shared 0→1 "collapsed" value: 0 = pill fully shown, 1 = shrunk away.
// The tab bar reads it; the tab screens drive it from their scroll position.
export function TabBarProvider({ children }) {
  const collapsed = useRef(new Animated.Value(0)).current;
  const lastY = useRef(0);
  const shown = useRef(true);

  const animate = useCallback(
    (toValue) => {
      Animated.spring(collapsed, {
        toValue,
        useNativeDriver: true,
        speed: 16,
        bounciness: 3,
      }).start();
    },
    [collapsed]
  );

  const onScroll = useCallback(
    (e) => {
      const y = e.nativeEvent.contentOffset.y;
      const dy = y - lastY.current;
      lastY.current = y;

      if (y <= 6) {
        if (!shown.current) {
          shown.current = true;
          animate(0);
        }
        return;
      }
      if (dy > 8 && shown.current) {
        shown.current = false;
        animate(1);
      } else if (dy < -8 && !shown.current) {
        shown.current = true;
        animate(0);
      }
    },
    [animate]
  );

  return (
    <TabBarContext.Provider value={{ collapsed, onScroll }}>{children}</TabBarContext.Provider>
  );
}

export function useTabBar() {
  return useContext(TabBarContext);
}

// Spread onto a screen's main vertical ScrollView.
export function useTabBarScroll() {
  const ctx = useContext(TabBarContext);
  return { onScroll: ctx?.onScroll, scrollEventThrottle: 16 };
}
