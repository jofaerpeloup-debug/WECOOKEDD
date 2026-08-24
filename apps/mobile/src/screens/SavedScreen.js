import React from 'react';
import { View, Text, StyleSheet, ScrollView, Image, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import TopBar from '../components/TopBar';
import Button from '../components/Button';
import { useSavedRecipes } from '../context/SavedRecipesContext';

export default function SavedScreen({ navigation }) {
  const { colors, shadow } = useTheme();
  const styles = makeStyles(colors, shadow);
  const { savedRecipes, toggleSaved } = useSavedRecipes();
  const [featured, ...rest] = savedRecipes;

  return (
    <View style={styles.root}>
      <TopBar mode="brand" onMenuPress={() => {}} />

      {!featured ? (
        <View style={styles.emptyWrap}>
          <View style={styles.emptyIcon}>
            <Ionicons name="bookmark-outline" size={26} color={colors.sageDeep} />
          </View>
          <Text style={styles.emptyTitle}>No saved recipes yet</Text>
          <Text style={styles.emptySub}>
            Tap the bookmark icon on any recipe to save it here.
          </Text>
          <Button
            title="Discover Recipes"
            variant="primary"
            onPress={() => navigation.navigate('Discover')}
            style={{ marginTop: spacing.xl, alignSelf: 'stretch' }}
          />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <Pressable
            style={styles.featuredCard}
            onPress={() => navigation.navigate('RecipeDetail', { recipe: featured })}
          >
            <Image source={{ uri: featured.image }} style={styles.featuredImage} />
            <Pressable
              style={styles.saveIconFeatured}
              hitSlop={8}
              onPress={() => toggleSaved(featured.id)}
            >
              <Ionicons name="bookmark" size={16} color={colors.sageDeep} />
            </Pressable>
            <View style={styles.featuredTextWrap}>
              <Text style={styles.featuredTitle}>{featured.title}</Text>
              <View style={styles.metaRow}>
                <Ionicons name="time-outline" size={12} color={colors.inkFaint} />
                <Text style={styles.metaText}>{featured.time}</Text>
                <Text style={styles.metaDot}>·</Text>
                <Text style={styles.metaText}>{featured.tags[0] || 'Dinner'}</Text>
              </View>
            </View>
          </Pressable>

          <View style={styles.grid}>
            {rest.map((recipe) => (
              <Pressable
                key={recipe.id}
                style={styles.gridCard}
                onPress={() => navigation.navigate('RecipeDetail', { recipe })}
              >
                <Image source={{ uri: recipe.image }} style={styles.gridImage} />
                <Pressable
                  style={styles.saveIconGrid}
                  hitSlop={8}
                  onPress={() => toggleSaved(recipe.id)}
                >
                  <Ionicons name="bookmark" size={13} color={colors.sageDeep} />
                </Pressable>
                <View style={styles.gridTextWrap}>
                  <Text style={styles.gridTitle} numberOfLines={1}>
                    {recipe.title}
                  </Text>
                  <View style={styles.metaRow}>
                    <Ionicons name="time-outline" size={11} color={colors.inkFaint} />
                    <Text style={styles.metaTextSm}>{recipe.tags[0] || recipe.time}</Text>
                  </View>
                </View>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

function makeStyles(colors, shadow) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
    emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
    emptyIcon: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.sagePale,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.lg,
    },
    emptyTitle: {
      fontFamily: typography.display.fontFamily,
      fontSize: 20,
      color: colors.ink,
      marginBottom: spacing.sm,
    },
    emptySub: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.inkSoft,
      textAlign: 'center',
      lineHeight: 19,
      maxWidth: '80%',
    },
    featuredCard: {
      borderRadius: radius.lg,
      overflow: 'hidden',
      marginBottom: spacing.lg,
      backgroundColor: colors.paper,
      ...shadow.soft,
    },
    featuredImage: { width: '100%', height: 170 },
    saveIconFeatured: {
      position: 'absolute',
      top: spacing.md,
      right: spacing.md,
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: 'rgba(255,255,255,0.92)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    featuredTextWrap: { padding: spacing.lg },
    featuredTitle: {
      fontFamily: typography.display.fontFamily,
      fontSize: 19,
      color: colors.ink,
      marginBottom: spacing.sm,
    },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
    gridCard: {
      width: '47%',
      backgroundColor: colors.paper,
      borderRadius: radius.md,
      overflow: 'hidden',
      ...shadow.soft,
    },
    gridImage: { width: '100%', height: 110 },
    saveIconGrid: {
      position: 'absolute',
      top: spacing.sm,
      right: spacing.sm,
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: 'rgba(255,255,255,0.92)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    gridTextWrap: { padding: spacing.md },
    gridTitle: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.sm,
      color: colors.ink,
      marginBottom: 4,
    },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    metaText: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.xs,
      color: colors.inkFaint,
    },
    metaTextSm: {
      fontFamily: typography.body.fontFamily,
      fontSize: 10,
      color: colors.inkFaint,
    },
    metaDot: { color: colors.inkFaint, fontSize: 10 },
  });
}
