import React from 'react';
import { View, Pressable, StyleSheet, Animated } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';
import { useTabBar } from './TabBarContext';
import { tapLight } from '../utils/haptics';

// A floating pill that follows the app's Light/Dark setting. Icons only; the
// active route gets a soft sage lozenge. The chef-hat in the middle is a
// shortcut to Ask the Chef, not a tab route.
const ITEMS = [
  { key: 'Home', icon: 'home', iconOutline: 'home-outline' },
  { key: 'Community', icon: 'people', iconOutline: 'people-outline' },
  { key: 'chef', mci: 'chef-hat' },
  { key: 'Swaps', icon: 'swap-horizontal', iconOutline: 'swap-horizontal' },
  { key: 'Profile', icon: 'person', iconOutline: 'person-outline' },
];

export default function TabBar({ state, navigation }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { collapsed } = useTabBar() || {};
  const activeKey = state.routeNames[state.index];

  const c = collapsed || new Animated.Value(0);
  // Scroll-down shrinks the pill but never hides it — it stays reachable.
  const animStyle = {
    opacity: c.interpolate({ inputRange: [0, 1], outputRange: [1, 0.92] }),
    transform: [
      { translateY: c.interpolate({ inputRange: [0, 1], outputRange: [0, 6] }) },
      { scale: c.interpolate({ inputRange: [0, 1], outputRange: [1, 0.86] }) },
    ],
  };

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 8) + 4 }]} pointerEvents="box-none">
      <Animated.View style={[styles.pill, animStyle]}>
        {ITEMS.map((it) => {
          if (it.key === 'chef') {
            return (
              <Pressable
                key="chef"
                style={styles.item}
                hitSlop={6}
                onPress={() => {
                  tapLight();
                  navigation.navigate('Assistant');
                }}
                accessibilityRole="button"
                accessibilityLabel="Ask the Chef"
              >
                <MaterialCommunityIcons name="chef-hat" size={23} color={colors.ink} />
              </Pressable>
            );
          }
          const focused = it.key === activeKey;
          return (
            <Pressable
              key={it.key}
              style={[styles.item, focused && styles.itemActive]}
              hitSlop={6}
              onPress={() => {
                if (!focused) tapLight();
                navigation.navigate(it.key);
              }}
              accessibilityRole="button"
              accessibilityLabel={it.key}
              accessibilityState={{ selected: focused }}
            >
              <Ionicons
                name={focused ? it.icon : it.iconOutline}
                size={22}
                color={focused ? colors.sageDeep : colors.inkFaint}
              />
            </Pressable>
          );
        })}
      </Animated.View>
    </View>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    wrap: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: 'center',
    },
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.paper,
      borderRadius: 34,
      paddingHorizontal: 8,
      paddingVertical: 9,
      borderWidth: 1,
      borderColor: colors.hairline,
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 1,
      shadowRadius: 20,
      elevation: 10,
    },
    item: {
      minWidth: 50,
      height: 40,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
    },
    itemActive: {
      backgroundColor: colors.sagePale,
      paddingHorizontal: 14,
    },
  });
}
