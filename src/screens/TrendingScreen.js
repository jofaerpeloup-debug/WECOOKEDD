import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import TopBar from '../components/TopBar';
import AppImage from '../components/AppImage';
import FadeInView from '../components/FadeInView';
import { recipes } from '../data/mockData';
import { metaLine } from '../utils/recipe';
import { imageSource } from '../utils/image';

// A plain, dedicated list — no search field, no filter chips. Just the
// trending meals themselves, ranked by real rating + review count so the
// order actually means something (was previously just "See all" dumping
// onto the Search screen, which felt like a bare search form).
export default function TrendingScreen({ navigation, route }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const excludeId = route?.params?.excludeId;

  const trending = useMemo(() => {
    return recipes
      .filter((r) => r.id !== excludeId)
      .slice()
      .sort((a, b) => b.rating - a.rating || b.reviews - a.reviews);
  }, [excludeId]);

  return (
    <View style={styles.root}>
      <TopBar title="Trending Meals" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.subtitle}>
          {trending.length} recipes, ranked by rating and reviews.
        </Text>
        {trending.map((r, i) => (
          <FadeInView key={r.id} delay={Math.min(i, 8) * 35}>
            <Pressable
              style={styles.card}
              onPress={() => navigation.navigate('RecipeDetail', { recipe: r })}
              accessibilityRole="button"
              accessibilityLabel={r.title}
            >
              <Text style={styles.rank}>{i + 1}</Text>
              <AppImage source={imageSource(r.image)} style={styles.thumb} />
              <View style={{ flex: 1 }}>
                <Text style={styles.title} numberOfLines={1}>{r.title}</Text>
                <Text style={styles.meta}>{metaLine(r)}</Text>
              </View>
              <View style={styles.ratingPill}>
                <Ionicons name="star" size={11} color={colors.stone} />
                <Text style={styles.ratingText}>{r.rating.toFixed(1)}</Text>
              </View>
            </Pressable>
          </FadeInView>
        ))}
      </ScrollView>
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
    card: {
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
    rank: {
      width: 20,
      fontFamily: typography.display.fontFamily,
      fontSize: 15,
      color: colors.inkFaint,
      textAlign: 'center',
    },
    thumb: { width: 56, height: 56, borderRadius: radius.md, backgroundColor: colors.creamDeep },
    title: { fontFamily: typography.body.semibold, fontSize: 14, color: colors.ink },
    meta: { fontFamily: typography.body.fontFamily, fontSize: 11.5, color: colors.inkFaint, marginTop: 3 },
    ratingPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: radius.pill,
      backgroundColor: colors.sagePale,
    },
    ratingText: { fontFamily: typography.body.semibold, fontSize: 11.5, color: colors.sageDeep },
  });
}
