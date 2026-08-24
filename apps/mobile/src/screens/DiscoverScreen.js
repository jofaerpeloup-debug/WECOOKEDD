import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import TopBar from '../components/TopBar';
import { recipes } from '../data/mockData';
import { useSavedRecipes } from '../context/SavedRecipesContext';

const FILTERS = ['All', 'Vegan', 'Quick', 'High-Protein'];

export default function DiscoverScreen({ navigation }) {
  const { colors, shadow } = useTheme();
  const styles = makeStyles(colors, shadow);
  const [active, setActive] = useState('All');
  const { isSaved, toggleSaved } = useSavedRecipes();

  const filtered =
    active === 'All' ? recipes : recipes.filter((r) => r.tags.includes(active));

  return (
    <View style={styles.root}>
      <TopBar mode="brand" onMenuPress={() => {}} />

      <View style={styles.filterRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
          {FILTERS.map((f) => {
            const isActive = f === active;
            return (
              <Pressable
                key={f}
                onPress={() => setActive(f)}
                style={[styles.filterPill, isActive && styles.filterPillActive]}
              >
                {isActive && f === 'All' && (
                  <Ionicons name="checkmark" size={13} color={colors.onAccent} style={{ marginRight: 4 }} />
                )}
                <Text style={[styles.filterText, isActive && styles.filterTextActive]}>{f}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.pageTitle}>Recipe Discovery</Text>

        {filtered.map((recipe) => (
          <Pressable
            key={recipe.id}
            style={styles.card}
            onPress={() => navigation.navigate('RecipeDetail', { recipe })}
          >
            <Image source={{ uri: recipe.image }} style={styles.cardImage} />
            <Pressable
              style={styles.saveIcon}
              hitSlop={8}
              onPress={() => toggleSaved(recipe.id)}
            >
              <Ionicons
                name={isSaved(recipe.id) ? 'bookmark' : 'bookmark-outline'}
                size={16}
                color={isSaved(recipe.id) ? colors.sageDeep : colors.onAccent}
              />
            </Pressable>
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle}>{recipe.title}</Text>
              <View style={styles.metaRow}>
                <View style={styles.metaItem}>
                  <Ionicons name="time-outline" size={13} color={colors.inkFaint} />
                  <Text style={styles.metaText}>{recipe.time}</Text>
                </View>
                <View style={styles.metaItem}>
                  <Ionicons name="star-outline" size={13} color={colors.inkFaint} />
                  <Text style={styles.metaText}>Score {recipe.score}</Text>
                </View>
              </View>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function makeStyles(colors, shadow) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    filterRow: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: colors.hairline,
    },
    filterPill: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingVertical: 8,
      borderRadius: radius.pill,
      backgroundColor: colors.paper,
      borderWidth: 1,
      borderColor: colors.hairline,
    },
    filterPillActive: { backgroundColor: colors.sageDeep, borderColor: colors.sageDeep },
    filterText: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.sm,
      color: colors.inkSoft,
    },
    filterTextActive: { color: colors.onAccent },
    scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
    pageTitle: {
      fontFamily: typography.display.fontFamily,
      fontSize: 22,
      color: colors.ink,
      marginBottom: spacing.lg,
    },
    card: {
      backgroundColor: colors.paper,
      borderRadius: radius.lg,
      overflow: 'hidden',
      marginBottom: spacing.xl,
      ...shadow.soft,
    },
    cardImage: { width: '100%', height: 190 },
    saveIcon: {
      position: 'absolute',
      top: spacing.md,
      right: spacing.md,
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: 'rgba(0,0,0,0.45)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    cardBody: { padding: spacing.lg },
    cardTitle: {
      fontFamily: typography.display.fontFamily,
      fontSize: 19,
      lineHeight: 24,
      color: colors.ink,
      marginBottom: spacing.sm,
    },
    metaRow: { flexDirection: 'row', gap: spacing.lg },
    metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    metaText: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.xs,
      color: colors.inkFaint,
    },
  });
}
