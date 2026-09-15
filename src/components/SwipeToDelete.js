import React, { useRef, useState } from 'react';
import { Animated, PanResponder, StyleSheet, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { tapLight } from '../utils/haptics';

const REVEAL = 76;
const THRESHOLD = 36;

// Swipe-left-to-reveal-delete for list rows. Built on plain Animated +
// PanResponder (no gesture-handler/reanimated dep) since this project keeps
// to RN's built-ins where a native module isn't already pulled in.
export default function SwipeToDelete({ children, onDelete, disabled, style }) {
  const { colors } = useTheme();
  const translateX = useRef(new Animated.Value(0)).current;
  const openRef = useRef(false);
  const [open, setOpen] = useState(false);

  const close = () => {
    openRef.current = false;
    setOpen(false);
    Animated.spring(translateX, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
  };
  const reveal = () => {
    openRef.current = true;
    setOpen(true);
    Animated.spring(translateX, { toValue: -REVEAL, useNativeDriver: true, bounciness: 0 }).start();
  };

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        !disabled && Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderMove: (_, g) => {
        const base = openRef.current ? -REVEAL : 0;
        const next = Math.max(-REVEAL, Math.min(0, base + g.dx));
        translateX.setValue(next);
      },
      onPanResponderRelease: (_, g) => {
        const base = openRef.current ? -REVEAL : 0;
        const finalX = base + g.dx;
        if (finalX < -THRESHOLD) reveal();
        else close();
      },
    })
  ).current;

  return (
    <View style={[styles.wrap, style]}>
      <Pressable
        style={[styles.action, { backgroundColor: colors.error }]}
        onPress={() => {
          tapLight();
          close();
          onDelete && onDelete();
        }}
        accessibilityRole="button"
        accessibilityLabel="Delete"
      >
        <Ionicons name="trash-outline" size={18} color="#fff" />
      </Pressable>
      <Animated.View style={{ transform: [{ translateX }] }} {...pan.panHandlers}>
        {children}
        {open && <Pressable style={StyleSheet.absoluteFill} onPress={close} />}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden' },
  action: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: REVEAL,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
