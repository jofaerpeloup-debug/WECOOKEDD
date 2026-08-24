import React from 'react';
import { Pressable, Text, StyleSheet, ActivityIndicator, View } from 'react-native';
import { typography, radius, spacing } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';

/**
 * variant: 'primary' | 'secondary' | 'ghost' | 'outline'
 * size: 'md' | 'lg'
 */
export default function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'lg',
  disabled = false,
  loading = false,
  icon = null,
  style,
  fullWidth = true,
}) {
  const { colors } = useTheme();
  const isPrimary = variant === 'primary';
  const styles = makeStyles(colors);
  const variantStyles = makeVariantStyles(colors);

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.base,
        size === 'lg' ? styles.lg : styles.md,
        variantStyles[variant],
        fullWidth && { alignSelf: 'stretch' },
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isPrimary ? colors.onAccent : colors.sageDeep} />
      ) : (
        <View style={styles.content}>
          {icon}
          <Text
            style={[
              styles.text,
              variant === 'primary' && { color: colors.onAccent },
              variant === 'secondary' && { color: colors.sageDeep },
              variant === 'outline' && { color: colors.ink },
              variant === 'ghost' && { color: colors.sageDeep },
            ]}
          >
            {title}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

function makeVariantStyles(colors) {
  return StyleSheet.create({
    primary: { backgroundColor: colors.sageDeep },
    secondary: { backgroundColor: colors.sagePale },
    outline: { backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.hairline },
    ghost: { backgroundColor: 'transparent' },
  });
}

function makeStyles(colors) {
  return StyleSheet.create({
    base: {
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    content: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    lg: { paddingVertical: 16, paddingHorizontal: spacing.xl },
    md: { paddingVertical: 12, paddingHorizontal: spacing.lg },
    text: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.md,
    },
    pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
    disabled: { opacity: 0.5 },
  });
}
