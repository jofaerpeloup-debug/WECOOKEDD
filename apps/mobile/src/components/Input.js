import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  NEW_PASSWORD_ERROR_MESSAGES,
  PASSWORD_ALLOWED_SPECIAL_CHARS,
  PASSWORD_MIN_CHARS,
  validateNewPassword,
} from '@wecooked/contracts';
import { typography, radius, spacing } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';

export default function Input({
  label,
  icon,
  secureTextEntry,
  rightAction,
  onRightActionPress,
  error,
  helperText,
  required = false,
  onFocus,
  onBlur,
  accessibilityHint,
  accessibilityLabel,
  accessibilityState,
  'aria-invalid': _ariaInvalid,
  'aria-required': _ariaRequired,
  style,
  ...props
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [hidden, setHidden] = useState(secureTextEntry);
  const [focused, setFocused] = useState(false);
  const inputAccessibilityProps = getInputAccessibilityProps({
    platform: Platform.OS,
    label,
    required,
    error,
    helperText,
    accessibilityLabel,
    accessibilityHint,
    accessibilityState,
  });

  return (
    <View style={[styles.wrap, style]}>
      {label && (
        <Text style={styles.label}>
          {label}
          {required ? <Text style={styles.required}> *</Text> : null}
        </Text>
      )}
      <View style={[styles.field, focused && styles.fieldFocused, error && styles.fieldError]}>
        {icon && <Ionicons name={icon} size={17} color={colors.inkFaint} style={styles.icon} />}
        <TextInput
          style={styles.input}
          placeholderTextColor={colors.inkFaint}
          secureTextEntry={hidden}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          {...inputAccessibilityProps}
          {...props}
        />
        {secureTextEntry && (
          <Pressable
            onPress={() => setHidden((value) => !value)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={hidden ? `Show ${label || 'password'}` : `Hide ${label || 'password'}`}
          >
            <Ionicons
              name={hidden ? 'eye-off-outline' : 'eye-outline'}
              size={18}
              color={colors.inkFaint}
            />
          </Pressable>
        )}
        {rightAction && (
          <Pressable onPress={onRightActionPress} hitSlop={10}>
            <Text style={styles.rightAction}>{rightAction}</Text>
          </Pressable>
        )}
      </View>
      {error ? (
        <Text
          style={[styles.supportingText, styles.errorText]}
          accessibilityLiveRegion={Platform.OS === 'android' ? 'polite' : undefined}
        >
          {error}
        </Text>
      ) : helperText ? (
        <Text style={styles.supportingText}>{helperText}</Text>
      ) : null}
    </View>
  );
}

export function getInputAccessibilityProps({
  platform,
  label,
  required = false,
  error,
  helperText,
  accessibilityLabel,
  accessibilityHint,
  accessibilityState,
}) {
  const web = platform === 'web';
  const baseLabel = accessibilityLabel || label;
  const nativeLabel = baseLabel
    ? `${baseLabel}${required ? ', required' : ''}`
    : required
      ? 'Required field'
      : undefined;
  const supportingHint = error
    ? `Error: ${error}`
    : helperText || accessibilityHint;

  return {
    accessibilityLabel: web ? baseLabel : nativeLabel,
    accessibilityHint: supportingHint,
    accessibilityState,
    ...(web
      ? {
          'aria-invalid': Boolean(error),
          'aria-required': required,
        }
      : {}),
  };
}

const PASSWORD_REQUIREMENTS = [
  [NEW_PASSWORD_ERROR_MESSAGES.MIN_CHARS, `At least ${PASSWORD_MIN_CHARS} characters`],
  [NEW_PASSWORD_ERROR_MESSAGES.UPPERCASE, 'One uppercase letter'],
  [NEW_PASSWORD_ERROR_MESSAGES.LOWERCASE, 'One lowercase letter'],
  [NEW_PASSWORD_ERROR_MESSAGES.DIGIT, 'One number'],
  [
    NEW_PASSWORD_ERROR_MESSAGES.SPECIAL,
    `One of ${PASSWORD_ALLOWED_SPECIAL_CHARS.split('').join(' ')}`,
  ],
  [NEW_PASSWORD_ERROR_MESSAGES.UNSUPPORTED, 'No unsupported characters'],
];

export function PasswordRequirements({ value }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const errors = new Set(validateNewPassword(value));
  const meetsRequirements = errors.size === 0;

  return (
    <View style={styles.requirements} accessibilityLiveRegion="polite">
      <Text style={styles.requirementsTitle}>Password requirements</Text>
      {PASSWORD_REQUIREMENTS.map(([message, label]) => {
        const met = !errors.has(message);
        return (
          <Text
            key={message}
            style={[styles.requirement, met && styles.requirementMet]}
            accessibilityLabel={`${met ? 'Met' : 'Not met'}: ${label}`}
          >
            {met ? '✓' : '○'} {label}
          </Text>
        );
      })}
      {meetsRequirements ? (
        <Text style={[styles.requirementStatus, styles.requirementMet]}>
          Meets password requirements
        </Text>
      ) : null}
    </View>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    wrap: { marginBottom: spacing.lg },
    label: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.sm,
      color: colors.inkSoft,
      marginBottom: spacing.sm,
      letterSpacing: 0.2,
    },
    field: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.paper,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.hairline,
      paddingHorizontal: spacing.md,
      height: 48,
      gap: spacing.sm,
    },
    fieldFocused: {
      borderColor: colors.sageDeep,
    },
    fieldError: {
      borderColor: colors.error,
    },
    required: { color: colors.error },
    icon: { marginRight: 2 },
    input: {
      flex: 1,
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.base,
      color: colors.ink,
      height: '100%',
      outlineStyle: 'none',
    },
    rightAction: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.xs,
      color: colors.sageDeep,
    },
    supportingText: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.xs,
      color: colors.inkFaint,
      marginTop: spacing.xs,
    },
    errorText: { color: colors.error },
    requirements: { marginTop: -spacing.sm, marginBottom: spacing.lg },
    requirementsTitle: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.sm,
      color: colors.inkSoft,
      marginBottom: spacing.xs,
    },
    requirement: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.xs,
      color: colors.inkFaint,
      lineHeight: 17,
    },
    requirementMet: { color: colors.success },
    requirementStatus: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.xs,
      marginTop: spacing.xs,
    },
  });
}
