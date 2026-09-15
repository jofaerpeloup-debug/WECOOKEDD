import React, { useRef, useEffect } from 'react';
import { Animated } from 'react-native';

// Fades + lifts its children in once, on mount. Cheap polish for list rows and
// cards. Native-driven, so it stays smooth while the list scrolls.
export default function FadeInView({ children, delay = 0, offset = 10, duration = 260, style }) {
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.timing(t, {
      toValue: 1,
      duration,
      delay,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [t, delay, duration]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: t,
          transform: [
            { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [offset, 0] }) },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
