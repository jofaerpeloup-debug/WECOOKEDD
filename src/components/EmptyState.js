import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';

// Shared "there's nothing here yet" panel — a soft icon, a line or two of
// copy, and an optional call-to-action. Used by lists and search results.
export default function EmptyState({
  icon = 'sparkles-outline',
  title,
  message,
  actionLabel,
  onAction,
  style,
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <View style={[styles.root, style]}>
      <View style={styles.iconWrap}>
        <Ionicons name={icon} size={22} color={colors.sageDeep} />
      </View>
      {!!title && <Text style={styles.title}>{title}</Text>}
      {!!message && <Text style={styles.message}>{message}</Text>}
      {!!actionLabel && !!onAction && (
        <Pressable style={styles.btn} onPress={onAction} hitSlop={6}>
          <Text style={styles.btnText}>{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    root: { alignItems: 'center', paddingVertical: spacing.xxl, paddingHorizontal: spacing.xl },
    iconWrap: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: colors.sagePale,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.md,
    },
    title: {
      fontFamily: typography.display.fontFamily,
      fontSize: 17,
      color: colors.ink,
      textAlign: 'center',
      marginBottom: spacing.xs,
    },
    message: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.inkSoft,
      textAlign: 'center',
      lineHeight: 19,
      maxWidth: 280,
    },
    btn: {
      marginTop: spacing.lg,
      backgroundColor: colors.sageDeep,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.sm,
    },
    btnText: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.sm,
      color: colors.onAccent,
    },
  });
}
