import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { useShoppingList } from '../context/ShoppingListContext';
import { useTheme } from '../theme/ThemeContext';
import { typography, spacing, radius } from '../theme/theme';
import RecipeImage from '../components/RecipeImage';
import MealPlanSheet from '../components/MealPlanSheet';
import { clearMealPlanRange, getMealPlan, removeMealPlanEntry } from '../api/mealPlanService';
import { getMealPlanErrorMessage } from '../api/mealPlanErrors';
import { difficultyLabel } from '../api/recipeOptions';
import { formatMinutes } from '../utils/recipe';
import { formatDayDate, formatWeekRange, shiftWeek, startOfLocalWeek, weekDays } from '../utils/mealPlanDates';
import { confirm, notify } from '../utils/alert';
import { addPlannedRecipesToShoppingList } from '../utils/mealPlanShopping';

export default function MealPlanScreen({ navigation }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors);
  const { user } = useAuth();
  const { addRecipe, isMutating: shoppingMutating } = useShoppingList();
  const ownerId = user?.id || null;
  const [weekAnchor, setWeekAnchor] = useState(() => startOfLocalWeek(new Date()));
  const days = useMemo(() => weekDays(weekAnchor), [weekAnchor]);
  const startDate = days[0].dateKey;
  const endDate = days[6].dateKey;
  const range = `${startDate}:${endDate}`;
  const [data, setData] = useState({ ownerId: null, range: null, entries: [], status: 'loading', error: null });
  const [pickDay, setPickDay] = useState(null);
  const [pendingEntryId, setPendingEntryId] = useState(null);
  const [clearing, setClearing] = useState(false);
  const [addingGroceries, setAddingGroceries] = useState(false);
  const generationRef = useRef(0);
  const ownerRef = useRef(ownerId);
  const rangeRef = useRef(range);

  useEffect(() => {
    ownerRef.current = ownerId;
    generationRef.current += 1;
    setData({ ownerId, range: null, entries: [], status: ownerId ? 'loading' : 'idle', error: null });
    setPickDay(null);
    setPendingEntryId(null);
    setClearing(false);
    setAddingGroceries(false);
  }, [ownerId]);

  useEffect(() => {
    rangeRef.current = range;
  }, [range]);

  const load = useCallback(async () => {
    if (!ownerId) return;
    const generation = ++generationRef.current;
    setData((old) => ({
      ownerId,
      range,
      entries: old.ownerId === ownerId && old.range === range ? old.entries : [],
      status: 'loading',
      error: null,
    }));
    try {
      const entries = await getMealPlan(startDate, endDate);
      if (generation !== generationRef.current || ownerRef.current !== ownerId) return;
      setData({ ownerId, range, entries, status: 'ready', error: null });
    } catch (err) {
      if (generation !== generationRef.current || ownerRef.current !== ownerId) return;
      setData((old) => ({ ...old, ownerId, range, status: 'error', error: getMealPlanErrorMessage(err) }));
    }
  }, [ownerId, range, startDate, endDate]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const trusted = data.ownerId === ownerId && data.range === range;
  const entries = trusted ? data.entries : [];
  const status = trusted ? data.status : 'loading';
  const grouped = useMemo(() => {
    const map = Object.fromEntries(days.map((day) => [day.dateKey, []]));
    for (const entry of entries) if (map[entry.dateKey]) map[entry.dateKey].push(entry);
    return map;
  }, [days, entries]);

  const remove = async (entryId) => {
    if (pendingEntryId || clearing) return;
    const requestOwner = ownerId;
    const requestRange = range;
    setPendingEntryId(entryId);
    try {
      await removeMealPlanEntry(entryId);
      if (ownerRef.current !== requestOwner || rangeRef.current !== requestRange) return;
      setData((old) => ({ ...old, entries: old.entries.filter((entry) => entry.id !== entryId) }));
    } catch (err) {
      if (ownerRef.current === requestOwner) notify('Couldn’t remove meal', getMealPlanErrorMessage(err));
    } finally {
      if (ownerRef.current === requestOwner) setPendingEntryId(null);
    }
  };

  const clearWeek = async () => {
    if (clearing || pendingEntryId) return;
    const requestOwner = ownerId;
    const requestRange = range;
    setClearing(true);
    try {
      await clearMealPlanRange(startDate, endDate);
      if (ownerRef.current !== requestOwner || rangeRef.current !== requestRange) return;
      setData((old) => ({ ...old, entries: [] }));
    } catch (err) {
      if (ownerRef.current === requestOwner) notify('Couldn’t clear meal plan', getMealPlanErrorMessage(err));
    } finally {
      if (ownerRef.current === requestOwner) setClearing(false);
    }
  };

  const addWeekToGroceries = async () => {
    if (addingGroceries || shoppingMutating) return;
    const requestOwner = ownerId;
    const availableIds = new Set(entries.filter((entry) => entry.isAvailable).map((entry) => entry.recipeId));
    const unavailableCount = entries.filter((entry) => !entry.isAvailable).length;
    if (availableIds.size === 0) {
      notify('Nothing to add', unavailableCount ? 'The planned recipes in this week are unavailable.' : 'Plan a recipe first.');
      return;
    }
    setAddingGroceries(true);
    const result = await addPlannedRecipesToShoppingList(
      entries,
      addRecipe,
      () => ownerRef.current === requestOwner
    );
    if (result.superseded || ownerRef.current !== requestOwner) return;
    const { recipeIds, succeeded, failed } = result;
    setAddingGroceries(false);
    if (failed === 0 && unavailableCount === 0) {
      notify('Added to Grocery List', `Ingredients from ${succeeded} planned ${succeeded === 1 ? 'recipe' : 'recipes'} were added.`);
    } else {
      notify('Grocery List partially updated', `${succeeded} of ${recipeIds.length} available planned recipes were added. ${failed} failed and ${unavailableCount} unavailable ${unavailableCount === 1 ? 'entry was' : 'entries were'} skipped. Successful earlier additions remain in your list.`);
    }
  };

  const plannedCount = entries.length;
  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable style={styles.backBtn} hitSlop={8} onPress={() => navigation.goBack()}><Ionicons name="chevron-back" size={18} color={colors.ink} /></Pressable>
        <View style={{ flex: 1 }}><Text style={styles.title}>Meal Plan</Text><Text style={styles.subtitle}>{plannedCount} {plannedCount === 1 ? 'meal' : 'meals'} this week</Text></View>
        {plannedCount > 0 ? (
          <Pressable hitSlop={8} disabled={clearing} onPress={() => confirm('Clear meal plan', 'Remove every planned meal in this week?', clearWeek, { confirmLabel: 'Clear', destructive: true })}>
            <Text style={styles.clear}>{clearing ? 'Clearing…' : 'Clear'}</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.weekNav}>
        <Pressable style={styles.weekButton} onPress={() => setWeekAnchor((date) => shiftWeek(date, -1))} accessibilityLabel="Previous week"><Ionicons name="chevron-back" size={18} color={colors.sageDeep} /></Pressable>
        <Text style={styles.weekLabel}>{formatWeekRange(days)}</Text>
        <Pressable style={styles.weekButton} onPress={() => setWeekAnchor((date) => shiftWeek(date, 1))} accessibilityLabel="Next week"><Ionicons name="chevron-forward" size={18} color={colors.sageDeep} /></Pressable>
      </View>

      {status === 'loading' && entries.length === 0 ? <ActivityIndicator style={styles.loading} color={colors.sageDeep} /> : null}
      {status === 'error' ? <Pressable style={styles.errorCard} onPress={load}><Text style={styles.errorText}>{data.error} Tap to retry.</Text></Pressable> : null}

      {status === 'ready' || entries.length > 0 ? <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {days.map((day) => (
          <View key={day.dateKey} style={styles.daySection}>
            <View style={styles.dayHead}>
              <View><Text style={styles.dayName}>{day.label}</Text><Text style={styles.dayDate}>{formatDayDate(day.date)}</Text></View>
              <Pressable style={styles.addBtn} hitSlop={6} onPress={() => setPickDay(day)} disabled={status !== 'ready'}><Ionicons name="add" size={16} color={colors.sageDeep} /></Pressable>
            </View>
            {grouped[day.dateKey].length === 0 ? (
              <Pressable style={styles.emptyDay} onPress={() => setPickDay(day)} disabled={status !== 'ready'}><Text style={styles.emptyText}>Tap + to plan a meal</Text></Pressable>
            ) : grouped[day.dateKey].map((entry) => (
              <View key={entry.id} style={styles.mealRow}>
                <View style={styles.mealTop}>
                  {entry.isAvailable ? (
                    <Pressable style={styles.mealMain} onPress={() => navigation.navigate('RecipeDetail', { recipeSource: 'api', recipeId: entry.recipeId, initialRecipe: entry.recipe })}>
                      <RecipeImage source={entry.recipe.imageUrl} style={styles.thumb} />
                      <View style={{ flex: 1 }}><Text style={styles.mealTitle}>{entry.recipe.title}</Text><Text style={styles.mealMeta}>{formatMinutes((entry.recipe.prepTimeMinutes || 0) + (entry.recipe.cookTimeMinutes || 0))} · {difficultyLabel(entry.recipe.difficulty)}</Text></View>
                    </Pressable>
                  ) : (
                    <View style={styles.mealMain}><View style={styles.unavailableIcon}><Ionicons name="restaurant-outline" size={20} color={colors.inkFaint} /></View><View style={{ flex: 1 }}><Text style={styles.mealTitle}>Recipe unavailable</Text><Text style={styles.mealMeta}>This planned entry can still be removed.</Text></View></View>
                  )}
                  <Pressable hitSlop={8} onPress={() => remove(entry.id)} style={styles.remove} disabled={!!pendingEntryId || clearing}>
                    {pendingEntryId === entry.id ? <ActivityIndicator size="small" color={colors.inkFaint} /> : <Ionicons name="remove-circle-outline" size={20} color={colors.inkFaint} />}
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        ))}
      </ScrollView> : null}

      {plannedCount > 0 ? (
        <View style={[styles.ctaWrap, { paddingBottom: insets.bottom + spacing.lg }]}>
          <Pressable style={styles.cta} onPress={addWeekToGroceries} disabled={addingGroceries || shoppingMutating}>
            {addingGroceries ? <ActivityIndicator size="small" color={colors.onAccent} /> : <Ionicons name="cart-outline" size={16} color={colors.onAccent} />}
            <Text style={styles.ctaText}>{addingGroceries ? 'Adding recipes…' : 'Add planned recipes to Grocery List'}</Text>
          </Pressable>
        </View>
      ) : null}
      <MealPlanSheet visible={!!pickDay} day={pickDay} onClose={() => setPickDay(null)} onAdded={load} />
    </View>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: spacing.xl, paddingBottom: spacing.sm },
    backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.creamDeep, alignItems: 'center', justifyContent: 'center' },
    title: { fontFamily: typography.display.fontFamily, fontSize: 20, color: colors.ink },
    subtitle: { fontFamily: typography.body.fontFamily, fontSize: 12, color: colors.inkFaint, marginTop: 1 },
    clear: { fontFamily: typography.body.semibold, fontSize: 13, color: colors.error },
    weekNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.md, paddingHorizontal: spacing.xl, paddingBottom: spacing.md },
    weekButton: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.sagePale, alignItems: 'center', justifyContent: 'center' },
    weekLabel: { minWidth: 170, textAlign: 'center', fontFamily: typography.body.semibold, fontSize: 13, color: colors.inkSoft },
    loading: { marginTop: spacing.xxl },
    errorCard: { marginHorizontal: spacing.xl, marginBottom: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.errorBg },
    errorText: { fontFamily: typography.body.fontFamily, fontSize: 12, color: colors.error, textAlign: 'center' },
    scroll: { paddingHorizontal: spacing.xl, paddingBottom: 110 },
    daySection: { marginBottom: spacing.xl },
    dayHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
    dayName: { fontFamily: typography.body.bold, fontSize: 11.5, letterSpacing: 1.1, textTransform: 'uppercase', color: colors.inkFaint },
    dayDate: { fontFamily: typography.body.fontFamily, fontSize: 11, color: colors.inkFaint, marginTop: 1 },
    addBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.sagePale, alignItems: 'center', justifyContent: 'center' },
    emptyDay: { borderWidth: 1, borderColor: colors.hairline, borderStyle: 'dashed', borderRadius: radius.md, paddingVertical: 14, alignItems: 'center' },
    emptyText: { fontFamily: typography.body.fontFamily, fontSize: 12.5, color: colors.inkFaint },
    mealRow: { backgroundColor: colors.creamDeep, borderRadius: 12, padding: 8, marginBottom: 8 },
    mealTop: { flexDirection: 'row', alignItems: 'center' },
    mealMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
    thumb: { width: 48, height: 48, borderRadius: 10, backgroundColor: colors.paper },
    unavailableIcon: { width: 48, height: 48, borderRadius: 10, backgroundColor: colors.paper, alignItems: 'center', justifyContent: 'center' },
    mealTitle: { fontFamily: typography.body.semibold, fontSize: 13, color: colors.ink },
    mealMeta: { fontFamily: typography.body.fontFamily, fontSize: 11, color: colors.inkFaint, marginTop: 2 },
    remove: { padding: 6 },
    ctaWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.xl, paddingTop: spacing.md, backgroundColor: colors.cream, borderTopWidth: 1, borderTopColor: colors.hairline },
    cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, borderRadius: radius.pill, backgroundColor: colors.sageDeep },
    ctaText: { fontFamily: typography.body.semibold, fontSize: 14, color: colors.onAccent },
  });
}
