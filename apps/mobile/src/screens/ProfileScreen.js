import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Alert, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useFavorites } from '../context/FavoritesContext';
import { useCollections } from '../context/CollectionsContext';
import { useCookHistory } from '../context/CookHistoryContext';
import { useNotifications } from '../context/NotificationsContext';
import NotificationsDropdown from '../components/NotificationsDropdown';

const UNAVAILABLE_STAT = '—';
const COOKING_LEVEL_LABELS = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

export default function ProfileScreen({ navigation }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors);
  const { user, signOut } = useAuth();
  const { unreadCount } = useNotifications();
  const [notificationsVisible, setNotificationsVisible] = useState(false);
  const {
    favoriteIds,
    isInitializing: favoritesInitializing,
    error: favoritesError,
  } = useFavorites();
  const {
    collections,
    isInitializing: collectionsInitializing,
    error: collectionsError,
  } = useCollections();
  const {
    stats: cookStats,
    isInitializing: cookStatsInitializing,
    error: cookStatsError,
  } = useCookHistory();

  const savedCount = favoritesInitializing || favoritesError ? UNAVAILABLE_STAT : favoriteIds.size;
  const collectionsCount =
    collectionsInitializing || collectionsError ? UNAVAILABLE_STAT : collections.length;
  const cookedCount =
    cookStatsInitializing || cookStatsError || !cookStats
      ? UNAVAILABLE_STAT
      : cookStats.uniqueRecipesCooked;
  const initial = (user?.name || 'A').trim().charAt(0).toUpperCase();
  const dietaryPreferences = user?.preferences?.dietaryPreferences || [];
  const allergies = user?.preferences?.allergies || [];
  const cookingLevel = COOKING_LEVEL_LABELS[user?.cookingLevel] || COOKING_LEVEL_LABELS.beginner;

  const handleLogout = () => {
    Alert.alert('Log Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log Out', style: 'destructive', onPress: () => signOut() },
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
          <Text style={styles.headerTitle} accessibilityRole="header">Profile</Text>
          <Pressable
            style={styles.iconBtn}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`Notifications, ${unreadCount} unread`}
            onPress={() => setNotificationsVisible(true)}
          >
            <Ionicons name="notifications-outline" size={16} color={colors.ink} />
            {unreadCount > 0 ? <View style={styles.bellDot} /> : null}
          </Pressable>
        </View>

        <View style={styles.identity}>
          {user?.avatarUrl ? (
            <Image source={{ uri: user.avatarUrl }} style={styles.avatar} accessible accessibilityLabel={`${user?.name || 'Account'} avatar`} />
          ) : (
            <View style={styles.avatar} accessible accessibilityLabel={`${user?.name || 'Account'} initial`}>
              <Text style={styles.avatarInitial}>{initial}</Text>
            </View>
          )}
          <Text style={styles.name}>{user?.name || 'WeCooked account'}</Text>
          <Text style={styles.email}>{user?.email || 'Email unavailable'}</Text>
          <Text style={styles.cookingLevel}>{cookingLevel}</Text>
          <Text style={styles.bio}>{user?.bio ?? ''}</Text>
          <Pressable
            style={styles.editBtn}
            onPress={() => navigation.navigate('AccountDetails')}
            accessibilityRole="button"
            accessibilityLabel="Edit profile and preferences"
          >
            <Ionicons name="pencil" size={12} color={colors.sageDeep} />
            <Text style={styles.editText}>Edit profile</Text>
          </Pressable>
        </View>

        <View style={styles.statsRow}>
          <Stat n={savedCount} label="Recipes saved" styles={styles} />
          <Stat n={collectionsCount} label="Collections" styles={styles} />
          <Stat
            n={cookedCount}
            label="Cooked"
            styles={styles}
            onPress={() => navigation.navigate('CookingHistory')}
            accessibilityLabel={`Cooked: ${cookedCount}. Open cooking history`}
          />
        </View>

        <Text style={styles.eyebrow}>Preferences</Text>
        <View style={styles.prefList}>
          <PreferenceRow
            label="Dietary Preferences"
            value={dietaryPreferences.join(', ') || 'None'}
            accessibilityLabel="Edit dietary preferences"
            onPress={() => navigation.navigate('AccountDetails')}
            styles={styles}
          />
          <PreferenceRow
            label="Allergies"
            value={allergies.join(', ') || 'None'}
            accessibilityLabel="Edit allergies"
            onPress={() => navigation.navigate('AccountDetails')}
            styles={styles}
          />
          <PreferenceRow
            label="Meal Plan"
            accessibilityLabel="Open meal plan"
            onPress={() => navigation.navigate('MealPlan')}
            styles={styles}
          />
          <PreferenceRow
            label="Settings"
            accessibilityLabel="Open settings"
            onPress={() => navigation.navigate('Settings')}
            styles={styles}
            last
          />
        </View>

        <Pressable
          style={styles.logout}
          onPress={handleLogout}
          accessibilityRole="button"
          accessibilityLabel="Log out"
        >
          <Ionicons name="log-out-outline" size={17} color={colors.error} />
          <Text style={styles.logoutText}>Log out</Text>
        </Pressable>
      </ScrollView>
      <NotificationsDropdown
        visible={notificationsVisible}
        onClose={() => setNotificationsVisible(false)}
        topOffset={insets.top + spacing.xl + 40}
        navigation={navigation}
      />
    </View>
  );
}

