import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import NotificationsDropdown from '../components/NotificationsDropdown';
import { DIETARY_PREF_OPTIONS, COOKING_LEVELS, COLLECTIONS } from '../data/mockData';
import { useAuth } from '../context/AuthContext';
import { useProfile } from '../context/ProfileContext';
import { useSavedRecipes } from '../context/SavedRecipesContext';
import { useCollections } from '../context/CollectionsContext';
import { useCookedRecipes } from '../context/CookedRecipesContext';
import { loadJSON, saveJSON } from '../utils/storage';
import { confirm } from '../utils/alert';

const PREFS_KEY = 'wecooked:profilePrefs';

export default function ProfileScreen({ navigation }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors);
  const { logout } = useAuth();
  const { profile, avatar, bio } = useProfile();
  const { savedIds } = useSavedRecipes();
  const { collections } = useCollections();
  const { cookedCount } = useCookedRecipes();

  const [notifOpen, setNotifOpen] = useState(false);
  const [dietOpen, setDietOpen] = useState(false);
  const [dietPref, setDietPref] = useState(DIETARY_PREF_OPTIONS[0]);
  const [level, setLevel] = useState('Intermediate');
  const hydrated = useRef(false);

  useEffect(() => {
    (async () => {
      const p = await loadJSON(PREFS_KEY, null);
      if (p) {
        if (p.dietPref) setDietPref(p.dietPref);
        if (p.level) setLevel(p.level);
      }
      hydrated.current = true;
    })();
  }, []);
  useEffect(() => {
    if (hydrated.current) saveJSON(PREFS_KEY, { dietPref, level });
  }, [dietPref, level]);

  const cycleLevel = () =>
    setLevel((l) => COOKING_LEVELS[(COOKING_LEVELS.indexOf(l) + 1) % COOKING_LEVELS.length]);

  const handleLogout = () => {
    confirm(
      'Log Out',
      'Are you sure you want to log out?',
      async () => {
        await logout();
        navigation.reset({ index: 0, routes: [{ name: 'Onboarding' }] });
      },
      { confirmLabel: 'Log Out', destructive: true }
    );
  };

  const initial = (profile.name || 'A').charAt(0).toUpperCase();
  const savedCount = savedIds.size;
  const collectionsCount = COLLECTIONS.length + collections.length;

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.xl }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Pressable style={styles.iconBtn} hitSlop={6} onPress={() => navigation.navigate('Settings')}>
            <Ionicons name="settings-outline" size={16} color={colors.ink} />
          </Pressable>
          <Text style={styles.headerTitle}>Profile</Text>
          <Pressable style={styles.iconBtn} hitSlop={6} onPress={() => setNotifOpen(true)}>
            <Ionicons name="notifications-outline" size={16} color={colors.ink} />
          </Pressable>
        </View>

        <View style={styles.identity}>
          {avatar ? (
            <Image source={{ uri: avatar }} style={styles.avatar} />
          ) : (
            <View style={styles.avatar}>
              <Text style={styles.avatarInitial}>{initial}</Text>
            </View>
          )}
          <Text style={styles.name}>{profile.name}</Text>
          {!!bio && <Text style={styles.bio}>{bio}</Text>}
          <Pressable style={styles.editBtn} onPress={() => navigation.navigate('AccountDetails')}>
            <Ionicons name="pencil" size={12} color={colors.sageDeep} />
            <Text style={styles.editText}>Edit profile</Text>
          </Pressable>
        </View>

        <View style={styles.statsRow}>
          <Stat n={savedCount} label="Recipes saved" styles={styles} />
          <Stat n={collectionsCount} label="Collections" styles={styles} />
          <Stat n={cookedCount} label="Cooked" styles={styles} />
        </View>

        <Text style={styles.eyebrow}>Preferences</Text>
        <View style={styles.prefList}>
          <Pressable style={styles.prefRow} onPress={() => setDietOpen((v) => !v)}>
            <Text style={styles.prefLabel}>Dietary Preference</Text>
            <Text style={styles.prefValue}>{dietPref} ›</Text>
          </Pressable>
          {dietOpen && (
            <View style={styles.pickerWrap}>
              {DIETARY_PREF_OPTIONS.map((opt) => {
                const on = opt === dietPref;
                return (
                  <Pressable
                    key={opt}
                    onPress={() => {
                      setDietPref(opt);
                      setDietOpen(false);
                    }}
                    style={[styles.pickerChip, on && styles.pickerChipOn]}
                  >
                    <Text style={[styles.pickerText, on && styles.pickerTextOn]}>{opt}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}

          <Pressable style={styles.prefRow} onPress={() => navigation.navigate('AccountDetails')}>
            <Text style={styles.prefLabel}>Allergies</Text>
            <Text style={styles.prefValue}>{(profile.dietary || []).join(', ') || 'None ›'}</Text>
          </Pressable>

          <Pressable style={styles.prefRow} onPress={() => navigation.navigate('MealPlan')}>
            <Text style={styles.prefLabel}>Meal Plan</Text>
            <Text style={styles.prefValue}>›</Text>
          </Pressable>

          <Pressable style={styles.prefRow} onPress={cycleLevel}>
            <Text style={styles.prefLabel}>Cooking Level</Text>
            <Text style={styles.prefValue}>{level} ›</Text>
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

      <NotificationsDropdown
        visible={notifOpen}
        onClose={() => setNotifOpen(false)}
        topOffset={insets.top + spacing.xl + 40}
      />
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
    headerTitle: { fontFamily: typography.display.fontFamilyItalic, fontSize: 18, color: colors.ink },
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
    bio: { fontFamily: typography.body.fontFamily, fontSize: 13, color: colors.inkSoft, marginTop: 3 },
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
    statsRow: { flexDirection: 'row', justifyContent: 'center', gap: 36, marginTop: spacing.xl, marginBottom: spacing.xxl },
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
    prefValue: { fontFamily: typography.body.fontFamily, fontSize: 13, color: colors.inkFaint, maxWidth: '55%', textAlign: 'right' },
    pickerWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.hairline,
    },
    pickerChip: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.hairline,
    },
    pickerChipOn: { backgroundColor: colors.sageDeep, borderColor: colors.sageDeep },
    pickerText: { fontFamily: typography.body.fontFamily, fontSize: 12.5, color: colors.inkSoft },
    pickerTextOn: { color: colors.onAccent },
    logout: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 18, marginTop: spacing.sm },
    logoutText: { fontFamily: typography.body.semibold, fontSize: 14, color: colors.error },
  });
}
