import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { typography, spacing } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';

const TABS = [
  { key: 'Home', label: 'Home', icon: 'home', iconOutline: 'home-outline' },
  { key: 'Discover', label: 'Explore', icon: 'compass', iconOutline: 'compass-outline' },
  { key: 'Assistant', label: '', icon: 'add', iconOutline: 'add' },
  { key: 'Saved', label: 'Favorites', icon: 'heart', iconOutline: 'heart-outline' },
  { key: 'Profile', label: 'Profile', icon: 'person', iconOutline: 'person-outline' },
];

export default function TabBar({ state, navigation }) {
  const { colors, shadow } = useTheme();
  const styles = makeStyles(colors, shadow);
  const insets = useSafeAreaInsets();
  const activeIndex = state.index;

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      {TABS.map((tab, i) => {
        const focused = i === activeIndex;
        const isCenter = tab.key === 'Assistant';
        return (
          <Pressable
            key={tab.key}
            onPress={() => navigation.navigate(tab.key)}
            style={styles.tab}
            hitSlop={6}
          >
            {isCenter ? (
              <View style={styles.centerIcon}>
                <Ionicons name="add" size={26} color={colors.onAccent} />
              </View>
            ) : (
              <>
                <Ionicons
                  name={focused ? tab.icon : tab.iconOutline}
                  size={21}
                  color={focused ? colors.sageDeep : colors.inkFaint}
                />
                <Text style={[styles.label, focused && styles.labelActive]}>{tab.label}</Text>
              </>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

function makeStyles(colors, shadow) {
  return StyleSheet.create({
    wrap: {
      flexDirection: 'row',
      backgroundColor: colors.paper,
      borderTopWidth: 1,
      borderTopColor: colors.hairline,
      paddingTop: spacing.sm,
      paddingHorizontal: spacing.sm,
    },
    tab: {
      flex: 1,
      alignItems: 'center',
      gap: 4,
    },
    centerIcon: {
      width: 46,
      height: 46,
      borderRadius: 23,
      backgroundColor: colors.sageDeep,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: -26,
      borderWidth: 4,
      borderColor: colors.paper,
      ...shadow.card,
    },
    label: {
      fontFamily: typography.body.medium,
      fontSize: 10,
      color: colors.inkFaint,
    },
    labelActive: {
      color: colors.sageDeep,
      fontFamily: typography.body.semibold,
    },
  });
}
