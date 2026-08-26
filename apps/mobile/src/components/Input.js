import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { typography, radius, spacing } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';

export default function Input({
  label,
  icon,
  secureTextEntry,
  rightAction,
  onRightActionPress,
  style,
  ...props
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [hidden, setHidden] = useState(secureTextEntry);
  const [focused, setFocused] = useState(false);

  return (
    <View style={[styles.wrap, style]}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View style={[styles.field, focused && styles.fieldFocused]}>
        {icon && <Ionicons name={icon} size={17} color={colors.inkFaint} style={styles.icon} />}
        <TextInput
          style={styles.input}
          placeholderTextColor={colors.inkFaint}
          secureTextEntry={hidden}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          {...props}
        />
        {secureTextEntry && (
          <Pressable onPress={() => setHidden(!hidden)} hitSlop={10}>
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
  });
}
