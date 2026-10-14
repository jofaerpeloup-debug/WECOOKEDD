import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../context/AuthContext';
import TopBar from '../components/TopBar';
import { getRecipe } from '../api/recipeService';
import { getRecipeErrorMessage } from '../api/recipeErrors';
import { unitLabel } from '../api/recipeOptions';
import { formatQuantity } from '../utils/recipe';
import useRecipeScreenRefresh from '../hooks/useRecipeScreenRefresh';

const RECIPE_ID = /^[a-f\d]{24}$/i;

function ingredientRow(entry) {
  const name = typeof entry?.ingredient?.name === 'string' ? entry.ingredient.name.trim() : '';
  if (!name) return null;
  const quantity = entry.unit === 'toTaste' ? 'To taste' : [
    formatQuantity(entry.quantity),
    entry.unit ? unitLabel(entry.unit) : '',
  ].filter(Boolean).join(' ');
  return { name, quantity, note: entry.note, optional: entry.optional };
}

export default function RecipeIngredientsScreen({ navigation, route }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { status, sessionIdentity } = useAuth();
  const recipeId = route.params?.recipeId;
  const validId = typeof recipeId === 'string' && RECIPE_ID.test(recipeId);
  const ownerId = sessionIdentity?.ownerId;
  const sessionGeneration = sessionIdentity?.generation;
  const sessionRevision = sessionIdentity?.localSessionRevision;
  const requestKey = `${recipeId}|${ownerId}|${sessionGeneration}|${sessionRevision}`;
  const [attempt, setAttempt] = useState(0);
  const activeRequestKey = `${requestKey}|${attempt}`;
  const [result, setResult] = useState(null);

  useRecipeScreenRefresh(() => setAttempt((n) => n + 1));

  useEffect(() => {
    if (!validId || status !== 'authenticated' || !ownerId) return undefined;
    let active = true;
    setResult(null);
    getRecipe(recipeId).then(
      (recipe) => {
        if (!active) return;
        if (recipe?.id !== recipeId || typeof recipe.title !== 'string' || !Array.isArray(recipe.ingredients)) {
          setResult({ key: activeRequestKey, error: 'Could not load recipe. Please try again.' });
          return;
        }
        setResult({ key: activeRequestKey, recipe });
      },
      (error) => {
        if (active) setResult({
          key: activeRequestKey,
          unavailable: error?.isNotFound || error?.code === 'RECIPE_NOT_FOUND',
          error: getRecipeErrorMessage(error),
        });
      }
    );
    return () => { active = false; };
  }, [recipeId, activeRequestKey, validId, status, ownerId]);

  const current = result?.key === activeRequestKey ? result : null;
  const unavailable = !validId || current?.unavailable;
  const recipe = !unavailable && status === 'authenticated' && ownerId ? current?.recipe : null;
  const rows = Array.isArray(recipe?.ingredients)
    ? recipe.ingredients.map(ingredientRow).filter(Boolean)
    : [];

  return (
    <View style={styles.root}>
      <TopBar mode="back" title={recipe?.title || 'Recipe Ingredients'} onBack={() => navigation.goBack()} />
      {unavailable ? (
        <View style={styles.state}><Text style={styles.stateText}>This recipe isn't available anymore.</Text></View>
      ) : status !== 'authenticated' || !ownerId ? (
        <View style={styles.state}><Text style={styles.stateText}>Please log in to view ingredients.</Text></View>
      ) : !current ? (
        <View style={styles.state}><ActivityIndicator color={colors.sageDeep} accessibilityLabel="Loading ingredients" /></View>
      ) : current.error ? (
        <View style={styles.state}>
          <Text style={styles.stateText}>{current.error}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Try Again" onPress={() => setAttempt((n) => n + 1)} style={styles.retry}>
            <Text style={styles.retryText}>Try Again</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <Text style={styles.subtitle}>{rows.length} {rows.length === 1 ? 'ingredient' : 'ingredients'}</Text>
          {rows.length === 0 ? <Text style={styles.stateText}>No ingredients listed.</Text> : rows.map((row, index) => (
            <View key={index} style={styles.row}>
              <View style={styles.rowLeft}>
                <Text style={styles.minus}>−</Text>
                <View style={styles.nameWrap}>
                  <Text style={styles.name}>{row.name}</Text>
                  {row.note || row.optional ? <Text style={styles.note}>{[row.note, row.optional ? 'optional' : null].filter(Boolean).join(' · ')}</Text> : null}
                </View>
              </View>
              {row.quantity ? <Text style={styles.quantity}>{row.quantity}</Text> : null}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
    state: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
    stateText: { color: colors.inkSoft, fontFamily: typography.body.fontFamily, fontSize: typography.sizes.sm, textAlign: 'center' },
    retry: { minHeight: 48, paddingHorizontal: spacing.lg, justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.sageDeep },
    retryText: { color: colors.onAccent, fontFamily: typography.body.semibold },
    subtitle: { fontFamily: typography.body.fontFamily, fontSize: typography.sizes.sm, color: colors.inkSoft, marginBottom: spacing.md },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: spacing.md, backgroundColor: colors.paper, borderRadius: radius.md, borderWidth: 1, borderColor: colors.hairline, marginBottom: spacing.sm, gap: spacing.sm },
    rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
    nameWrap: { flex: 1 },
    minus: { fontFamily: typography.body.semibold, fontSize: 15, color: colors.sageDeep },
    name: { fontFamily: typography.body.fontFamily, fontSize: 14, color: colors.ink },
    note: { fontFamily: typography.body.fontFamily, fontSize: 12, color: colors.inkSoft },
    quantity: { fontFamily: typography.body.fontFamily, fontSize: 13, color: colors.inkSoft },
  });
}
