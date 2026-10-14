import React, { useEffect, useRef, useState } from 'react';
import { View, Pressable, StyleSheet, Keyboard, Animated } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import {
  TAB_BAR_ITEM_HEIGHT,
  TAB_BAR_PILL_BORDER,
  TAB_BAR_PILL_VERTICAL_PADDING,
  tabBarBottomOffset,
} from '../navigation/tabBarLayout';
import PlusMenu from './PlusMenu';

// UI-FINAL1 pill appearance follows WECOOKEDD @ 4ffd47d (src/components/TabBar.js).
// The transparent absolute wrapper overlays every tab screen; each tab's scroll
// container uses the same geometry below to keep its final controls reachable.
//
// Visual layout: [Home] [Community] [chef] [Swaps] [Profile]
//   - four real tabs (see MainTabs.js), two on each side
//   - the centre chef icon is a Pressable, NOT a tab route: it opens <PlusMenu>
//
// `name` is the REGISTERED route name and must match a <Tab.Screen name> in
// MainTabs.js exactly — navigation targets route names, never React Navigation
// `state.routes[].key` instance keys. Active state is derived the same way,
// from `state.routeNames` (registered names), not from a route object.
const TABS = [
  { name: 'Home', label: 'Home', icon: 'home', iconOutline: 'home-outline' },
  { name: 'Community', label: 'Community', icon: 'people', iconOutline: 'people-outline' },
  { name: 'Swaps', label: 'Swaps', icon: 'swap-horizontal', iconOutline: 'swap-horizontal' },
  { name: 'Profile', label: 'Profile', icon: 'person', iconOutline: 'person-outline' },
];

export default function TabBar({ state, navigation }) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors);
  const activeRouteName = state.routeNames[state.index];
  const [menuOpen, setMenuOpen] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const tabScale = useRef(new Animated.Value(1)).current;

  // React Navigation's built-in keyboard option is implemented by its default
  // bar. This custom bar owns the same behavior on both iOS and Android.
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hidden = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  useEffect(() => {
    const transition = Animated.sequence([
      Animated.timing(tabScale, { toValue: 0.98, duration: 90, useNativeDriver: true }),
      Animated.timing(tabScale, { toValue: 1, duration: 110, useNativeDriver: true }),
    ]);
    transition.start();
    return () => transition.stop();
  }, [activeRouteName, tabScale]);

  // Left two tabs, the chef action, then right two tabs.
  const left = TABS.slice(0, 2);
  const right = TABS.slice(2);

  const renderTab = (tab) => {
    const focused = tab.name === activeRouteName;
    return (
      <Pressable
        key={tab.name}
        style={[styles.tab, focused && styles.tabActive]}
        hitSlop={6}
        onPress={() => navigation.navigate(tab.name)}
        accessibilityRole="tab"
        accessibilityLabel={tab.label}
        accessibilityState={{ selected: focused }}
      >
        <Ionicons
          name={focused ? tab.icon : tab.iconOutline}
          size={22}
          color={focused ? (isDark ? colors.sage : colors.sageDeep) : colors.inkFaint}
        />
      </Pressable>
    );
  };

  if (keyboardVisible) return null;

  return (
    <View style={[styles.wrap, { paddingBottom: tabBarBottomOffset(insets.bottom) }]} pointerEvents="box-none">
      <Animated.View style={[styles.pill, { transform: [{ scale: tabScale }] }]}>
        {left.map(renderTab)}
        <Pressable
          style={styles.plus}
          onPress={() => setMenuOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Quick actions"
          accessibilityHint="Opens Ask the Chef and Meal Plan"
        >
          <MaterialCommunityIcons name="chef-hat" size={23} color={colors.ink} />
        </Pressable>
        {right.map(renderTab)}
      </Animated.View>

      <PlusMenu visible={menuOpen} onClose={() => setMenuOpen(false)} navigation={navigation} />
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
      backgroundColor: 'transparent',
    },
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.paper,
      borderRadius: 34,
      borderWidth: TAB_BAR_PILL_BORDER,
      borderColor: colors.hairline,
      paddingHorizontal: 8,
      paddingVertical: TAB_BAR_PILL_VERTICAL_PADDING,
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 1,
      shadowRadius: 20,
      elevation: 10,
    },
    tab: {
      minWidth: 50,
      height: TAB_BAR_ITEM_HEIGHT,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tabActive: { backgroundColor: colors.sagePale },
    plus: {
      minWidth: 50,
      height: TAB_BAR_ITEM_HEIGHT,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
}
