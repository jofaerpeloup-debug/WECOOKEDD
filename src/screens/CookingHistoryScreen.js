import React, { useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable } from 'react-native';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import TopBar from '../components/TopBar';
import AppImage from '../components/AppImage';
import EmptyState from '../components/EmptyState';
import FadeInView from '../components/FadeInView';
import { recipes } from '../data/mockData';
import { imageSource } from '../utils/image';
import { metaLine } from '../utils/recipe';
import { useCookedRecipes } from '../context/CookedRecipesContext';

// Day + date it was cooked, e.g. "Today, 3:42 PM" or "Mon, Sep 15" — not just
// a fading "2h ago" relative label, per the user's ask to show the actual
// date and day of week.
function fmtCookedDate(ts) {
  if (!ts) return 'Earlier';
  const d = new Date(ts);
  const isToday = d.toDateString() === new Date().toDateString();
  if (isToday) {
    return `Today, ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  }
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export default function CookingHistoryScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { history } = useCookedRecipes();

  const rows = useMemo(
    () =>
      history
        .map((h) => ({ ...h, recipe: recipes.find((r) => r.id === h.recipeId) }))
        .filter((h) => h.recipe),
    [history]
  );

  return (
    <View style={styles.root}>
      <TopBar title="Cooking History" onBack={() => navigation.goBack()} />
      <FlatList
        data={rows}
        keyExtractor={(h) => h.id}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          rows.length > 0 ? (
            <Text style={styles.subtitle}>
              {rows.length} {rows.length === 1 ? 'dish' : 'dishes'} cooked
            </Text>
          ) : null
        }
        renderItem={({ item, index }) => (
          <FadeInView delay={Math.min(index, 8) * 35}>
            <Pressable
              style={styles.row}
              onPress={() => navigation.navigate('RecipeDetail', { recipe: item.recipe })}
              accessibilityRole="button"
              accessibilityLabel={`${item.recipe.title}, cooked ${fmtCookedDate(item.ts)}`}
            >
              <AppImage source={imageSource(item.recipe.image)} style={styles.thumb} />
              <View style={{ flex: 1 }}>
                <Text style={styles.title} numberOfLines={1}>{item.recipe.title}</Text>
                <Text style={styles.meta}>{metaLine(item.recipe)}</Text>
              </View>
              <Text style={styles.when}>{fmtCookedDate(item.ts)}</Text>
            </Pressable>
          </FadeInView>
        )}
        ListEmptyComponent={
          <EmptyState
            icon="restaurant-outline"
            title="No cooking history yet"
            message="Finish a recipe in Cook Mode and it'll show up here."
          />
        }
      />
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
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: colors.paper,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.hairline,
      padding: spacing.md,
      marginBottom: spacing.sm,
    },
    thumb: { width: 52, height: 52, borderRadius: radius.md, backgroundColor: colors.creamDeep },
    title: { fontFamily: typography.body.semibold, fontSize: 14, color: colors.ink },
    meta: { fontFamily: typography.body.fontFamily, fontSize: 11.5, color: colors.inkFaint, marginTop: 3 },
    when: {
      fontFamily: typography.body.medium,
      fontSize: 11.5,
      color: colors.inkFaint,
      textAlign: 'right',
      maxWidth: 92,
    },
  });
}
