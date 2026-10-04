import React from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import { useNotifications } from '../context/NotificationsContext';
import TopBar from '../components/TopBar';

const SETTINGS = Object.freeze([
  { key: 'push', label: 'Push Notifications', subtitle: 'Alerts on this device' },
  { key: 'email', label: 'Email Alerts', subtitle: 'Summaries and receipts' },
  { key: 'suggestions', label: 'Recipe Suggestions', subtitle: 'New picks based on what you cook' },
  { key: 'digest', label: 'Weekly Digest', subtitle: 'Top recipes every Sunday' },
  { key: 'reminders', label: 'Cooking Reminders', subtitle: 'Nudges to try something new' },
]);

export default function NotificationsScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const {
    preferences,
    preferencePending,
    preferenceError,
    setPreference,
  } = useNotifications();

  return (
    <View style={styles.root}>
      <TopBar mode="back" title="Notifications" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.subtitle}>Choose what WeCooked can notify you about.</Text>
        <View style={styles.card}>
          {SETTINGS.map((setting, index) => {
            const busy = !!preferencePending[setting.key];
            return (
              <View key={setting.key} style={[styles.row, index === SETTINGS.length - 1 && styles.lastRow]}>
                <View style={styles.copy}>
                  <Text style={styles.rowLabel}>{setting.label}</Text>
                  <Text style={styles.rowSub}>{setting.subtitle}</Text>
                </View>
                <Switch
                  value={preferences[setting.key]}
                  onValueChange={(value) => setPreference(setting.key, value)}
                  disabled={busy}
                  accessibilityLabel={setting.label}
                  accessibilityHint={setting.subtitle}
                  accessibilityState={{ checked: preferences[setting.key], disabled: busy, busy }}
                  trackColor={{ false: colors.hairline, true: colors.sageDeep }}
                  thumbColor={colors.onAccent}
                />
              </View>
            );
          })}
        </View>
        {preferenceError ? (
          <Text style={styles.error} accessibilityRole="alert">{preferenceError}</Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
    subtitle: {
      fontFamily: typography.body.fontFamily, fontSize: typography.sizes.sm,
      color: colors.inkSoft, marginBottom: spacing.lg, lineHeight: 19,
    },
    card: {
      backgroundColor: colors.paper, borderRadius: radius.lg, borderWidth: 1,
      borderColor: colors.hairline, overflow: 'hidden',
    },
    row: {
      minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: spacing.md,
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
      borderBottomWidth: 1, borderBottomColor: colors.hairline,
    },
    lastRow: { borderBottomWidth: 0 },
    copy: { flex: 1 },
    rowLabel: { fontFamily: typography.body.medium, fontSize: typography.sizes.base, color: colors.ink },
    rowSub: { fontFamily: typography.body.fontFamily, fontSize: typography.sizes.xs, color: colors.inkFaint, marginTop: 2 },
    error: {
      fontFamily: typography.body.medium, fontSize: typography.sizes.sm,
      color: colors.error, marginTop: spacing.lg, textAlign: 'center',
    },
  });
}

export { SETTINGS };
