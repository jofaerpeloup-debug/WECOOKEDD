import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, Pressable, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import TopBar from '../components/TopBar';
import { recipes } from '../data/mockData';
import { useSavedRecipes } from '../context/SavedRecipesContext';
import { imageSource } from '../utils/image';

const CATEGORIES = [
  { key: 'Breakfast', label: 'Breakfast', icon: 'sunny-outline' },
  { key: 'Lunch', label: 'Lunch', icon: 'restaurant-outline' },
  { key: 'Dinner', label: 'Dinner', icon: 'moon-outline' },
  { key: 'Dessert', label: 'Desserts', icon: 'ice-cream-outline' },
  { key: 'Vegies', label: 'Vegies', icon: 'leaf-outline' },
];

const VEGIE_TAGS = ['Vegan', 'Vegetarian'];

export default function DashboardScreen({ navigation }) {
  const { colors, shadow } = useTheme();
  const styles = makeStyles(colors, shadow);
  const { isSaved, toggleSaved } = useSavedRecipes();
  const [category, setCategory] = useState(null);
  const [query, setQuery] = useState('');
  const searching = query.trim().length > 0;

  const featured = useMemo(() => {
    if (searching) {
      const q = query.trim().toLowerCase();
      return recipes.filter(
        (r) =>
          r.title.toLowerCase().includes(q) ||
          r.ingredients.some((ing) => ing.toLowerCase().includes(q))
      );
    }
    if (!category) return recipes.slice(0, 6);
    if (category === 'Vegies') {
      return recipes.filter((r) => r.tags.some((t) => VEGIE_TAGS.includes(t)));
    }
    return recipes.filter((r) => r.tags.includes(category));
  }, [query, searching, category]);

  const selectCategory = (key) => {
    setQuery('');
    setCategory((prev) => (prev === key ? null : key));
  };

  const onSearchChange = (text) => {
    setQuery(text);
    if (text.trim()) setCategory(null);
  };

  return (
    <View style={styles.root}>
      <TopBar mode="brand" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.greeting}>Hello, Chef! 👋</Text>
        <Text style={styles.subGreeting}>What shall we cook today?</Text>

        <View style={styles.searchRow}>
          <View style={styles.searchBar}>
            <Ionicons name="search" size={17} color={colors.inkFaint} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search recipes, ingredients..."
              placeholderTextColor={colors.inkFaint}
              value={query}
              onChangeText={onSearchChange}
              autoCapitalize="none"
              autoComplete="off"
              returnKeyType="search"
            />
            {searching && (
              <Pressable onPress={() => setQuery('')} hitSlop={8}>
                <Ionicons name="close-circle" size={17} color={colors.inkFaint} />
              </Pressable>
            )}
          </View>
        </View>

        {!searching && (
          <>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionLabel}>Categories</Text>
              <Pressable onPress={() => navigation.navigate('Discover')}>
                <Text style={styles.seeAll}>See all</Text>
              </Pressable>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.categoryRow}
            >
              {CATEGORIES.map((c) => {
                const active = category === c.key;
                return (
                  <Pressable
                    key={c.key}
                    onPress={() => selectCategory(c.key)}
                    style={[styles.categoryChip, active && styles.categoryChipActive]}
                  >
                    <Ionicons name={c.icon} size={18} color={active ? colors.sageDeep : colors.inkSoft} />
                    <Text style={[styles.categoryLabel, active && styles.categoryLabelActive]}>
                      {c.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </>
        )}

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionLabel}>
            {searching ? `Results for "${query.trim()}"` : 'Featured Recipes'}
          </Text>
          {!searching && (
            <Pressable onPress={() => navigation.navigate('Discover')}>
              <Text style={styles.seeAll}>See all</Text>
            </Pressable>
          )}
        </View>
        {featured.length === 0 ? (
          <Text style={styles.emptyText}>
            {searching ? `No recipes match "${query.trim()}".` : 'No recipes in this category yet.'}
          </Text>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.featuredRow}
          >
            {featured.map((recipe) => {
              const saved = isSaved(recipe.id);
              return (
                <Pressable
                  key={recipe.id}
                  style={styles.featuredCard}
                  onPress={() => navigation.navigate('RecipeDetail', { recipe })}
                >
                  <View style={styles.featuredImageWrap}>
                    <Image source={imageSource(recipe.image)} style={styles.featuredImage} />
                    <Pressable style={styles.heartBtn} onPress={() => toggleSaved(recipe.id)} hitSlop={8}>
                      <Ionicons
                        name={saved ? 'heart' : 'heart-outline'}
                        size={15}
                        color={saved ? colors.sageDeep : colors.onAccent}
                      />
                    </Pressable>
                  </View>
                  <Text style={styles.featuredTitle} numberOfLines={2}>
                    {recipe.title}
                  </Text>
                  <View style={styles.featuredMeta}>
                    <Ionicons name="time-outline" size={12} color={colors.inkFaint} />
                    <Text style={styles.featuredTime}>{recipe.time}</Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        <View style={styles.toolsGrid}>
          <Pressable style={styles.toolCard} onPress={() => navigation.navigate('Saved')}>
            <View style={styles.toolIconWrap}>
              <Ionicons name="book" size={20} color={colors.sageDeep} />
            </View>
            <Text style={styles.toolLabel}>Recipe{'\n'}Collection</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

function makeStyles(colors, shadow) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
    greeting: {
      fontFamily: typography.display.fontFamily,
      fontSize: 24,
      color: colors.ink,
      marginTop: spacing.sm,
    },
    subGreeting: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.base,
      color: colors.inkSoft,
      marginTop: 2,
      marginBottom: spacing.lg,
    },
    searchRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xl },
    searchBar: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.paper,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.hairline,
      paddingHorizontal: spacing.lg,
      height: 46,
    },
    searchInput: {
      flex: 1,
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.base,
      color: colors.ink,
      outlineStyle: 'none',
    },
    sectionHeaderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.md,
    },
    sectionLabel: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.base,
      color: colors.ink,
    },
    seeAll: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.xs,
      color: colors.sageDeep,
    },
    categoryRow: { gap: spacing.sm, paddingBottom: spacing.xl, paddingRight: spacing.md },
    categoryChip: {
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      backgroundColor: colors.paper,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.hairline,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg,
      minWidth: 78,
    },
    categoryChipActive: {
      borderColor: colors.sageDeep,
      backgroundColor: colors.sagePale,
    },
    categoryLabel: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.xs,
      color: colors.inkSoft,
    },
    categoryLabelActive: { color: colors.sageDeep, fontFamily: typography.body.semibold },
    emptyText: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.inkFaint,
      marginBottom: spacing.xl,
    },
    featuredRow: { gap: spacing.md, paddingBottom: spacing.xl, paddingRight: spacing.md },
    featuredCard: {
      width: 160,
      backgroundColor: colors.paper,
      borderRadius: radius.lg,
      overflow: 'hidden',
      ...shadow.soft,
    },
    featuredImageWrap: { position: 'relative' },
    featuredImage: { width: '100%', height: 110 },
    heartBtn: {
      position: 'absolute',
      top: 8,
      right: 8,
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: 'rgba(0,0,0,0.45)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    featuredTitle: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.sm,
      color: colors.ink,
      marginTop: spacing.sm,
      marginHorizontal: spacing.sm,
      lineHeight: 16,
    },
    featuredMeta: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginHorizontal: spacing.sm,
      marginTop: 4,
      marginBottom: spacing.sm,
    },
    featuredTime: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.xs,
      color: colors.inkFaint,
    },
    toolsGrid: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.xl },
    toolCard: {
      flex: 1,
      backgroundColor: colors.paper,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.hairline,
      padding: spacing.lg,
      alignItems: 'center',
      gap: spacing.sm,
    },
    toolIconWrap: {
      width: 40,
      height: 40,
      borderRadius: 12,
      backgroundColor: colors.sagePale,
      alignItems: 'center',
      justifyContent: 'center',
    },
    toolLabel: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.sm,
      color: colors.ink,
      textAlign: 'center',
      lineHeight: 17,
    },
  });
}
