import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';

const DELETE_WIDTH = 76;
const HORIZONTAL_ACTIVATION = 12;

export default function SwipeToDelete({ children, itemName, disabled, onDelete, testID }) {
  const { colors } = useTheme();
  const [translateX, setTranslateX] = useState(0);
  const [actionVisible, setActionVisible] = useState(false);
  const translateRef = useRef(0);
  const startRef = useRef(0);

  const setOffset = (value) => {
    const next = Math.max(-DELETE_WIDTH, Math.min(0, value));
    translateRef.current = next;
    setTranslateX(next);
  };

  const close = () => {
    setOffset(0);
    setActionVisible(false);
  };

  useEffect(() => {
    if (disabled) close();
  }, [disabled]);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_event, gesture) => {
      if (disabled) return false;
      const horizontal = Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5;
      const opening = gesture.dx < -HORIZONTAL_ACTIVATION;
      const closing = translateRef.current < 0 && gesture.dx > HORIZONTAL_ACTIVATION;
      return horizontal && (opening || closing);
    },
    onPanResponderGrant: () => {
      startRef.current = translateRef.current;
      setActionVisible(true);
    },
    onPanResponderMove: (_event, gesture) => {
      setOffset(startRef.current + gesture.dx);
    },
    onPanResponderRelease: (_event, gesture) => {
      const reveal = translateRef.current <= -(DELETE_WIDTH / 2) || gesture.vx < -0.5;
      setOffset(reveal ? -DELETE_WIDTH : 0);
      setActionVisible(reveal);
    },
    onPanResponderTerminate: close,
    onPanResponderTerminationRequest: () => false,
  }), [disabled]);

  const activateDelete = () => {
    if (disabled) return;
    close();
    onDelete();
  };

  return (
    <View style={styles.clip}>
      {actionVisible ? (
        <View style={[styles.actionWrap, { backgroundColor: colors.error }]}>
          <Pressable
            style={styles.action}
            onPress={activateDelete}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={`Delete ${itemName}`}
            accessibilityState={{ disabled }}
          >
            <Ionicons name="trash-outline" size={18} color="#FFFFFF" />
          </Pressable>
        </View>
      ) : null}
      <View
        {...panResponder.panHandlers}
        testID={testID}
        style={[styles.foreground, { transform: [{ translateX }] }]}
      >
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  actionWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  action: {
    width: DELETE_WIDTH,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
  foreground: { backgroundColor: 'transparent' },
});
