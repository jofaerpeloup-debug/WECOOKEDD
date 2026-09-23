import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import TopBar from '../components/TopBar';

// A minimal, ingredients-only view — no hero image, steps, rating, or
// servings stepper, just the plain list. For a fuller view (scale servings,
// add to grocery list, cook it), that's RecipeDetailScreen.
export default function RecipeIngredientsScreen({ navigation, route }) {
  const { recipe } = route.params;
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const ingredients = recipe.ingredients || [];

  return (
    <View style={styles.root}>
      <TopBar title={recipe.title} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.subtitle}>
          {ingredients.length} {ingredients.length === 1 ? 'ingredient' : 'ingredients'}
        </Text>
        {ingredients.map((ing, i) => (
          <View key={i} style={styles.row}>
            <View style={styles.rowLeft}>
              <Text style={styles.plus}>+</Text>
              <Text style={styles.name}>{ing.name}</Text>
            </View>
            {!!ing.qty && <Text style={styles.qty}>{ing.qty}</Text>}
          </View>
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
      color: colors.inkFaint,
      marginBottom: spacing.md,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 12,
      paddingHorizontal: spacing.md,
      backgroundColor: colors.paper,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.hairline,
      marginBottom: spacing.sm,
    },
    rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
    plus: { fontFamily: typography.body.semibold, fontSize: 15, color: colors.sageDeep },
    name: { fontFamily: typography.body.fontFamily, fontSize: 14, color: colors.ink, flex: 1 },
    qty: { fontFamily: typography.body.fontFamily, fontSize: 13, color: colors.inkFaint },
  });
}
