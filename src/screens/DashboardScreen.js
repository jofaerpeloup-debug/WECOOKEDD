import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, Pressable, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import NotificationsDropdown from '../components/NotificationsDropdown';
import { recipes, CRAVINGS } from '../data/mockData';
import { metaLine } from '../utils/recipe';
import { imageSource } from '../utils/image';
import { useNotifications } from '../context/NotificationsContext';
import { useProfile } from '../context/ProfileContext';
import { useSearchHistory } from '../context/SearchHistoryContext';

// Rotates the featured recipe once per day.
function featuredForToday() {
  const day = Math.floor(Date.now() / 86400000);
  return recipes[day % recipes.length];
}

function greetingForNow() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function DashboardScreen({ navigation }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors);
  const { unreadCount } = useNotifications();
  const { profile } = useProfile();
  const { recent, addRecent, clearRecent } = useSearchHistory();
  const [notifOpen, setNotifOpen] = useState(false);
  const [query, setQuery] = useState('');

  const searching = query.trim().length > 0;
  const hero = useMemo(featuredForToday, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return recipes.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.ingredients.some((ing) => ing.name.toLowerCase().includes(q))
    );
  }, [query]);

  const trending = useMemo(() => recipes.filter((r) => r.id !== hero.id).slice(0, 6), [hero.id]);

  const openRecipe = (recipe) => navigation.navigate('RecipeDetail', { recipe });
  const firstName = (profile.name || 'Chef').replace(/^chef\s+/i, '').split(' ')[0];

  const runSearch = (q) => {
    setQuery(q);
    if (q.trim()) addRecent(q);
  };

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.xl }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text style={styles.wordmark}>WeCooked</Text>
          <View style={styles.headerActions}>
            <Pressable style={styles.bellBtn} hitSlop={8} onPress={() => navigation.navigate('Saved')}>
              <Ionicons name="bookmark-outline" size={16} color={colors.ink} />
            </Pressable>
            <Pressable style={styles.bellBtn} hitSlop={8} onPress={() => setNotifOpen(true)}>
              <Ionicons name="notifications-outline" size={17} color={colors.ink} />
              {unreadCount > 0 && <View style={styles.bellDot} />}
            </Pressable>
          </View>
        </View>

        <Text style={styles.greetingSub}>{greetingForNow()}, {firstName}</Text>
        <Text style={styles.greeting}>What shall we cook today?</Text>

        <View style={styles.searchRow}>
          <View style={styles.searchField}>
            <Ionicons name="search" size={15} color={colors.inkSoft} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search recipes, ingredients..."
              placeholderTextColor={colors.inkFaint}
              value={query}
              onChangeText={setQuery}
              onEndEditing={(e) => addRecent(e.nativeEvent.text)}
              autoCapitalize="none"
              returnKeyType="search"
            />
            {searching && (
              <Pressable onPress={() => setQuery('')} hitSlop={8}>
                <Ionicons name="close-circle" size={16} color={colors.inkFaint} />
              </Pressable>
            )}
          </View>
          <Pressable style={styles.filterBtn} onPress={() => navigation.navigate('Search')}>
            <Ionicons name="options-outline" size={18} color={colors.onAccent} />
          </Pressable>
        </View>

        {!searching && recent.length > 0 && (
          <View style={styles.recentWrap}>
            <View style={styles.recentHead}>
              <Text style={styles.eyebrow}>Recent searches</Text>
              <Pressable hitSlop={8} onPress={clearRecent}>
                <Text style={styles.seeAll}>Clear</Text>
              </Pressable>
            </View>
            <View style={styles.recentChips}>
              {recent.map((q) => (
                <Pressable key={q} style={styles.recentChip} onPress={() => runSearch(q)}>
                  <Ionicons name="time-outline" size={12} color={colors.inkFaint} />
                  <Text style={styles.recentChipText}>{q}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {searching ? (
          <View style={styles.resultsWrap}>
            <Text style={styles.eyebrow}>
              {results.length} {results.length === 1 ? 'result' : 'results'}
            </Text>
            {results.map((r) => (
              <Pressable key={r.id} style={styles.resultRow} onPress={() => openRecipe(r)}>
                <Image source={imageSource(r.image)} style={styles.resultThumb} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.resultTitle}>{r.title}</Text>
                  <Text style={styles.resultMeta}>{metaLine(r)}</Text>
                </View>
              </Pressable>
            ))}
            {results.length === 0 && (
              <Text style={styles.noResults}>No recipes match "{query.trim()}".</Text>
            )}
          </View>
        ) : (
          <>
            {/* Today's Feature */}
            <Pressable style={styles.hero} onPress={() => openRecipe(hero)}>
              <Image source={imageSource(hero.image)} style={styles.heroImg} />
              <LinearGradient colors={['rgba(18,22,14,0)', 'rgba(18,22,14,0.92)']} style={styles.heroScrim} />
              <Text style={styles.heroEyebrow}>TODAY'S FEATURE</Text>
              <View style={styles.heroText}>
                <Text style={styles.heroTitle}>{hero.title}</Text>
                <Text style={styles.heroMeta}>{metaLine(hero)}</Text>
              </View>
              <View style={styles.playBtn}>
                <Ionicons name="play" size={14} color={colors.onAccent} />
              </View>
            </Pressable>

            {/* Craving */}
            <View style={styles.eyebrowRow}>
              <Text style={styles.eyebrow}>Browse by craving</Text>
              <Pressable hitSlop={8} onPress={() => navigation.navigate('Search')}>
                <Text style={styles.seeAll}>See all</Text>
              </Pressable>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cravingRow}>
              {CRAVINGS.map((c) => (
                <Pressable
                  key={c.key}
                  style={styles.craving}
                  onPress={() => navigation.navigate('Search', { category: c.key })}
                >
                  <Image source={imageSource(c.image)} style={styles.cravingCircle} />
                  <Text style={styles.cravingLabel}>{c.label}</Text>
                </Pressable>
              ))}
            </ScrollView>

            {/* Trending */}
            <View style={styles.eyebrowRow}>
              <Text style={styles.eyebrow}>Trending meals</Text>
              <Pressable hitSlop={8} onPress={() => navigation.navigate('Search')}>
                <Text style={styles.seeAll}>See all</Text>
              </Pressable>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.trendRow}>
              {trending.map((r) => (
                <Pressable key={r.id} style={styles.trendCard} onPress={() => openRecipe(r)}>
                  <Image source={imageSource(r.image)} style={styles.trendImg} />
                  <Text style={styles.trendTitle} numberOfLines={2}>{r.title}</Text>
                  <Text style={styles.trendMeta}>{metaLine(r)}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </>
        )}
      </ScrollView>

      <NotificationsDropdown
        visible={notifOpen}
        onClose={() => setNotifOpen(false)}
        topOffset={insets.top + spacing.xl + 40}
      />
    </View>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    flex: { flex: 1 },
    scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    headerActions: { flexDirection: 'row', gap: 8 },
    wordmark: { fontFamily: typography.display.fontFamilyItalic, fontSize: 22, color: colors.ink },
    bellBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.creamDeep,
      alignItems: 'center',
      justifyContent: 'center',
    },
    bellDot: {
      position: 'absolute',
      top: 8,
      right: 9,
      width: 7,
      height: 7,
      borderRadius: 4,
      backgroundColor: colors.stone,
      borderWidth: 1.5,
      borderColor: colors.creamDeep,
    },
    greetingSub: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.base,
      color: colors.inkSoft,
      marginTop: spacing.lg,
    },
    greeting: { fontFamily: typography.display.fontFamily, fontSize: 22, color: colors.ink, marginTop: 2 },
    searchRow: { flexDirection: 'row', gap: 10, marginTop: spacing.lg, marginBottom: spacing.xl },
    searchField: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.creamDeep,
      borderRadius: radius.md,
      paddingHorizontal: 14,
      height: 44,
    },
    searchInput: {
      flex: 1,
      fontFamily: typography.body.fontFamily,
      fontSize: 13,
      color: colors.ink,
      outlineStyle: 'none',
    },
    filterBtn: {
      width: 44,
      height: 44,
      borderRadius: radius.md,
      backgroundColor: colors.sageDeep,
      alignItems: 'center',
      justifyContent: 'center',
    },
    recentWrap: { marginBottom: spacing.xl },
    recentHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: spacing.sm },
    recentChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    recentChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: radius.pill,
      backgroundColor: colors.creamDeep,
    },
    recentChipText: { fontFamily: typography.body.medium, fontSize: 12, color: colors.inkSoft },
    resultsWrap: { gap: 10 },
    resultRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    resultThumb: { width: 56, height: 56, borderRadius: 10, backgroundColor: colors.creamDeep },
    resultTitle: { fontFamily: typography.body.semibold, fontSize: 13.5, color: colors.ink },
    resultMeta: { fontFamily: typography.body.fontFamily, fontSize: 11.5, color: colors.inkFaint, marginTop: 3 },
    noResults: { fontFamily: typography.body.fontFamily, fontSize: 13, color: colors.inkFaint, paddingVertical: 16 },
    hero: {
      borderRadius: 20,
      overflow: 'hidden',
      height: 190,
      backgroundColor: colors.creamDeep,
      marginBottom: spacing.xxl,
    },
    heroImg: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
    heroScrim: { ...StyleSheet.absoluteFillObject },
    heroEyebrow: {
      position: 'absolute',
      left: 16,
      top: 14,
      fontFamily: typography.body.bold,
      fontSize: 10.5,
      letterSpacing: 1.2,
      color: colors.stone,
    },
    heroText: { position: 'absolute', left: 16, right: 70, bottom: 14 },
    heroTitle: { fontFamily: typography.display.fontFamily, fontSize: 21, lineHeight: 24, color: '#FAF9F6' },
    heroMeta: { fontFamily: typography.body.fontFamily, fontSize: 12, color: 'rgba(250,249,246,0.8)', marginTop: 6 },
    playBtn: {
      position: 'absolute',
      right: 16,
      bottom: 16,
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: colors.sageDeep,
      alignItems: 'center',
      justifyContent: 'center',
    },
    eyebrowRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      marginBottom: spacing.md,
    },
    eyebrow: {
      fontFamily: typography.body.bold,
      fontSize: 11.5,
      letterSpacing: 1.1,
      textTransform: 'uppercase',
      color: colors.inkFaint,
    },
    seeAll: { fontFamily: typography.body.medium, fontSize: 12, color: colors.stone },
    cravingRow: { gap: 18, paddingBottom: spacing.xxl },
    craving: { alignItems: 'center', gap: 8 },
    cravingCircle: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: colors.creamDeep,
    },
    cravingLabel: { fontFamily: typography.body.medium, fontSize: 12, color: colors.inkSoft },
    trendRow: { gap: 14, paddingBottom: spacing.xxl },
    trendCard: { width: 150 },
    trendImg: { width: 150, height: 110, borderRadius: 14, backgroundColor: colors.creamDeep },
    trendTitle: {
      fontFamily: typography.body.semibold,
      fontSize: 13,
      lineHeight: 16,
      color: colors.ink,
      marginTop: 8,
    },
    trendMeta: { fontFamily: typography.body.fontFamily, fontSize: 11.5, color: colors.inkFaint, marginTop: 3 },
  });
}