function Stat({ n, label, styles, onPress, accessibilityLabel }) {
  const Container = onPress ? Pressable : View;
  return (
    <Container
      style={styles.stat}
      onPress={onPress}
      accessible
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={accessibilityLabel || `${label}: ${n}`}
    >
      <Text style={styles.statN}>{n}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Container>
  );
}

function PreferenceRow({ label, value, accessibilityLabel, onPress, styles, last = false }) {
  return (
    <Pressable
      style={[styles.prefRow, last && styles.prefRowLast]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <Text style={styles.prefLabel}>{label}</Text>
      <Text style={styles.prefValue} numberOfLines={2}>{value ? `${value} ›` : '›'}</Text>
    </Pressable>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    flex: { flex: 1 },
    scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    iconBtn: {
      width: 36, height: 36, borderRadius: 18, backgroundColor: colors.creamDeep,
      alignItems: 'center', justifyContent: 'center', position: 'relative',
    },
    bellDot: {
      position: 'absolute', top: 7, right: 7, width: 7, height: 7,
      borderRadius: 4, backgroundColor: colors.sageDeep,
      borderWidth: 1, borderColor: colors.creamDeep,
    },
    headerTitle: { fontFamily: typography.display.fontFamilyItalic, fontSize: 18, color: colors.ink },
    identity: { alignItems: 'center', marginTop: spacing.lg },
    avatar: {
      width: 76, height: 76, borderRadius: 38, backgroundColor: colors.sageDeep,
      alignItems: 'center', justifyContent: 'center',
    },
    avatarInitial: { fontFamily: typography.display.fontFamily, fontSize: 28, color: colors.onAccent },
    name: { fontFamily: typography.display.fontFamily, fontSize: 19, color: colors.ink, marginTop: 12 },
    email: { fontFamily: typography.body.fontFamily, fontSize: 13, color: colors.inkSoft, marginTop: 3 },
    cookingLevel: { fontFamily: typography.body.semibold, fontSize: 12, color: colors.sageDeep, marginTop: 6 },
    bio: { fontFamily: typography.body.fontFamily, fontSize: 13, lineHeight: 19, color: colors.inkSoft, marginTop: 8, textAlign: 'center' },
    editBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 10,
      minHeight: 40, paddingHorizontal: 14, borderRadius: radius.pill,
      borderWidth: 1, borderColor: colors.hairline,
    },
    editText: { fontFamily: typography.body.semibold, fontSize: 12, color: colors.sageDeep },
    statsRow: {
      flexDirection: 'row', justifyContent: 'space-around',
      marginTop: spacing.xl, marginBottom: spacing.xxl,
    },
    stat: { flex: 1, alignItems: 'center' },
    statN: { fontFamily: typography.display.fontFamily, fontSize: 19, color: colors.ink },
    statLabel: { fontFamily: typography.body.fontFamily, fontSize: 11.5, color: colors.inkFaint, marginTop: 2 },
    eyebrow: {
      fontFamily: typography.body.bold, fontSize: 11.5, letterSpacing: 1.1,
      textTransform: 'uppercase', color: colors.inkFaint, marginBottom: spacing.xs,
    },
    prefList: { borderTopWidth: 1, borderTopColor: colors.hairline },
    prefRow: {
      minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.hairline,
    },
    prefRowLast: { borderBottomWidth: 0 },
    prefLabel: { flex: 1, fontFamily: typography.body.fontFamily, fontSize: 14, color: colors.ink },
    prefValue: {
      fontFamily: typography.body.fontFamily, fontSize: 13, color: colors.inkFaint,
      maxWidth: '55%', textAlign: 'right',
    },
    logout: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: spacing.sm },
    logoutText: { fontFamily: typography.body.semibold, fontSize: 14, color: colors.error },
  });
}
