import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useFavorites } from '../context/FavoritesContext';

// Teammate final Profile (c1c86ed) shows three stats: Recipes saved,
// Collections, Cooked. Only "saved" has a real backend — FavoritesContext.
// Collections and cook-history are M5 backends that don't exist yet, so they
// render an honest "—" rather than a fabricated 0 (a 0 would still claim the
// concept "collections" exists for this account today, which it does not).
const UNAVAILABLE_STAT = '—';

export default function ProfileScreen({ navigation }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors);
  const { user, signOut } = useAuth();
  const { favoriteIds, isInitializing } = useFavorites();

  const savedCount = isInitializing ? UNAVAILABLE_STAT : favoriteIds.size;
  const initial = (user?.name || 'A').trim().charAt(0).toUpperCase();
  const allergies = user?.preferences?.allergies || [];

  const showUnavailable = (feature) => {
    Alert.alert('Coming soon', `${feature} is not available yet.`);
  };

  const handleLogout = () => {
    Alert.alert('Log Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log Out',
        style: 'destructive',
        // signOut() revokes the backend session, clears the tokens, and flips
        // auth state — RootNavigator then swaps back to the Landing stack.
        onPress: () => signOut(),
      },
    ]);
  };

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.xl }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Pressable
            style={styles.iconBtn}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Settings"
            onPress={() => navigation.navigate('Settings')}
          >
            <Ionicons name="settings-outline" size={16} color={colors.ink} />
          </Pressable>
          <Text style={styles.headerTitle}>Profile</Text>
          <Pressable
            style={styles.iconBtn}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Notifications"
            onPress={() => navigation.navigate('Notifications')}
          >
            <Ionicons name="notifications-outline" size={16} color={colors.ink} />
          </Pressable>
        </View>

        <View style={styles.identity}>
          {/* Backend has no avatar field — an initials glyph, not a photo or
              an editable affordance (the teammate's local avatar picker is
              fake and is not ported). */}
          <View style={styles.avatar}>
            <Text style={styles.avatarInitial}>{initial}</Text>
          </View>
          <Text style={styles.name}>{user?.name}</Text>
          <Text style={styles.email}>{user?.email}</Text>
          <Pressable style={styles.editBtn} onPress={() => navigation.navigate('AccountDetails')}>
            <Ionicons name="pencil" size={12} color={colors.sageDeep} />
            <Text style={styles.editText}>Edit profile</Text>
          </Pressable>
        </View>

        <View style={styles.statsRow}>
          <Stat n={savedCount} label="Recipes saved" styles={styles} />
          <Stat n={UNAVAILABLE_STAT} label="Collections" styles={styles} />
          <Stat n={UNAVAILABLE_STAT} label="Cooked" styles={styles} />
        </View>

        <Text style={styles.eyebrow}>Preferences</Text>
        <View style={styles.prefList}>
          <Pressable
            style={styles.prefRow}
            onPress={() => showUnavailable('Dietary preference')}
          >
            <Text style={styles.prefLabel}>Dietary Preference</Text>
            <Text style={styles.prefValue}>Not available yet ›</Text>
          </Pressable>

          <Pressable style={styles.prefRow} onPress={() => navigation.navigate('AccountDetails')}>
            <Text style={styles.prefLabel}>Allergies</Text>
            <Text style={styles.prefValue}>{allergies.join(', ') || 'None ›'}</Text>
          </Pressable>

          <Pressable style={styles.prefRow} onPress={() => navigation.navigate('MealPlan')}>
            <Text style={styles.prefLabel}>Meal Plan</Text>
            <Text style={styles.prefValue}>›</Text>
          </Pressable>

          <Pressable
            style={styles.prefRow}
            onPress={() => showUnavailable('Cooking level')}
          >
            <Text style={styles.prefLabel}>Cooking Level</Text>
            <Text style={styles.prefValue}>Not available yet ›</Text>
          </Pressable>

          <Pressable style={[styles.prefRow, styles.prefRowLast]} onPress={() => navigation.navigate('Settings')}>
            <Text style={styles.prefLabel}>Settings</Text>
            <Text style={styles.prefValue}>›</Text>
          </Pressable>
        </View>

        <Pressable style={styles.logout} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={17} color={colors.error} />
          <Text style={styles.logoutText}>Log out</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function Stat({ n, label, styles }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={styles.statN}>{n}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    flex: { flex: 1 },
    scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    iconBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.creamDeep,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerTitle: {
      fontFamily: typography.display.fontFamilyItalic,
      fontSize: 18,
      color: colors.ink,
    },
    identity: { alignItems: 'center', marginTop: spacing.lg },
    avatar: {
      width: 76,
      height: 76,
      borderRadius: 38,
      backgroundColor: colors.sageDeep,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarInitial: { fontFamily: typography.display.fontFamily, fontSize: 28, color: colors.onAccent },
    name: { fontFamily: typography.display.fontFamily, fontSize: 19, color: colors.ink, marginTop: 12 },
    email: { fontFamily: typography.body.fontFamily, fontSize: 13, color: colors.inkSoft, marginTop: 3 },
    editBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      marginTop: 10,
      paddingHorizontal: 14,
      paddingVertical: 6,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.hairline,
    },
    editText: { fontFamily: typography.body.semibold, fontSize: 12, color: colors.sageDeep },
    statsRow: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 36,
      marginTop: spacing.xl,
      marginBottom: spacing.xxl,
    },
    statN: { fontFamily: typography.display.fontFamily, fontSize: 19, color: colors.ink },
    statLabel: { fontFamily: typography.body.fontFamily, fontSize: 11.5, color: colors.inkFaint, marginTop: 2 },
    eyebrow: {
      fontFamily: typography.body.bold,
      fontSize: 11.5,
      letterSpacing: 1.1,
      textTransform: 'uppercase',
      color: colors.inkFaint,
      marginBottom: spacing.xs,
    },
    prefList: { borderTopWidth: 1, borderTopColor: colors.hairline },
    prefRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 15,
      borderBottomWidth: 1,
      borderBottomColor: colors.hairline,
    },
    prefRowLast: { borderBottomWidth: 0 },
    prefLabel: { fontFamily: typography.body.fontFamily, fontSize: 14, color: colors.ink },
    prefValue: {
      fontFamily: typography.body.fontFamily,
      fontSize: 13,
      color: colors.inkFaint,
      maxWidth: '55%',
      textAlign: 'right',
    },
    logout: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 18, marginTop: spacing.sm },
    logoutText: { fontFamily: typography.body.semibold, fontSize: 14, color: colors.error },
  });
}
