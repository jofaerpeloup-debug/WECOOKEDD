import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import TopBar from '../components/TopBar';
import Badge from '../components/Badge';
import EmptyState from '../components/EmptyState';
import AppImage from '../components/AppImage';
import { useTabBarScroll, TAB_BAR_CLEARANCE } from '../components/TabBarContext';
import { fuzzyScore } from '../utils/fuzzy';
import { tapLight, tapMedium } from '../utils/haptics';
import { ingredientSwaps } from '../data/mockData';
import { useShoppingList } from '../context/ShoppingListContext';
import { useAi } from '../context/AiContext';
import { useProfile } from '../context/ProfileContext';
import { askChef } from '../utils/aiChef';

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

// Compact form for the ratio chip; the full string always shows once expanded.
function shortRatio(raw) {
  const m = String(raw).match(/^\s*([\d/]+\s*:\s*[\d/]+)/);
  if (m) return m[1].replace(/\s/g, '');
  const head = String(raw).split(/[(=]/)[0].trim();
  return head.length <= 22 ? head : `${head.slice(0, 20)}…`;
}

function SwapCard({ swap, expanded, onToggle }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { addCustom } = useShoppingList();
  const [added, setAdded] = useState(false);

  const addToList = () => {
    if (added) return;
    tapMedium();
    addCustom(swap.name);
    setAdded(true);
  };

  return (
    <Pressable
      style={[styles.card, expanded && styles.cardOpen]}
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      accessibilityLabel={`${swap.name}, ${swap.tag}`}
    >
      <View style={styles.cardTop}>
        <View style={styles.iconTile}>
          <Text style={styles.emoji}>{swap.icon}</Text>
        </View>
        <View style={styles.cardBody}>
          <View style={styles.cardTitleRow}>
            <Text style={styles.swapName}>{swap.name}</Text>
            <Badge label={swap.tag} tone={swap.tone} />
          </View>
          <Text style={styles.swapDesc} numberOfLines={expanded ? undefined : 1}>
            {swap.description}
          </Text>
        </View>
      </View>

      <View style={styles.cardFoot}>
        <View style={styles.ratioChip}>
          <Ionicons name="swap-horizontal" size={12} color={colors.sageDeep} />
          <Text style={styles.ratioChipText}>{expanded ? swap.ratio : shortRatio(swap.ratio)}</Text>
        </View>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={colors.inkFaint}
        />
      </View>

      {expanded && (
        <Pressable
          style={[styles.addBtn, added && styles.addBtnDone]}
          onPress={addToList}
          accessibilityRole="button"
          accessibilityLabel={added ? `${swap.name} added to grocery list` : `Add ${swap.name} to grocery list`}
        >
          <Ionicons
            name={added ? 'checkmark' : 'cart-outline'}
            size={14}
            color={added ? colors.sageDeep : colors.onAccent}
          />
          <Text style={[styles.addBtnText, added && styles.addBtnTextDone]}>
            {added ? 'Added to list' : `Add ${swap.name.toLowerCase()} to list`}
          </Text>
        </Pressable>
      )}
    </Pressable>
  );
}

export default function IngredientStudioScreen({ navigation, route }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  // Rendered both as the "Swaps" bottom tab (no back arrow) and pushed from a
  // recipe's "Need a substitute?" row (back arrow returns to the recipe).
  const asTab = route.name === 'Swaps';
  const recipe = route.params?.recipe || null;

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

  const tabScroll = useTabBarScroll();
  const { apiKey, hasKey } = useAi();
  const { profile } = useProfile();
  const [query, setQuery] = useState('');
  const [browseAll, setBrowseAll] = useState(recipeKeys.length === 0);
  const [selectedKey, setSelectedKey] = useState(
    route.params?.ingredientKey || recipeKeys[0] || 'butter'
  );
  const [openSwap, setOpenSwap] = useState(null);

  // Fallback for an ingredient with no built-in swap card: ask the AI
  // instead, when a key is configured (same BYO-key "Ask the Chef" backend).
  const [aiAsking, setAiAsking] = useState(false);
  const [aiAnswer, setAiAnswer] = useState(null);
  const [aiError, setAiError] = useState('');

  const onQueryChange = (v) => {
    setQuery(v);
    setAiAnswer(null);
    setAiError('');
  };

  const askAiForSwap = async () => {
    const ingredient = query.trim();
    if (!ingredient || !hasKey) return;
    tapLight();
    setAiAsking(true);
    setAiError('');
    try {
      const { text } = await askChef({
        history: [
          {
            from: 'user',
            text: `I don't have "${ingredient}" and there's no built-in swap for it in the app. What are 2-3 good substitutes for ${ingredient} in Filipino home cooking? Keep it brief, with quick ratios or tips for each.`,
          },
        ],
        apiKey,
        profile,
      });
      setAiAnswer(text);
    } catch (e) {
      setAiError(e?.message || 'Something went wrong asking the AI.');
    } finally {
      setAiAsking(false);
    }
  };

  const matches = useMemo(() => {
    const q = query.trim();
    if (q) {
      return INGREDIENT_KEYS.map((key) => ({ key, score: fuzzyScore(q, ingredientSwaps[key].name) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((x) => x.key);
    }
    if (recipeKeys.length && !browseAll) return recipeKeys;
    return INGREDIENT_KEYS;
  }, [query, recipeKeys, browseAll]);

  const data = ingredientSwaps[selectedKey];
  const usingRecipeList = !query.trim() && recipeKeys.length > 0 && !browseAll;

  const pickIngredient = (key) => {
    tapLight();
    setSelectedKey(key);
    setOpenSwap(null);
    setQuery('');
  };

  const pickerLabel = query.trim()
    ? matches.length
      ? `${matches.length} ${matches.length === 1 ? 'match' : 'matches'}`
      : ''
    : usingRecipeList
      ? 'In this recipe'
      : 'Popular ingredients';

  return (
    <View style={styles.root}>
      <TopBar title="Ingredient Swaps" onBack={asTab ? undefined : () => navigation.goBack()} />

      {!!recipe && (
        <Pressable
          style={styles.recipeBanner}
          disabled={recipeKeys.length === 0}
          onPress={() => setBrowseAll((v) => !v)}
        >
          <Ionicons name="restaurant-outline" size={13} color={colors.sageDeep} />
          <Text style={styles.recipeBannerText} numberOfLines={1}>
            {recipeKeys.length === 0
              ? `No swaps mapped for ${recipe.title} yet`
              : usingRecipeList
                ? `Swaps for ${recipe.title}`
                : 'Browsing all ingredients'}
          </Text>
          {recipeKeys.length > 0 && (
            <Text style={styles.recipeBannerLink}>{browseAll ? 'This recipe' : 'Browse all'}</Text>
          )}
        </Pressable>
      )}

      <View style={styles.pickerWrap}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={16} color={colors.inkFaint} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search an ingredient…"
            placeholderTextColor={colors.inkFaint}
            value={query}
            onChangeText={onQueryChange}
            autoCapitalize="none"
            autoComplete="off"
          />
          {query.length > 0 && (
            <Pressable onPress={() => onQueryChange('')} hitSlop={8} accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={16} color={colors.inkFaint} />
            </Pressable>
          )}
        </View>

        {!!pickerLabel && <Text style={styles.pickerLabel}>{pickerLabel.toUpperCase()}</Text>}

        {matches.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {matches.map((key) => {
              const isActive = key === selectedKey;
              return (
                <Pressable
                  key={key}
                  onPress={() => pickIngredient(key)}
                  style={[styles.chip, isActive && styles.chipActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isActive }}
                  accessibilityLabel={ingredientSwaps[key].name}
                >
                  <Text style={[styles.chipText, isActive && styles.chipTextActive]}>
                    {ingredientSwaps[key].name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : (
          <View>
            <Text style={styles.noMatches}>No built-in swap for “{query.trim()}” yet.</Text>

            {hasKey ? (
              <>
                {!aiAnswer && !aiAsking && (
                  <Pressable style={styles.askAiBtn} onPress={askAiForSwap}>
                    <Ionicons name="sparkles-outline" size={14} color={colors.onAccent} />
                    <Text style={styles.askAiBtnText}>Ask AI for a swap</Text>
                  </Pressable>
                )}
                {aiAsking && (
                  <View style={styles.aiLoadingRow}>
                    <ActivityIndicator size="small" color={colors.sageDeep} />
                    <Text style={styles.aiLoadingText}>Asking the AI…</Text>
                  </View>
                )}
                {!!aiError && <Text style={styles.aiErrorText}>{aiError}</Text>}
                {!!aiAnswer && (
                  <View style={styles.aiAnswerCard}>
                    <View style={styles.aiAnswerHead}>
                      <Ionicons name="sparkles" size={13} color={colors.sageDeep} />
                      <Text style={styles.aiAnswerHeadText}>AI suggestion</Text>
                    </View>
                    <Text style={styles.aiAnswerText}>{aiAnswer}</Text>
                  </View>
                )}
              </>
            ) : (
              <Pressable
                style={styles.connectRow}
                onPress={() => navigation.navigate('AiSettings')}
              >
                <Text style={styles.connectText}>
                  Connect ChatGPT in Settings to get an AI-generated swap for ingredients like this.
                </Text>
              </Pressable>
            )}
          </View>
        )}
      </View>

      {data ? (
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          {...tabScroll}
        >
          <View style={styles.selectedHeader}>
            <AppImage source={{ uri: data.image }} style={styles.thumb} />
            <View style={{ flex: 1 }}>
              <Text style={styles.selectedTitle}>Swaps for {data.name}</Text>
              <Text style={styles.selectedMeta}>
                {data.swaps.length} {data.swaps.length === 1 ? 'option' : 'options'} · tap one for the
                ratio and tips
              </Text>
            </View>
          </View>

          {data.swaps.map((swap) => (
            <SwapCard
              key={swap.id}
              swap={swap}
              expanded={openSwap === swap.id}
              onToggle={() => {
                tapLight();
                setOpenSwap((cur) => (cur === swap.id ? null : swap.id));
              }}
            />
          ))}
        </ScrollView>
      ) : (
        <EmptyState
          icon="swap-horizontal"
          title="Pick an ingredient"
          message="Search above or choose one of the suggestions to see what you can use instead."
        />
      )}
    </View>
  );
}

function makeStyles(colors) {
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

    pickerWrap: {
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
      paddingHorizontal: spacing.md,
      height: 44,
    },
    searchInput: {
      flex: 1,
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.base,
      color: colors.ink,
      height: '100%',
      outlineStyle: 'none',
    },
    pickerLabel: {
      fontFamily: typography.body.bold,
      fontSize: 10.5,
      letterSpacing: 1,
      color: colors.inkFaint,
      marginTop: spacing.md,
      marginBottom: spacing.sm,
    },
    chipRow: { gap: spacing.sm, paddingRight: spacing.lg },
    chip: {
      paddingHorizontal: spacing.md,
      paddingVertical: 8,
      borderRadius: radius.pill,
      backgroundColor: colors.paper,
      borderWidth: 1,
      borderColor: colors.hairline,
    },
    chipActive: { backgroundColor: colors.sageDeep, borderColor: colors.sageDeep },
    chipText: { fontFamily: typography.body.medium, fontSize: typography.sizes.sm, color: colors.inkSoft },
    chipTextActive: { color: colors.onAccent },
    noMatches: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.inkFaint,
      marginTop: spacing.md,
      marginBottom: spacing.xs,
    },
    askAiBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      alignSelf: 'flex-start',
      paddingHorizontal: spacing.md,
      height: 38,
      borderRadius: radius.pill,
      backgroundColor: colors.sageDeep,
      marginTop: spacing.xs,
    },
    askAiBtnText: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.sm,
      color: colors.onAccent,
    },
    aiLoadingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: spacing.sm,
    },
    aiLoadingText: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.inkFaint,
    },
    aiErrorText: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.error,
      marginTop: spacing.sm,
    },
    aiAnswerCard: {
      marginTop: spacing.sm,
      padding: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.sagePale,
    },
    aiAnswerHead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: spacing.xs,
    },
    aiAnswerHeadText: {
      fontFamily: typography.body.bold,
      fontSize: 10.5,
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      color: colors.sageDeep,
    },
    aiAnswerText: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.ink,
      lineHeight: 20,
    },
    connectRow: { marginTop: spacing.xs },
    connectText: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.sageDeep,
      textDecorationLine: 'underline',
    },

    scroll: { padding: spacing.lg, paddingBottom: TAB_BAR_CLEARANCE },

    selectedHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      marginBottom: spacing.lg,
    },
    thumb: {
      width: 54,
      height: 54,
      borderRadius: radius.md,
      backgroundColor: colors.creamDeep,
    },
    selectedTitle: {
      fontFamily: typography.display.fontFamily,
      fontSize: 20,
      color: colors.ink,
    },
    selectedMeta: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.xs,
      color: colors.inkFaint,
      marginTop: 3,
      lineHeight: 16,
    },

    card: {
      backgroundColor: colors.paper,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.hairline,
      padding: spacing.md,
      marginBottom: spacing.sm,
    },
    cardOpen: { borderColor: colors.sageDeep },
    cardTop: { flexDirection: 'row', gap: spacing.md },
    iconTile: {
      width: 46,
      height: 46,
      borderRadius: radius.md,
      backgroundColor: colors.creamDeep,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emoji: { fontSize: 22 },
    cardBody: { flex: 1, gap: 4 },
    cardTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
    },
    swapName: {
      flexShrink: 1,
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.md,
      color: colors.ink,
    },
    swapDesc: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.inkSoft,
      lineHeight: 19,
    },
    cardFoot: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: spacing.sm,
    },
    ratioChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      backgroundColor: colors.sagePale,
      borderRadius: radius.pill,
      paddingHorizontal: 10,
      paddingVertical: 5,
      maxWidth: '82%',
    },
    ratioChipText: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.xs,
      color: colors.sageDeep,
    },
    addBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      marginTop: spacing.md,
      height: 40,
      borderRadius: radius.pill,
      backgroundColor: colors.sageDeep,
    },
    addBtnDone: {
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: colors.sageDeep,
    },
    addBtnText: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.sm,
      color: colors.onAccent,
    },
    addBtnTextDone: { color: colors.sageDeep },
  });
}
