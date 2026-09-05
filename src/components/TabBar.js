import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { typography, spacing } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import PlusMenu from './PlusMenu';

const TABS = [
  { key: 'Home', label: 'Home', icon: 'home', iconOutline: 'home-outline' },
  { key: 'Community', label: 'Community', icon: 'people', iconOutline: 'people-outline' },
  { key: 'Swaps', label: 'Swaps', icon: 'swap-horizontal', iconOutline: 'swap-horizontal' },
  { key: 'Profile', label: 'Profile', icon: 'person', iconOutline: 'person-outline' },
];

export default function TabBar({ state, navigation }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors);
  const activeKey = state.routeNames[state.index];
  const [menuOpen, setMenuOpen] = useState(false);

  // Left two tabs, then the raised "+", then right two tabs.
  const left = TABS.slice(0, 2);
  const right = TABS.slice(2);

  const renderTab = (tab) => {
    const focused = tab.key === activeKey;
    return (
      <Pressable
        key={tab.key}
        style={styles.tab}
        hitSlop={6}
        onPress={() => navigation.navigate(tab.key)}
      >
        <Ionicons
          name={focused ? tab.icon : tab.iconOutline}
          size={20}
          color={focused ? colors.sageDeep : colors.inkFaint}
        />
        <Text style={[styles.label, focused && styles.labelActive]}>{tab.label}</Text>
      </Pressable>
    );
  };

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      {left.map(renderTab)}
      <Pressable
        style={styles.plus}
        onPress={() => setMenuOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Quick actions"
      >
        <MaterialCommunityIcons name="chef-hat" size={22} color={colors.onAccent} />
      </Pressable>
      {right.map(renderTab)}

      <PlusMenu visible={menuOpen} onClose={() => setMenuOpen(false)} navigation={navigation} />
    </View>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    wrap: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-around',
      backgroundColor: colors.cream,
      borderTopWidth: 1,
      borderTopColor: colors.hairline,
      paddingTop: spacing.sm,
      paddingHorizontal: spacing.md,
    },
    tab: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 2 },
    label: {
      fontFamily: typography.body.semibold,
      fontSize: 10.5,
      color: colors.inkFaint,
    },
    labelActive: { color: colors.sageDeep },
    plus: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: colors.sageDeep,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: -22,
      marginHorizontal: 4,
      shadowColor: colors.sageDeep,
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.4,
      shadowRadius: 16,
      elevation: 6,
    },
  });
}
