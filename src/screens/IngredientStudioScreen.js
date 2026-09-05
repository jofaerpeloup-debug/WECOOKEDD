import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, Pressable, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import TopBar from '../components/TopBar';
import Badge from '../components/Badge';
import { ingredientSwaps } from '../data/mockData';

const INGREDIENT_KEYS = Object.keys(ingredientSwaps);

// Recipe ingredient names are freeform ("White vinegar", "Coconut milk") —
// match them to a swap-card key by substring, preferring the most specific
// (longest) key so "Coconut milk" resolves to 'coconut milk', not 'milk'.
function keyForIngredientName(name) {
  const n = name.toLowerCase();
  const candidates = INGREDIENT_KEYS.filter((key) => n.includes(key));
  if (!candidates.length) return null;
  return candidates.sort((a, b) => b.length - a.length)[0];
}

export default function IngredientStudioScreen({ navigation, route }) {
  const { colors, shadow } = useTheme();
  const styles = makeStyles(colors, shadow);
  // Rendered both as the "Swaps" bottom tab (no back arrow) and pushed from a
  // recipe's "Need a substitute?" row (back arrow returns to the recipe).
  const asTab = route.name === 'Swaps';
  const recipe = route.params?.recipe || null;

  // The ingredients THIS recipe actually needs to swap — what the row that
  // opened this screen promised ("Need a substitute? Find swaps").
  const recipeKeys = useMemo(() => {
    if (!recipe?.ingredients) return [];
    const seen = new Set();
    const keys = [];
    for (const ing of recipe.ingredients) {
      const key = keyForIngredientName(ing.name);
      if (key && !seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
    return keys;
  }, [recipe]);

  const [query, setQuery] = useState('');
  const [browseAll, setBrowseAll] = useState(recipeKeys.length === 0);
  const [selectedKey, setSelectedKey] = useState(
    route.params?.ingredientKey || recipeKeys[0] || 'butter'
  );

  const matches = useMemo(() => {
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      return INGREDIENT_KEYS.filter((key) => ingredientSwaps[key].name.toLowerCase().includes(q));
    }
    if (recipeKeys.length && !browseAll) return recipeKeys;
    return INGREDIENT_KEYS;
  }, [query, recipeKeys, browseAll]);

  const data = ingredientSwaps[selectedKey];

  return (
    <View style={styles.root}>
      <TopBar title="Substitute Finder" onBack={asTab ? undefined : () => navigation.goBack()} />

      {!!recipe && (
        <View style={styles.recipeBanner}>
          <Ionicons name="restaurant-outline" size={13} color={colors.sageDeep} />
          <Text style={styles.recipeBannerText} numberOfLines={1}>
            {recipeKeys.length === 0
              ? `No specific swaps found for ${recipe.title} — browse ingredients below.`
              : browseAll
                ? 'All swappable ingredients'
                : `What ${recipe.title} needs to swap`}
          </Text>
          {recipeKeys.length > 0 && (
            <Pressable onPress={() => setBrowseAll((v) => !v)} hitSlop={8}>
              <Text style={styles.recipeBannerLink}>{browseAll ? 'Just this recipe' : 'Browse all'}</Text>
            </Pressable>
          )}
        </View>
      )}

      <View style={styles.searchWrap}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={17} color={colors.inkFaint} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search an ingredient (e.g. garlic, vinegar, coconut milk)..."
            placeholderTextColor={colors.inkFaint}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoComplete="off"
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={17} color={colors.inkFaint} />
            </Pressable>
          )}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {matches.map((key) => {
            const isActive = key === selectedKey;
            return (
              <Pressable
                key={key}
                onPress={() => {
                  setSelectedKey(key);
                  setQuery('');
                }}
                style={[styles.chip, isActive && styles.chipActive]}
              >
                <Text style={[styles.chipText, isActive && styles.chipTextActive]}>
                  {ingredientSwaps[key].name}
                </Text>
              </Pressable>
            );
          })}
          {matches.length === 0 && (
            <Text style={styles.noMatches}>No ingredients match "{query}"</Text>
          )}
        </ScrollView>
      </View>

      {data && (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.heroCircleWrap}>
            <Image source={{ uri: data.image }} style={styles.heroCircle} />
          </View>

          <Text style={styles.eyebrow}>ORIGINAL INGREDIENT</Text>
          <Text style={styles.title}>{data.name}</Text>
          <Text style={styles.subtitle}>{data.subtitle}</Text>

          <Text style={styles.sectionLabel}>Artistic Swaps</Text>

          {data.swaps.map((swap) => (
            <Pressable
              key={swap.id}
              style={styles.swapCard}
              onPress={() => navigation.navigate('SwapDetail', { swap })}
            >
              <View style={styles.swapIconWrap}>
                <Text style={styles.swapEmoji}>{swap.icon}</Text>
              </View>
              <View style={styles.swapBody}>
                <View style={styles.swapHeaderRow}>
                  <Text style={styles.swapName}>{swap.name}</Text>
                  <Badge label={swap.tag} tone={swap.tone} />
                </View>
                <Text style={styles.swapDesc}>{swap.description}</Text>
                <View style={styles.ratioRow}>
                  <Ionicons name="git-compare-outline" size={12} color={colors.inkFaint} />
                  <Text style={styles.ratioText}>Ratio: {swap.ratio}</Text>
                </View>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function makeStyles(colors, shadow) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    recipeBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      backgroundColor: colors.sagePale,
    },
    recipeBannerText: {
      flex: 1,
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.xs,
      color: colors.sageDeep,
    },
    recipeBannerLink: {
      fontFamily: typography.body.bold,
      fontSize: typography.sizes.xs,
      color: colors.sageDeep,
      textDecorationLine: 'underline',
    },
    searchWrap: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      paddingBottom: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.hairline,
    },
    searchBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.paper,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.hairline,
      paddingHorizontal: spacing.lg,
      height: 46,
      marginBottom: spacing.md,
    },
    searchInput: {
      flex: 1,
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.base,
      color: colors.ink,
      height: '100%',
      outlineStyle: 'none',
    },
    chipRow: { gap: spacing.sm, paddingBottom: spacing.xs },
    chip: {
      paddingHorizontal: spacing.md,
      paddingVertical: 8,
      borderRadius: radius.pill,
      backgroundColor: colors.paper,
      borderWidth: 1,
      borderColor: colors.hairline,
    },
    chipActive: { backgroundColor: colors.sageDeep, borderColor: colors.sageDeep },
    chipText: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.sm,
      color: colors.inkSoft,
    },
    chipTextActive: { color: colors.onAccent },
    noMatches: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.inkFaint,
      paddingVertical: spacing.sm,
    },
    scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl, alignItems: 'center' },
    heroCircleWrap: {
      marginTop: spacing.lg,
      marginBottom: spacing.lg,
      ...shadow.card,
      borderRadius: 60,
    },
    heroCircle: {
      width: 96,
      height: 96,
      borderRadius: 48,
      borderWidth: 3,
      borderColor: colors.paper,
    },
    eyebrow: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.xs,
      color: colors.inkFaint,
      letterSpacing: 1,
      marginBottom: spacing.xs,
    },
    title: {
      fontFamily: typography.display.fontFamily,
      fontSize: 30,
      color: colors.ink,
      marginBottom: spacing.sm,
    },
    subtitle: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.base,
      color: colors.inkSoft,
      textAlign: 'center',
      lineHeight: 20,
      marginBottom: spacing.xxl,
      maxWidth: '90%',
    },
    sectionLabel: {
      alignSelf: 'flex-start',
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.lg,
      color: colors.ink,
      marginBottom: spacing.md,
    },
    swapCard: {
      flexDirection: 'row',
      alignSelf: 'stretch',
      backgroundColor: colors.paper,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.hairline,
      padding: spacing.md,
      gap: spacing.md,
      marginBottom: spacing.md,
    },
    swapIconWrap: {
      width: 52,
      height: 52,
      borderRadius: radius.md,
      backgroundColor: colors.creamDeep,
      alignItems: 'center',
      justifyContent: 'center',
    },
    swapEmoji: { fontSize: 24 },
    swapBody: { flex: 1 },
    swapHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 4,
    },
    swapName: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.md,
      color: colors.ink,
    },
    swapDesc: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.inkSoft,
      lineHeight: 18,
      marginBottom: spacing.sm,
    },
    ratioRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    ratioText: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.xs,
      color: colors.inkFaint,
    },
  });
}
