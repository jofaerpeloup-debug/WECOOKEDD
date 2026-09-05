import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { typography, spacing } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';

/**
 * Back-navigation header: back arrow · title · optional right action.
 * Used by every pushed screen (Ask the Chef, Settings, Community, …).
 * The `mode` prop is accepted for backwards compatibility but only "back"
 * behaviour exists now — the main tab screens use <TabHeader> instead.
 */
export default function TopBar({
  title,
  onBack,
  rightIcon,
  onRightPress,
  transparent = false,
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.wrap,
        { paddingTop: insets.top + spacing.sm },
        transparent && { backgroundColor: 'transparent', borderBottomWidth: 0 },
      ]}
    >
      <Pressable onPress={onBack} hitSlop={10} style={styles.side} disabled={!onBack}>
        {!!onBack && <Ionicons name="arrow-back" size={22} color={colors.ink} />}
      </Pressable>
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      <Pressable onPress={onRightPress} hitSlop={10} style={styles.side} disabled={!rightIcon}>
        {rightIcon && <Ionicons name={rightIcon} size={20} color={colors.ink} />}
      </Pressable>
    </View>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    wrap: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.cream,
      paddingBottom: spacing.md,
      paddingHorizontal: spacing.lg,
      borderBottomWidth: 1,
      borderBottomColor: colors.hairline,
    },
    side: { width: 34, alignItems: 'center' },
    title: {
      fontFamily: typography.display.fontFamily,
      fontSize: 19,
      color: colors.ink,
      flex: 1,
      textAlign: 'center',
    },
  });
}
