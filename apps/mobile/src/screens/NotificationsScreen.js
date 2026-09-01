import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Switch } from 'react-native';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import TopBar from '../components/TopBar';
import { useAuth } from '../context/AuthContext';
import { updateProfile } from '../api/profileService';
import { getAuthErrorMessage } from '../api/errorMessages';

export default function NotificationsScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { user, syncUser } = useAuth();

  // Backend has exactly one notification control. The Switch is driven straight
  // from context — no local mirror — so it can never drift from the
  // authoritative value.
  const enabled = !!user?.preferences?.notifications?.enabled;

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const savingRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  // Pessimistic: the Switch stays disabled and unchanged until the PATCH
  // response updates context. Nothing to roll back on failure.
  const toggle = async (next) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateProfile({
        preferences: { notifications: { enabled: next } },
      });
      syncUser(updated);
    } catch (err) {
      setError(getAuthErrorMessage(err));
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  };

  return (
    <View style={styles.root}>
      <TopBar mode="back" title="Notifications" onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.subtitle}>Control notifications from WeCooked on this account.</Text>

        <View style={styles.card}>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Allow notifications</Text>
              <Text style={styles.rowSub}>Turn WeCooked notifications on or off.</Text>
            </View>
            <Switch
              value={enabled}
              onValueChange={toggle}
              disabled={saving}
              trackColor={{ false: colors.hairline, true: colors.sageDeep }}
              thumbColor={colors.onAccent}
            />
          </View>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
    </View>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
    subtitle: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.inkSoft,
      marginBottom: spacing.lg,
      lineHeight: 19,
    },
    card: {
      backgroundColor: colors.paper,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.hairline,
      overflow: 'hidden',
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
    rowLabel: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.base,
      color: colors.ink,
    },
    rowSub: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.xs,
      color: colors.inkFaint,
      marginTop: 1,
    },
    error: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.sm,
      color: colors.error,
      marginTop: spacing.lg,
      textAlign: 'center',
    },
  });
}
