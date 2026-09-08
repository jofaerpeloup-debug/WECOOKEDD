import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { typography, radius, spacing } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';

// tone: 'success' | 'warning' | 'info' | 'neutral' | 'sage'
export default function Badge({ label, tone = 'neutral', style }) {
  const { colors } = useTheme();
  const styles = makeStyles();
  const tones = makeTones(colors);
  const t = tones[tone] || tones.neutral;
  return (
    <View style={[styles.base, { backgroundColor: t.bg }, style]}>
      <Text style={[styles.text, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

function makeTones(colors) {
  return {
    success: { bg: colors.successBg, fg: colors.sageDeep },
    warning: { bg: colors.warningBg, fg: colors.warning },
    info: { bg: colors.infoBg, fg: colors.info },
    neutral: { bg: colors.creamDeep, fg: colors.inkSoft },
    sage: { bg: colors.sagePale, fg: colors.sageDeep },
    error: { bg: colors.errorBg, fg: colors.error },
  };
}

function makeStyles() {
  return StyleSheet.create({
    base: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      borderRadius: radius.pill,
      alignSelf: 'flex-start',
    },
    text: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.xs,
      letterSpacing: 0.2,
    },
  });
}
