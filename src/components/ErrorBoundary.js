import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';

// One bad render used to drop the whole app to a red screen. This catches it,
// shows a calm recovery card, and lets the user retry without a full reload.
export default class ErrorBoundary extends React.Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Left as a console trace on purpose — a demo app has no crash reporter.
    console.warn('[ErrorBoundary]', error, info?.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return <ErrorFallback error={this.state.error} onReset={this.reset} />;
    }
    return this.props.children;
  }
}

function ErrorFallback({ error, onReset }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <View style={styles.root}>
      <View style={styles.iconWrap}>
        <Ionicons name="restaurant-outline" size={26} color={colors.sageDeep} />
      </View>
      <Text style={styles.title}>Something didn't cook right</Text>
      <Text style={styles.body}>
        The screen ran into an unexpected error. You can try again — your saved recipes and settings
        are safe.
      </Text>
      {!!error?.message && <Text style={styles.detail}>{String(error.message)}</Text>}
      <Pressable style={styles.btn} onPress={onReset}>
        <Text style={styles.btnText}>Try again</Text>
      </Pressable>
    </View>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.cream,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.xxl,
    },
    iconWrap: {
      width: 60,
      height: 60,
      borderRadius: 30,
      backgroundColor: colors.sagePale,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.lg,
    },
    title: {
      fontFamily: typography.display.fontFamily,
      fontSize: 20,
      color: colors.ink,
      textAlign: 'center',
      marginBottom: spacing.sm,
    },
    body: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.inkSoft,
      textAlign: 'center',
      lineHeight: 20,
    },
    detail: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.xs,
      color: colors.inkFaint,
      textAlign: 'center',
      marginTop: spacing.md,
    },
    btn: {
      marginTop: spacing.xl,
      backgroundColor: colors.sageDeep,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.xxl,
      paddingVertical: spacing.md,
    },
    btnText: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.sm,
      color: colors.onAccent,
    },
  });
}
