import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import TopBar from '../components/TopBar';

// Deliberate placeholder (M2 navigation-shell slice).
//
// The teammate PlusMenu's "Meal Plan" action is preserved verbatim, so the
// `MealPlan` route must exist and resolve to a real screen. The teammate Meal
// Plan feature (MealPlanScreen + MealPlanContext + MealPlanSheet +
// TimePickerSheet, all mockData-backed) is a SEPARATE later milestone and is
// intentionally NOT ported here.
//
// This screen only confirms the destination exists and states, honestly, that
// meal planning is not built yet. No mockData, no fake plans, no fake recipe
// arrays, no persistence, no context — nothing to migrate later, just delete
// and replace with the real screen.
export default function MealPlanScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  return (
    <View style={styles.root}>
      <TopBar mode="back" title="Meal Plan" onBack={() => navigation.goBack()} />

      <View style={styles.body}>
        <View style={styles.iconWrap}>
          <Ionicons name="calendar-outline" size={30} color={colors.sageDeep} />
        </View>
        <Text style={styles.title}>Meal planning is on the way</Text>
        <Text style={styles.sub}>
          Weekly meal plans and auto-built grocery lists aren&rsquo;t available yet. This feature
          arrives in a future update.
        </Text>
      </View>
    </View>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    body: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.xxl,
      gap: spacing.md,
    },
    iconWrap: {
      width: 64,
      height: 64,
      borderRadius: radius.pill,
      backgroundColor: colors.sagePale,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.xs,
    },
    title: {
      fontFamily: typography.display.fontFamily,
      fontSize: typography.sizes.xl,
      color: colors.ink,
      textAlign: 'center',
    },
    sub: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.base,
      lineHeight: 21,
      color: colors.inkSoft,
      textAlign: 'center',
    },
  });
}
