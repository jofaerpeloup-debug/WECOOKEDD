import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, Pressable, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import { recipes, TIME_BUCKETS, DIFFICULTIES, DIETARIES } from '../data/mockData';
import { metaLine, timeBucket } from '../utils/recipe';
import { imageSource } from '../utils/image';
import { useSearchHistory } from '../context/SearchHistoryContext';

export default function DiscoverScreen({ navigation, route }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors);
  const scrollRef = useRef(null);
  const { recent, addRecent, clearRecent, filters, setFilters } = useSearchHistory();

  const [query, setQuery] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(true);

  const { timeBkt, difficulty, dietary, category } = filters;
  const setTimeBkt = (v) => setFilters((f) => ({ ...f, timeBkt: v }));
  const setDifficulty = (v) => setFilters((f) => ({ ...f, difficulty: v }));
  const setDietary = (updater) =>
    setFilters((f) => ({ ...f, dietary: typeof updater === 'function' ? updater(f.dietary) : updater }));

  const routeCategory = route?.params?.category;
  useEffect(() => {
    if (routeCategory) {
      setFilters({ timeBkt: null, difficulty: null, dietary: [], category: routeCategory });
    }
  }, [routeCategory]);

  const toggleIn = (arr, setArr, v) => setArr(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const clearAll = () => {
    setFilters({ timeBkt: null, difficulty: null, dietary: [], category: null });
    setQuery('');
  };

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return recipes.filter((r) => {
      if (q) {
        const hit =
          r.title.toLowerCase().includes(q) ||
          (r.description || '').toLowerCase().includes(q) ||
          r.ingredients.some((ing) => ing.name.toLowerCase().includes(q));
        if (!hit) return false;
      }
      if (category && r.category !== category) return false;
      if (timeBkt && timeBucket(r.minutes) !== timeBkt) return false;
      if (difficulty && r.difficulty !== difficulty) return false;
      if (dietary.length && !dietary.every((d) => r.dietary.includes(d))) return false;
      return true;
    });
  }, [query, category, timeBkt, difficulty, dietary]);

  const activeCount =
    (timeBkt ? 1 : 0) + (difficulty ? 1 : 0) + dietary.length + (category ? 1 : 0);

  const showResults = () => {
    setFiltersOpen(false);
    setTimeout(() => scrollRef.current?.scrollTo({ y: 0, animated: true }), 30);
  };

  const Chip = ({ label, active, onPress }) => (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={styles.root}>
      <ScrollView
        ref={scrollRef}
        style={styles.flex}
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.xl }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.headerRow}>
          <Pressable style={styles.backBtn} hitSlop={8} onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" size={18} color={colors.ink} />
          </Pressable>
          <Text style={styles.title}>Search</Text>
        </View>

        <View style={styles.searchRow}>
          <View style={styles.searchField}>
            <Ionicons name="search" size={15} color={colors.inkSoft} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search recipes..."
              placeholderTextColor={colors.inkFaint}
              value={query}
              onChangeText={setQuery}
              onEndEditing={(e) => addRecent(e.nativeEvent.text)}
              autoCapitalize="none"
              returnKeyType="search"
            />
          </View>
          <Pressable onPress={clearAll} hitSlop={8}>
            <Text style={styles.clear}>Clear</Text>
          </Pressable>
        </View>

        {!query && recent.length > 0 && (
          <View style={styles.recentWrap}>
            <View style={styles.recentHead}>
              <Text style={styles.groupLabel}>Recent</Text>
              <Pressable hitSlop={8} onPress={clearRecent}>
                <Text style={styles.clear}>Clear</Text>
              </Pressable>
            </View>
            <View style={styles.chipWrap}>
              {recent.map((r) => (
                <Pressable key={r} style={styles.recentChip} onPress={() => setQuery(r)}>
                  <Ionicons name="time-outline" size={12} color={colors.inkFaint} />
                  <Text style={styles.recentChipText}>{r}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        <Pressable style={styles.filterToggle} onPress={() => setFiltersOpen((v) => !v)}>
          <Ionicons name="options-outline" size={15} color={colors.inkSoft} />
          <Text style={styles.filterToggleText}>
            Filters{activeCount ? ` · ${activeCount}` : ''}
          </Text>
          <Ionicons name={filtersOpen ? 'chevron-up' : 'chevron-down'} size={14} color={colors.inkFaint} />
        </Pressable>

        {filtersOpen && (
          <View>
            <Text style={styles.groupLabel}>Cooking Time</Text>
            <View style={styles.chipWrap}>
              {TIME_BUCKETS.map((t) => (
                <Chip key={t.key} label={t.label} active={timeBkt === t.key} onPress={() => setTimeBkt(timeBkt === t.key ? null : t.key)} />
              ))}
            </View>

            <Text style={styles.groupLabel}>Difficulty</Text>
            <View style={styles.chipWrap}>
              {DIFFICULTIES.map((d) => (
                <Chip key={d} label={d} active={difficulty === d} onPress={() => setDifficulty(difficulty === d ? null : d)} />
              ))}
            </View>

            <Text style={styles.groupLabel}>Dietary</Text>
            <View style={styles.chipWrap}>
              {DIETARIES.map((d) => (
                <Chip key={d.key} label={d.label} active={dietary.includes(d.key)} onPress={() => toggleIn(dietary, setDietary, d.key)} />
              ))}
            </View>
          </View>
        )}

        <Text style={styles.groupLabel}>{results.length} recipes found</Text>
        <View style={{ gap: 10 }}>
          {results.map((r) => (
            <Pressable key={r.id} style={styles.resultCard} onPress={() => navigation.navigate('RecipeDetail', { recipe: r })}>
              <Image source={imageSource(r.image)} style={styles.resultThumb} />
              <View style={{ flex: 1 }}>
                <Text style={styles.resultTitle}>{r.title}</Text>
                <Text style={styles.resultMeta}>{metaLine(r)}</Text>
              </View>
            </Pressable>
          ))}
          {results.length === 0 && (
            <Text style={styles.empty}>No recipes match these filters.</Text>
          )}
        </View>
      </ScrollView>

      {filtersOpen && (
        <View style={styles.ctaWrap}>
          <Pressable style={styles.cta} onPress={showResults}>
            <Text style={styles.ctaText}>Show {results.length} recipes</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    flex: { flex: 1 },
    scroll: { paddingHorizontal: spacing.xl, paddingBottom: 140 },
    headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: spacing.lg },
    backBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.creamDeep,
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: { fontFamily: typography.display.fontFamily, fontSize: 20, color: colors.ink },
    searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: spacing.md },
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
    clear: { fontFamily: typography.body.medium, fontSize: 12, color: colors.stone },
    recentWrap: { marginTop: spacing.sm },
    recentHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
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
    filterToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      alignSelf: 'flex-start',
      paddingVertical: 8,
    },
    filterToggleText: { fontFamily: typography.body.semibold, fontSize: 12.5, color: colors.inkSoft },
    groupLabel: {
      fontFamily: typography.body.bold,
      fontSize: 11.5,
      letterSpacing: 1.1,
      textTransform: 'uppercase',
      color: colors.inkFaint,
      marginTop: spacing.lg,
      marginBottom: spacing.sm,
    },
    chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      paddingHorizontal: 15,
      paddingVertical: 9,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.hairline,
    },
    chipActive: { backgroundColor: colors.sageDeep, borderColor: colors.sageDeep },
    chipText: { fontFamily: typography.body.semibold, fontSize: 13, color: colors.inkSoft },
    chipTextActive: { color: colors.onAccent },
    resultCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: colors.creamDeep,
      borderRadius: 14,
      padding: 10,
    },
    resultThumb: { width: 60, height: 60, borderRadius: 10, backgroundColor: colors.paper },
    resultTitle: { fontFamily: typography.body.semibold, fontSize: 13.5, color: colors.ink },
    resultMeta: { fontFamily: typography.body.fontFamily, fontSize: 11.5, color: colors.inkFaint, marginTop: 4 },
    empty: { fontFamily: typography.body.fontFamily, fontSize: 13, color: colors.inkFaint, textAlign: 'center', paddingVertical: 24 },
    ctaWrap: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.md,
      paddingBottom: spacing.md,
      backgroundColor: colors.cream,
      borderTopWidth: 1,
      borderTopColor: colors.hairline,
    },
    cta: {
      height: 52,
      borderRadius: radius.pill,
      backgroundColor: colors.sageDeep,
      alignItems: 'center',
      justifyContent: 'center',
    },
    ctaText: { fontFamily: typography.body.semibold, fontSize: typography.sizes.md, color: colors.onAccent },
  });
}
