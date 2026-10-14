import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { typography, spacing, radius } from '../theme/theme';
import RecipeImage from './RecipeImage';
import { listRecipes } from '../api/recipeService';
import { createMealPlanEntry, getMealPlan } from '../api/mealPlanService';
import { getMealPlanErrorMessage } from '../api/mealPlanErrors';
import { formatMinutes } from '../utils/recipe';
import { difficultyLabel } from '../api/recipeOptions';
import { formatDayDate, startOfLocalWeek, weekDays } from '../utils/mealPlanDates';
import { notify } from '../utils/alert';

const PAGE_SIZE = 20;

export default function MealPlanSheet({ visible, onClose, day, recipeId, onAdded }) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors);
  const ownerId = user?.id || null;
  const pickRecipeMode = !!day;
  const currentDays = useMemo(() => weekDays(startOfLocalWeek(new Date())), [visible]);
  const [query, setQuery] = useState('');
  const [recipes, setRecipes] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [entries, setEntries] = useState([]);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const generationRef = useRef(0);
  const ownerRef = useRef(ownerId);

  useEffect(() => {
    ownerRef.current = ownerId;
    generationRef.current += 1;
    setRecipes([]);
    setEntries([]);
    setPagination(null);
    setQuery('');
    setError(null);
    setPending(false);
    setStatus(visible ? 'loading' : 'idle');
  }, [ownerId, visible, pickRecipeMode]);

  useEffect(() => {
    if (!visible || !ownerId) return undefined;
    const generation = ++generationRef.current;
    if (pickRecipeMode) setRecipes([]);
    setStatus('loading');
    const timer = setTimeout(async () => {
      try {
        if (pickRecipeMode) {
          const result = await listRecipes({ search: query.trim() || undefined, page: 1, limit: PAGE_SIZE, sort: 'titleAsc' });
          if (generation !== generationRef.current || ownerRef.current !== ownerId) return;
          setRecipes(result.recipes);
          setPagination(result.pagination);
        } else {
          const rows = await getMealPlan(currentDays[0].dateKey, currentDays[6].dateKey);
          if (generation !== generationRef.current || ownerRef.current !== ownerId) return;
          setEntries(rows);
        }
        setError(null);
        setStatus('ready');
      } catch (err) {
        if (generation !== generationRef.current || ownerRef.current !== ownerId) return;
        setError(getMealPlanErrorMessage(err));
        setStatus('error');
      }
    }, pickRecipeMode ? 250 : 0);
    return () => clearTimeout(timer);
  }, [visible, ownerId, pickRecipeMode, query, currentDays, reloadKey]);

  const loadMore = async () => {
    if (!pickRecipeMode || status !== 'ready' || !pagination || pagination.page >= pagination.totalPages) return;
    const generation = generationRef.current;
    setStatus('more');
    try {
      const next = await listRecipes({ search: query.trim() || undefined, page: pagination.page + 1, limit: PAGE_SIZE, sort: 'titleAsc' });
      if (generation !== generationRef.current || ownerRef.current !== ownerId) return;
      setRecipes((rows) => [...rows, ...next.recipes.filter((recipe) => !rows.some((old) => old.id === recipe.id))]);
      setPagination(next.pagination);
      setError(null);
      setStatus('ready');
    } catch (err) {
      if (generation !== generationRef.current || ownerRef.current !== ownerId) return;
      setError(getMealPlanErrorMessage(err));
      setStatus('ready');
    }
  };

  const add = async (dateKey, selectedRecipeId) => {
    if (pending || !ownerId) return;
    const requestOwner = ownerId;
    setPending(true);
    try {
      const entry = await createMealPlanEntry({ dateKey, recipeId: selectedRecipeId });
      if (ownerRef.current !== requestOwner) return;
      onAdded?.(entry);
      onClose();
    } catch (err) {
      if (ownerRef.current === requestOwner) notify('Couldn’t add meal', getMealPlanErrorMessage(err));
    } finally {
      if (ownerRef.current === requestOwner) setPending(false);
    }
  };

  const counts = useMemo(() => {
    const result = {};
    for (const entry of entries) result[entry.dateKey] = (result[entry.dateKey] || 0) + 1;
    return result;
  }, [entries]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.xl) }]}>
        <View style={styles.grabber} />
        <Text style={styles.title} accessibilityRole="header">{pickRecipeMode ? `Add a recipe to ${day.label}` : 'Add to which day this week?'}</Text>
        {pickRecipeMode ? (
          <View style={styles.flexBody}>
            <View style={styles.search}>
              <Ionicons name="search" size={14} color={colors.inkFaint} />
              <TextInput style={styles.searchInput} placeholder="Search recipes" placeholderTextColor={colors.inkFaint} value={query} onChangeText={setQuery} editable={!pending} />
            </View>
            {status === 'loading' ? <ActivityIndicator style={styles.state} color={colors.sageDeep} /> : null}
            {status === 'error' ? <StateMessage message={error} onRetry={() => setReloadKey((key) => key + 1)} styles={styles} /> : null}
            {(status === 'ready' || status === 'more') && recipes.length === 0 ? <Text style={styles.stateText}>No recipes found.</Text> : null}
            {status === 'ready' && error ? <Text style={styles.softError}>{error}</Text> : null}
            <ScrollView style={styles.list} onMomentumScrollEnd={loadMore} showsVerticalScrollIndicator={false}>
              {recipes.map((recipe) => (
                <Pressable key={recipe.id} style={styles.recipeRow} disabled={pending} onPress={() => add(day.dateKey, recipe.id)}>
                  <RecipeImage source={recipe.imageUrl} style={styles.thumb} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.recipeTitle}>{recipe.title}</Text>
                    <Text style={styles.recipeMeta}>{formatMinutes((recipe.prepTimeMinutes || 0) + (recipe.cookTimeMinutes || 0))} · {difficultyLabel(recipe.difficulty)}</Text>
                  </View>
                  {pending ? null : <Ionicons name="add-circle" size={20} color={colors.sageDeep} />}
                </Pressable>
              ))}
              {status === 'more' ? <ActivityIndicator style={styles.more} color={colors.sageDeep} /> : null}
            </ScrollView>
          </View>
        ) : (
          <View style={styles.flexBody}>
            {status === 'loading' ? <ActivityIndicator style={styles.state} color={colors.sageDeep} /> : null}
            {status === 'error' ? <StateMessage message={error} onRetry={() => setReloadKey((key) => key + 1)} styles={styles} /> : null}
            {status === 'ready' ? (
              <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
                {currentDays.map((item) => {
                  const count = counts[item.dateKey] || 0;
                  return (
                    <Pressable key={item.dateKey} style={styles.dayRow} disabled={pending} onPress={() => add(item.dateKey, recipeId)}>
                      <View><Text style={styles.dayLabel}>{item.label}</Text><Text style={styles.dayDate}>{formatDayDate(item.date)}</Text></View>
                      <Text style={styles.dayCount}>{count} {count === 1 ? 'meal' : 'meals'}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : null}
          </View>
        )}
        <Pressable style={styles.done} onPress={onClose} disabled={pending}><Text style={styles.doneText}>{pending ? 'Saving…' : 'Done'}</Text></Pressable>
      </View>
    </Modal>
  );
}

function StateMessage({ message, onRetry, styles }) {
  return <View style={styles.state}><Text style={styles.stateText}>{message}</Text><Pressable onPress={onRetry}><Text style={styles.retry}>Try Again</Text></Pressable></View>;
}

function makeStyles(colors) {
  return StyleSheet.create({
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.overlay },
    sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '82%', backgroundColor: colors.paper, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: spacing.xl, paddingTop: spacing.md },
    grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.hairline, marginBottom: spacing.lg },
    title: { fontFamily: typography.display.fontFamily, fontSize: 18, color: colors.ink, marginBottom: spacing.md },
    flexBody: { flexShrink: 1 },
    search: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.creamDeep, borderRadius: radius.md, paddingHorizontal: spacing.md, marginBottom: spacing.sm },
    searchInput: { flex: 1, height: 42, fontFamily: typography.body.fontFamily, fontSize: 13, color: colors.ink },
    list: { flexGrow: 0, flexShrink: 1 },
    recipeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.hairline },
    thumb: { width: 46, height: 46, borderRadius: 9, backgroundColor: colors.creamDeep },
    recipeTitle: { fontFamily: typography.body.semibold, fontSize: 13, color: colors.ink },
    recipeMeta: { fontFamily: typography.body.fontFamily, fontSize: 11, color: colors.inkFaint, marginTop: 2 },
    dayRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.hairline },
    dayLabel: { fontFamily: typography.body.semibold, fontSize: 14, color: colors.ink },
    dayDate: { fontFamily: typography.body.fontFamily, fontSize: 11, color: colors.inkFaint, marginTop: 2 },
    dayCount: { fontFamily: typography.body.fontFamily, fontSize: 12, color: colors.inkFaint },
    state: { paddingVertical: spacing.xxl, alignItems: 'center', gap: spacing.sm },
    stateText: { fontFamily: typography.body.fontFamily, fontSize: 13, color: colors.inkFaint, textAlign: 'center', paddingVertical: spacing.md },
    retry: { fontFamily: typography.body.semibold, color: colors.sageDeep },
    softError: { fontFamily: typography.body.fontFamily, fontSize: 12, color: colors.error, textAlign: 'center', paddingVertical: spacing.sm },
    more: { paddingVertical: spacing.md },
    done: { marginTop: spacing.md, height: 50, borderRadius: radius.pill, backgroundColor: colors.creamDeep, alignItems: 'center', justifyContent: 'center' },
    doneText: { fontFamily: typography.body.semibold, fontSize: 14, color: colors.ink },
  });
}
