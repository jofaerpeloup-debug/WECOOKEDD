import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { useShoppingList } from '../context/ShoppingListContext';
import { useTheme } from '../theme/ThemeContext';
import { typography, spacing, radius } from '../theme/theme';
import RecipeImage from '../components/RecipeImage';
import MealPlanSheet from '../components/MealPlanSheet';
import MealPlanMoveSheet from '../components/MealPlanMoveSheet';
import MealPlanReminderSheet from '../components/MealPlanReminderSheet';
import { useMealReminders } from '../context/MealReminderContext';
import { clearMealPlanRange, deleteMealPlanReminder, getMealPlan, moveMealPlanEntry, putMealPlanReminder, removeMealPlanEntry } from '../api/mealPlanService';
import { getMealPlanErrorMessage, getMealPlanErrorState } from '../api/mealPlanErrors';
import { difficultyLabel } from '../api/recipeOptions';
import { formatMinutes } from '../utils/recipe';
import { formatDayDate, formatWeekRange, shiftWeek, startOfLocalWeek, weekDays } from '../utils/mealPlanDates';
import { confirm, notify } from '../utils/alert';
import { addPlannedRecipesToShoppingList } from '../utils/mealPlanShopping';

const DRAG_ACTIVATION_DISTANCE = 10;
const DRAG_PREVIEW_WIDTH = 220;

function gesturePoint(event, gestureState) {
  return {
    x: gestureState?.moveX ?? event?.nativeEvent?.pageX ?? event?.nativeEvent?.locationX ?? 0,
    y: gestureState?.moveY ?? event?.nativeEvent?.pageY ?? event?.nativeEvent?.locationY ?? 0,
  };
}

function isCompleteMovedEntry(returnedEntry, submittedEntry, targetDateKey) {
  return !!returnedEntry
    && returnedEntry.id === submittedEntry.id
    && returnedEntry.dateKey === targetDateKey
    && returnedEntry.recipeId === submittedEntry.recipeId
    && typeof returnedEntry.createdAt === 'string'
    && typeof returnedEntry.updatedAt === 'string'
    && typeof returnedEntry.isAvailable === 'boolean'
    && (returnedEntry.isAvailable
      ? !!returnedEntry.recipe && returnedEntry.recipe.id === returnedEntry.recipeId
      : returnedEntry.recipe === null);
}

function MealPlanDragHandle({
  colors,
  disabled,
  entry,
  label,
  onDragMove,
  onDragRelease,
  onDragStart,
  onDragTerminate,
  styles,
}) {
  const latestRef = useRef({ disabled, entry, onDragMove, onDragRelease, onDragStart, onDragTerminate });
  const grantedRef = useRef(false);
  latestRef.current = { disabled, entry, onDragMove, onDragRelease, onDragStart, onDragTerminate };

  const responder = useMemo(() => {
    const shouldStartDrag = (_event, gestureState) => {
      if (latestRef.current.disabled) return false;
      return Math.hypot(gestureState.dx || 0, gestureState.dy || 0) >= DRAG_ACTIVATION_DISTANCE;
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: shouldStartDrag,
      onMoveShouldSetPanResponderCapture: shouldStartDrag,
      onPanResponderGrant: (event, gestureState) => {
        const current = latestRef.current;
        grantedRef.current = !current.disabled && current.onDragStart(current.entry, gesturePoint(event, gestureState));
      },
      onPanResponderMove: (event, gestureState) => {
        if (grantedRef.current) latestRef.current.onDragMove(gesturePoint(event, gestureState));
      },
      onPanResponderRelease: (event, gestureState) => {
        if (grantedRef.current) latestRef.current.onDragRelease(gesturePoint(event, gestureState));
        grantedRef.current = false;
      },
      onPanResponderTerminate: () => {
        if (grantedRef.current) latestRef.current.onDragTerminate();
        grantedRef.current = false;
      },
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
    });
  }, []);

  return (
    <Pressable
      {...responder.panHandlers}
      style={styles.dragHandle}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Drag to another day in this week. Use Move to choose another week."
      accessibilityState={{ disabled }}
      testID={`meal-plan-drag-${entry.id}`}
    >
      <Ionicons name="reorder-three-outline" size={20} color={colors.sageDeep} />
      <Text style={styles.dragText}>Drag</Text>
    </Pressable>
  );
}

export default function MealPlanScreen({ navigation, route }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors);
  const { user } = useAuth();
  const reminders = useMealReminders();
  const { addRecipe, isMutating: shoppingMutating } = useShoppingList();
  const ownerId = user?.id || null;
  const [weekAnchor, setWeekAnchor] = useState(() => startOfLocalWeek(new Date()));
  const days = useMemo(() => weekDays(weekAnchor), [weekAnchor]);
  const startDate = days[0].dateKey;
  const endDate = days[6].dateKey;
  const range = `${startDate}:${endDate}`;
  const [data, setData] = useState({ ownerId: null, range: null, entries: [], status: 'loading', error: null });
  const [pickDay, setPickDay] = useState(null);
  const [moveEntry, setMoveEntry] = useState(null);
  const [reminderEntry, setReminderEntry] = useState(null);
  const [reminderPending, setReminderPending] = useState(false);
  const [reminderError, setReminderError] = useState(null);
  const [moveError, setMoveError] = useState(null);
  const [pendingEntryId, setPendingEntryId] = useState(null);
  const [clearing, setClearing] = useState(false);
  const [addingGroceries, setAddingGroceries] = useState(false);
  const [dragState, setDragState] = useState(null);
  const [dragError, setDragError] = useState(null);
  const generationRef = useRef(0);
  const moveAttemptRef = useRef(0);
  const mutationSequenceRef = useRef(0);
  const mountedRef = useRef(true);
  const ownerRef = useRef(ownerId);
  const rangeRef = useRef(range);
  const entriesRef = useRef([]);
  const mutationRef = useRef(null);
  const operationRef = useRef(null);
  const loadRef = useRef(null);
  const dragRef = useRef(null);
  const rootRef = useRef(null);
  const scrollRef = useRef(null);
  const rootFrameRef = useRef({ x: 0, y: 0, width: 0, height: 0 });
  const dayLayoutsRef = useRef({});
  const scrollFrameRef = useRef({ x: 0, y: 0, width: 0, height: 0 });
  const scrollOffsetRef = useRef(0);
  const dragPosition = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;

  useEffect(() => {
    ownerRef.current = ownerId;
    generationRef.current += 1;
    moveAttemptRef.current += 1;
    setData({ ownerId, range: null, entries: [], status: ownerId ? 'loading' : 'idle', error: null });
    setPickDay(null);
    setMoveEntry(null);
    setReminderEntry(null);
    setMoveError(null);
    setPendingEntryId(null);
    setClearing(false);
    setAddingGroceries(false);
    setDragState(null);
    setDragError(null);
    dragRef.current = null;
    operationRef.current = null;
    mutationRef.current = null;
  }, [ownerId]);

  useEffect(() => {
    const dateKey = route?.params?.dateKey;
    if (typeof dateKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return;
    const [year, month, day] = dateKey.split('-').map(Number);
    const target = new Date(year, month - 1, day);
    if (target.getFullYear() === year && target.getMonth() === month - 1 && target.getDate() === day) setWeekAnchor(startOfLocalWeek(target));
  }, [route?.params?.dateKey, route?.params?.entryId]);

  useEffect(() => {
    if (rangeRef.current !== range) {
      moveAttemptRef.current += 1;
      setMoveEntry(null);
      setMoveError(null);
      setPendingEntryId(null);
      setDragState(null);
      setDragError(null);
      setClearing(false);
      dragRef.current = null;
      operationRef.current = null;
      mutationRef.current = null;
      dayLayoutsRef.current = {};
    }
    rangeRef.current = range;
  }, [range]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      moveAttemptRef.current += 1;
      dragRef.current = null;
      operationRef.current = null;
      mutationRef.current = null;
    };
  }, []);

  const load = useCallback(async (options = null) => {
    if (!ownerId) return 'ignored';
    const preservedOperation = options?.preserveOperation || null;
    const generation = ++generationRef.current;
    const activeOperation = operationRef.current;
    if (activeOperation && activeOperation !== preservedOperation) {
      moveAttemptRef.current += 1;
      operationRef.current = null;
      if (mutationRef.current === activeOperation.claim) mutationRef.current = null;
      setPendingEntryId((current) => current === activeOperation.entryId ? null : current);
    }
    if (dragRef.current && dragRef.current.operation !== preservedOperation) {
      const activeDrag = dragRef.current;
      dragRef.current = null;
      if (mutationRef.current === activeDrag.claim) mutationRef.current = null;
      setDragState(null);
    }
    if (preservedOperation) preservedOperation.generation = generation;
    setData((old) => ({
      ownerId,
      range,
      entries: old.ownerId === ownerId && old.range === range ? old.entries : [],
      status: 'loading',
      error: null,
    }));
    try {
      const entries = await getMealPlan(startDate, endDate);
      if (generation !== generationRef.current || ownerRef.current !== ownerId) return 'ignored';
      setData({ ownerId, range, entries, status: 'ready', error: null });
      return 'success';
    } catch (err) {
      if (generation !== generationRef.current || ownerRef.current !== ownerId) return 'ignored';
      setData((old) => ({ ...old, ownerId, range, status: 'error', error: getMealPlanErrorMessage(err) }));
      return 'error';
    }
  }, [ownerId, range, startDate, endDate]);
  // PanResponder retains its original handlers. Always route a drag's stale
  // recovery through the current render's account/range-aware loader.
  loadRef.current = load;

  useFocusEffect(useCallback(() => { load(); void reminders.reconcile(); }, [load, reminders.reconcile]));

  const trusted = data.ownerId === ownerId && data.range === range;
  const entries = trusted ? data.entries : [];
  const status = trusted ? data.status : 'loading';
  entriesRef.current = entries;
  const grouped = useMemo(() => {
    const map = Object.fromEntries(days.map((day) => [day.dateKey, []]));
    for (const entry of entries) if (map[entry.dateKey]) map[entry.dateKey].push(entry);
    return map;
  }, [days, entries]);

  useEffect(() => {
    const activeDrag = dragRef.current;
    if (!activeDrag || !trusted || data.status !== 'ready') return;
    if (activeDrag.phase === 'pending' && operationRef.current === activeDrag.operation) return;
    const current = entries.find((entry) => entry.id === activeDrag.entry.id);
    if (current && current.dateKey === activeDrag.entry.dateKey && current.updatedAt === activeDrag.entry.updatedAt) return;
    moveAttemptRef.current += 1;
    if (operationRef.current === activeDrag.operation) operationRef.current = null;
    if (mutationRef.current === activeDrag.claim) mutationRef.current = null;
    dragRef.current = null;
    setPendingEntryId((pending) => pending === activeDrag.entry.id ? null : pending);
    setDragState(null);
  }, [data.status, entries, trusted]);

  useEffect(() => {
    if (!moveEntry || pendingEntryId || !trusted || data.status !== 'ready') return;
    const authoritative = entries.find((entry) => entry.id === moveEntry.id);
    if (authoritative && authoritative.updatedAt !== moveEntry.updatedAt) {
      setMoveEntry(authoritative);
    }
  }, [data.status, entries, moveEntry, pendingEntryId, trusted]);

  const openMove = (entry) => {
    if (mutationRef.current || dragRef.current || pendingEntryId || clearing) return;
    moveAttemptRef.current += 1;
    setDragError(null);
    setMoveError(null);
    setMoveEntry(entry);
  };

  const closeMove = () => {
    if (pendingEntryId) return;
    moveAttemptRef.current += 1;
    setMoveError(null);
    setMoveEntry(null);
  };

  const operationStillOwned = (operation) => (
    mountedRef.current
    && operationRef.current === operation
    && mutationRef.current === operation.claim
    && operation.attempt === moveAttemptRef.current
    && generationRef.current === operation.generation
    && ownerRef.current === operation.ownerId
    && rangeRef.current === operation.range
    && operation.entryId === operation.submittedEntry.id
    && operation.expectedUpdatedAt === operation.submittedEntry.updatedAt
  );

  const currentEntryMatches = (submittedEntry) => {
    const current = entriesRef.current.find((entry) => entry.id === submittedEntry.id);
    return !!current
      && current.dateKey === submittedEntry.dateKey
      && current.updatedAt === submittedEntry.updatedAt;
  };

  const runConditionalMove = async (submittedEntry, dateKey, claim, errorTarget, activeDrag = null, authority = {
    ownerId,
    range,
    generation: generationRef.current,
    startDate,
    endDate,
  }) => {
    const requestOwner = authority.ownerId;
    const requestRange = authority.range;
    const attempt = ++moveAttemptRef.current;
    const operation = {
      attempt,
      claim,
      entryId: submittedEntry.id,
      errorTarget,
      expectedUpdatedAt: submittedEntry.updatedAt,
      generation: authority.generation,
      ownerId: requestOwner,
      range: requestRange,
      submittedEntry,
    };
    operationRef.current = operation;
    if (activeDrag) {
      activeDrag.operation = operation;
      activeDrag.phase = 'pending';
      setDragState({ ...activeDrag });
      setDragError(null);
    } else {
      setMoveError(null);
    }
    setPendingEntryId(submittedEntry.id);
    try {
      const returnedEntry = await moveMealPlanEntry(submittedEntry.id, {
        dateKey,
        expectedUpdatedAt: submittedEntry.updatedAt,
      });
      if (!operationStillOwned(operation) || !currentEntryMatches(submittedEntry)) return;
      if (!isCompleteMovedEntry(returnedEntry, submittedEntry, dateKey)) {
        throw new Error('Something went wrong. Please try again.');
      }
      setData((old) => {
        if (old.ownerId !== requestOwner || old.range !== requestRange) return old;
        const current = old.entries.find((entry) => entry.id === submittedEntry.id);
        if (!current || current.updatedAt !== submittedEntry.updatedAt) return old;
        const inDisplayedWeek = returnedEntry.dateKey >= authority.startDate && returnedEntry.dateKey <= authority.endDate;
        return {
          ...old,
          entries: inDisplayedWeek
            ? old.entries.map((entry) => entry.id === submittedEntry.id ? returnedEntry : entry)
            : old.entries.filter((entry) => entry.id !== submittedEntry.id),
        };
      });
      if (errorTarget === 'sheet') {
        setMoveEntry(null);
        setMoveError(null);
      } else {
        setDragError(null);
      }
      void reminders.reconcile();
    } catch (err) {
      if (!operationStillOwned(operation) || !currentEntryMatches(submittedEntry)) return;
      const failure = getMealPlanErrorState(err);
      const setOperationError = errorTarget === 'sheet' ? setMoveError : setDragError;
      if (failure.kind === 'stale') {
        setOperationError('Your meal plan changed. Reloading the latest plan.');
        const reloadResult = await loadRef.current({ preserveOperation: operation });
        if (operationStillOwned(operation)) {
          setOperationError(reloadResult === 'success'
            ? 'Your meal plan changed. The latest plan is now loaded.'
            : 'Your meal plan changed. Reload the latest plan and try again.');
        }
      } else {
        setOperationError(failure.message);
      }
    } finally {
      if (operationStillOwned(operation)) {
        operationRef.current = null;
        mutationRef.current = null;
        setPendingEntryId((current) => current === submittedEntry.id ? null : current);
        if (activeDrag && dragRef.current === activeDrag) {
          dragRef.current = null;
          setDragState(null);
        }
      }
    }
  };

  const move = (dateKey) => {
    if (!moveEntry || mutationRef.current || dragRef.current || pendingEntryId || clearing || dateKey === moveEntry.dateKey) return;
    if (!currentEntryMatches(moveEntry)) return;
    const claim = { id: ++mutationSequenceRef.current, kind: 'move' };
    mutationRef.current = claim;
    runConditionalMove(moveEntry, dateKey, claim, 'sheet');
  };

  const updateDragPosition = useCallback((point) => {
    const rootFrame = rootFrameRef.current;
    dragPosition.setValue({
      x: point.x - rootFrame.x - (DRAG_PREVIEW_WIDTH / 2),
      y: point.y - rootFrame.y - 34,
    });
  }, [dragPosition]);

  const captureRootFrame = useCallback((event) => {
    const { width, height } = event.nativeEvent.layout;
    rootFrameRef.current = { x: 0, y: 0, width, height };
    rootRef.current?.measureInWindow?.((x, y, measuredWidth, measuredHeight) => {
      rootFrameRef.current = { x, y, width: measuredWidth, height: measuredHeight };
    });
  }, []);

  const captureScrollFrame = useCallback((event) => {
    const { x, y, width, height } = event.nativeEvent.layout;
    const rootFrame = rootFrameRef.current;
    scrollFrameRef.current = { x: rootFrame.x + x, y: rootFrame.y + y, width, height };
    scrollRef.current?.measureInWindow?.((measuredX, measuredY, measuredWidth, measuredHeight) => {
      scrollFrameRef.current = {
        x: measuredX,
        y: measuredY,
        width: measuredWidth,
        height: measuredHeight,
      };
    });
  }, []);

  const targetForPoint = useCallback((point) => {
    const frame = scrollFrameRef.current;
    if (
      point.x < frame.x
      || point.x > frame.x + frame.width
      || point.y < frame.y
      || point.y > frame.y + frame.height
    ) return null;
    const contentX = point.x - frame.x;
    const contentY = point.y - frame.y + scrollOffsetRef.current;
    const target = days.find((day) => {
      const layout = dayLayoutsRef.current[day.dateKey];
      return layout
        && contentX >= layout.x
        && contentX <= layout.x + layout.width
        && contentY >= layout.y
        && contentY <= layout.y + layout.height;
    });
    return target?.dateKey || null;
  }, [days]);

  const cancelDrag = useCallback(() => {
    const activeDrag = dragRef.current;
    if (!activeDrag || activeDrag.phase !== 'dragging') return;
    if (mutationRef.current === activeDrag.claim) mutationRef.current = null;
    dragRef.current = null;
    setDragState(null);
  }, []);

  const beginDrag = useCallback((entry, point) => {
    if (
      mutationRef.current
      || dragRef.current
      || ownerRef.current !== ownerId
      || rangeRef.current !== range
      || data.status !== 'ready'
    ) return false;
    const current = entriesRef.current.find((candidate) => candidate.id === entry.id);
    if (!current || current.dateKey !== entry.dateKey || current.updatedAt !== entry.updatedAt) return false;
    const claim = { id: ++mutationSequenceRef.current, kind: 'drag' };
    const activeDrag = {
      authority: {
        ownerId,
        range,
        generation: generationRef.current,
        startDate,
        endDate,
      },
      claim,
      entry: current,
      generation: generationRef.current,
      ownerId,
      phase: 'dragging',
      range,
      targetDateKey: null,
    };
    mutationRef.current = claim;
    dragRef.current = activeDrag;
    setDragError(null);
    updateDragPosition(point);
    const targetDateKey = targetForPoint(point);
    activeDrag.targetDateKey = targetDateKey;
    setDragState({ ...activeDrag });
    return true;
  }, [data.status, ownerId, range, targetForPoint, updateDragPosition]);

  const moveDrag = useCallback((point) => {
    const activeDrag = dragRef.current;
    if (!activeDrag || activeDrag.phase !== 'dragging') return;
    updateDragPosition(point);
    const targetDateKey = targetForPoint(point);
    if (targetDateKey !== activeDrag.targetDateKey) {
      activeDrag.targetDateKey = targetDateKey;
      setDragState({ ...activeDrag });
    }
  }, [targetForPoint, updateDragPosition]);

  const releaseDrag = useCallback((point) => {
    const activeDrag = dragRef.current;
    if (!activeDrag || activeDrag.phase !== 'dragging') return;
    updateDragPosition(point);
    const targetDateKey = targetForPoint(point);
    const valid = activeDrag.ownerId === ownerRef.current
      && activeDrag.range === rangeRef.current
      && activeDrag.generation === generationRef.current
      && mutationRef.current === activeDrag.claim
      && currentEntryMatches(activeDrag.entry)
      && !!targetDateKey
      && targetDateKey !== activeDrag.entry.dateKey;
    if (!valid) {
      cancelDrag();
      return;
    }
    activeDrag.targetDateKey = targetDateKey;
    activeDrag.claim.kind = 'move';
    runConditionalMove(activeDrag.entry, targetDateKey, activeDrag.claim, 'drag', activeDrag, activeDrag.authority);
  }, [cancelDrag, runConditionalMove, targetForPoint, updateDragPosition]);

  const remove = async (entryId) => {
    if (mutationRef.current || dragRef.current || pendingEntryId || clearing) return;
    const claim = { id: ++mutationSequenceRef.current, kind: 'remove' };
    mutationRef.current = claim;
    const requestOwner = ownerId;
    const requestRange = range;
    setPendingEntryId(entryId);
    try {
      const observed = entriesRef.current.find((entry) => entry.id === entryId);
      if (!observed?.updatedAt) throw new Error('Meal plan entry is unavailable.');
      await removeMealPlanEntry(entryId, observed.updatedAt);
      if (ownerRef.current !== requestOwner || rangeRef.current !== requestRange) return;
      await load();
      void reminders.reconcile();
    } catch (err) {
      if (ownerRef.current === requestOwner) notify('Couldn’t remove meal', getMealPlanErrorMessage(err));
      if (ownerRef.current === requestOwner) await load();
    } finally {
      if (ownerRef.current === requestOwner && mutationRef.current === claim) {
        mutationRef.current = null;
        setPendingEntryId(null);
      }
    }
  };

  const clearWeek = async () => {
    if (mutationRef.current || dragRef.current || clearing || pendingEntryId) return;
    const claim = { id: ++mutationSequenceRef.current, kind: 'clear' };
    mutationRef.current = claim;
    const requestOwner = ownerId;
    const requestRange = range;
    setClearing(true);
    try {
      const expectedEntries = [...entriesRef.current].map((entry) => ({ id: entry.id, expectedUpdatedAt: entry.updatedAt }))
        .sort((a, b) => a.id.localeCompare(b.id));
      await clearMealPlanRange(startDate, endDate, expectedEntries);
      if (ownerRef.current !== requestOwner || rangeRef.current !== requestRange) return;
      await load();
      void reminders.reconcile();
    } catch (err) {
      if (ownerRef.current === requestOwner && rangeRef.current === requestRange) {
        notify('Couldn’t clear meal plan', getMealPlanErrorMessage(err));
        await load();
      }
    } finally {
      if (ownerRef.current === requestOwner && mutationRef.current === claim) {
        mutationRef.current = null;
        setClearing(false);
      }
    }
  };

  const saveReminder = async (localTime, timeZone, turnOff = false) => {
    if (!reminderEntry || reminderPending || mutationRef.current) return;
    const submitted = entriesRef.current.find((entry) => entry.id === reminderEntry.id);
    if (!submitted) return;
    const claim = { id: ++mutationSequenceRef.current, kind: 'reminder' };
    mutationRef.current = claim;
    const requestOwner = ownerId;
    const requestRange = range;
    setReminderPending(true);
    setReminderError(null);
    try {
      const version = { expectedUpdatedAt: submitted.updatedAt, expectedReminderRevision: submitted.reminderRevision };
      const updated = turnOff
        ? await deleteMealPlanReminder(submitted.id, version)
        : await putMealPlanReminder(submitted.id, { ...version, localTime, timeZone });
      if (ownerRef.current !== requestOwner || rangeRef.current !== requestRange) return;
      setReminderEntry(updated);
      await load();
      void reminders.reconcile();
    } catch (error) {
      if (ownerRef.current === requestOwner) {
        setReminderError(getMealPlanErrorMessage(error));
        await load();
      }
    } finally {
      if (ownerRef.current === requestOwner && mutationRef.current === claim) {
        mutationRef.current = null;
        setReminderPending(false);
      }
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
  const dragActive = !!dragState;
  const mealPlanControlsDisabled = clearing || !!pendingEntryId || dragActive;
  return (
    <View ref={rootRef} style={styles.root} onLayout={captureRootFrame}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable style={styles.backBtn} hitSlop={8} onPress={() => navigation.goBack()}><Ionicons name="chevron-back" size={18} color={colors.ink} /></Pressable>
        <View style={{ flex: 1 }}><Text style={styles.title}>Meal Plan</Text><Text style={styles.subtitle}>{plannedCount} {plannedCount === 1 ? 'meal' : 'meals'} this week</Text></View>
        {plannedCount > 0 ? (
          <Pressable hitSlop={8} disabled={mealPlanControlsDisabled} onPress={() => confirm('Clear meal plan', 'Remove every planned meal in this week?', clearWeek, { confirmLabel: 'Clear', destructive: true })}>
            <Text style={styles.clear}>{clearing ? 'Clearing…' : 'Clear'}</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.weekNav}>
        <Pressable style={styles.weekButton} disabled={dragActive} onPress={() => setWeekAnchor((date) => shiftWeek(date, -1))} accessibilityLabel="Previous week" accessibilityState={{ disabled: dragActive }}><Ionicons name="chevron-back" size={18} color={colors.sageDeep} /></Pressable>
        <Text style={styles.weekLabel}>{formatWeekRange(days)}</Text>
        <Pressable style={styles.weekButton} disabled={dragActive} onPress={() => setWeekAnchor((date) => shiftWeek(date, 1))} accessibilityLabel="Next week" accessibilityState={{ disabled: dragActive }}><Ionicons name="chevron-forward" size={18} color={colors.sageDeep} /></Pressable>
      </View>

      {status === 'loading' && entries.length === 0 ? <ActivityIndicator style={styles.loading} color={colors.sageDeep} /> : null}
      {status === 'error' ? <Pressable style={styles.errorCard} onPress={load}><Text style={styles.errorText}>{data.error} Tap to retry.</Text></Pressable> : null}
      {dragError ? <View style={styles.errorCard} accessibilityLiveRegion="polite"><Text style={styles.errorText}>{dragError}</Text></View> : null}

      {status === 'ready' || entries.length > 0 ? <ScrollView
        ref={scrollRef}
        testID="meal-plan-scroll"
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        scrollEnabled={dragState?.phase !== 'dragging'}
        scrollEventThrottle={16}
        onLayout={captureScrollFrame}
        onScroll={(event) => { scrollOffsetRef.current = event.nativeEvent.contentOffset.y; }}
      >
        {days.map((day) => (
          <View
            key={day.dateKey}
            style={[
              styles.daySection,
              dragState ? styles.dayDropZone : null,
              dragState?.targetDateKey === day.dateKey && day.dateKey !== dragState.entry.dateKey ? styles.dayDropTarget : null,
            ]}
            testID={`meal-plan-day-${day.dateKey}`}
            onLayout={(event) => { dayLayoutsRef.current[day.dateKey] = event.nativeEvent.layout; }}
          >
            <View style={styles.dayHead}>
              <View><Text style={styles.dayName}>{day.label}</Text><Text style={styles.dayDate}>{formatDayDate(day.date)}</Text></View>
              <Pressable style={styles.addBtn} hitSlop={6} onPress={() => setPickDay(day)} disabled={status !== 'ready' || mealPlanControlsDisabled} accessibilityRole="button" accessibilityLabel={`Add recipe to ${day.label}`} accessibilityState={{ disabled: status !== 'ready' || mealPlanControlsDisabled }}><Ionicons name="add" size={16} color={colors.sageDeep} /></Pressable>
            </View>
            {grouped[day.dateKey].length === 0 ? (
              <Pressable style={styles.emptyDay} onPress={() => setPickDay(day)} disabled={status !== 'ready' || mealPlanControlsDisabled}><Text style={styles.emptyText}>Tap + to plan a meal</Text></Pressable>
            ) : grouped[day.dateKey].map((entry) => (
              <View key={entry.id} style={[styles.mealRow, dragState?.entry.id === entry.id ? styles.dragSource : null, route?.params?.entryId === entry.id ? styles.highlight : null]}>
                <View style={styles.mealTop}>
                  {entry.isAvailable ? (
                    <Pressable style={styles.mealMain} onPress={() => navigation.navigate('RecipeDetail', { recipeSource: 'api', recipeId: entry.recipeId, initialRecipe: entry.recipe })} accessibilityRole="button" accessibilityLabel={`Open ${entry.recipe.title}`}>
                      <RecipeImage source={entry.recipe.imageUrl} style={styles.thumb} />
                      <View style={{ flex: 1 }}><Text style={styles.mealTitle}>{entry.recipe.title}</Text><Text style={styles.mealMeta}>{formatMinutes((entry.recipe.prepTimeMinutes || 0) + (entry.recipe.cookTimeMinutes || 0))} · {difficultyLabel(entry.recipe.difficulty)}</Text></View>
                    </Pressable>
                  ) : (
                    <View style={styles.mealMain}><View style={styles.unavailableIcon}><Ionicons name="restaurant-outline" size={20} color={colors.inkFaint} /></View><View style={{ flex: 1 }}><Text style={styles.mealTitle}>Recipe unavailable</Text><Text style={styles.mealMeta}>This planned entry can still be moved or removed.</Text></View></View>
                  )}
                  <MealPlanDragHandle
                    colors={colors}
                    disabled={status !== 'ready' || (mealPlanControlsDisabled && !(dragState?.phase === 'dragging' && dragState.entry.id === entry.id))}
                    entry={entry}
                    label={entry.isAvailable ? `Drag ${entry.recipe.title}` : `Drag unavailable recipe planned for ${formatDayDate(day.date)}`}
                    onDragStart={beginDrag}
                    onDragMove={moveDrag}
                    onDragRelease={releaseDrag}
                    onDragTerminate={cancelDrag}
                    styles={styles}
                  />
                  <Pressable hitSlop={8} onPress={() => { setReminderError(null); setReminderEntry(entry); }}
                    disabled={mealPlanControlsDisabled} accessibilityRole="button" accessibilityLabel={`Reminder for ${entry.isAvailable ? entry.recipe.title : 'unavailable recipe'}`}>
                    <Ionicons name={entry.reminder ? 'notifications' : 'notifications-outline'} size={18} color={colors.sageDeep} />
                    <Text style={styles.moveText}>{entry.reminder ? 'Reminder' : 'Remind'}</Text>
                  </Pressable>
                  <Pressable
                    hitSlop={8}
                    onPress={() => openMove(entry)}
                    style={styles.move}
                    disabled={mealPlanControlsDisabled}
                    accessibilityRole="button"
                    accessibilityLabel={entry.isAvailable ? `Move ${entry.recipe.title}` : `Move unavailable recipe planned for ${formatDayDate(day.date)}`}
                    accessibilityState={{ disabled: mealPlanControlsDisabled }}
                  >
                    <Ionicons name="calendar-outline" size={16} color={colors.sageDeep} />
                    <Text style={styles.moveText}>Move</Text>
                  </Pressable>
                  <Pressable
                    hitSlop={8}
                    onPress={() => remove(entry.id)}
                    style={styles.remove}
                    disabled={mealPlanControlsDisabled}
                    accessibilityRole="button"
                    accessibilityLabel={entry.isAvailable ? `Remove ${entry.recipe.title}` : `Remove unavailable recipe planned for ${formatDayDate(day.date)}`}
                    accessibilityState={{ disabled: mealPlanControlsDisabled }}
                  >
                    {pendingEntryId === entry.id ? <ActivityIndicator size="small" color={colors.inkFaint} /> : <Ionicons name="remove-circle-outline" size={20} color={colors.inkFaint} />}
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        ))}
      </ScrollView> : null}

      {dragState ? (
        <Animated.View
          pointerEvents="none"
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          testID="meal-plan-drag-preview"
          style={[styles.dragPreview, { transform: dragPosition.getTranslateTransform() }]}
        >
          <Ionicons name="reorder-three-outline" size={20} color={colors.sageDeep} />
          <Text numberOfLines={1} style={styles.dragPreviewText}>
            {dragState.entry.isAvailable ? dragState.entry.recipe.title : 'Recipe unavailable'}
          </Text>
          {dragState.phase === 'pending' ? <ActivityIndicator size="small" color={colors.sageDeep} /> : null}
        </Animated.View>
      ) : null}

      {plannedCount > 0 ? (
        <View style={[styles.ctaWrap, { paddingBottom: insets.bottom + spacing.lg }]}>
          <Pressable style={styles.cta} onPress={addWeekToGroceries} disabled={addingGroceries || shoppingMutating}>
            {addingGroceries ? <ActivityIndicator size="small" color={colors.onAccent} /> : <Ionicons name="cart-outline" size={16} color={colors.onAccent} />}
            <Text style={styles.ctaText}>{addingGroceries ? 'Adding recipes…' : 'Add planned recipes to Grocery List'}</Text>
          </Pressable>
        </View>
      ) : null}
      <MealPlanSheet visible={!!pickDay} day={pickDay} onClose={() => setPickDay(null)} onAdded={() => { void load(); void reminders.reconcile(); }} />
      <MealPlanReminderSheet visible={!!reminderEntry} entry={reminderEntry} pending={reminderPending}
        error={reminderError} status={reminders.state} onClose={() => { if (!reminderPending) setReminderEntry(null); }}
        onSave={(localTime, timeZone) => saveReminder(localTime, timeZone)}
        onCancelReminder={() => saveReminder(null, null, true)} onRetry={() => reminders.reconcile()}
        onManualRetry={reminders.manualRetry} onRequestPermission={reminders.requestPermission}
        onOpenSettings={reminders.openSettings} />
      <MealPlanMoveSheet
        visible={!!moveEntry}
        entry={moveEntry}
        pending={pendingEntryId === moveEntry?.id}
        error={moveError}
        onClose={closeMove}
        onMove={move}
      />
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
    dayDropZone: { borderWidth: 1, borderColor: colors.hairline, borderStyle: 'dashed', borderRadius: radius.md, padding: spacing.sm },
    dayDropTarget: { borderWidth: 2, borderColor: colors.sageDeep, borderStyle: 'solid', backgroundColor: colors.sagePale },
    dayHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
    dayName: { fontFamily: typography.body.bold, fontSize: 11.5, letterSpacing: 1.1, textTransform: 'uppercase', color: colors.inkFaint },
    dayDate: { fontFamily: typography.body.fontFamily, fontSize: 11, color: colors.inkFaint, marginTop: 1 },
    addBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.sagePale, alignItems: 'center', justifyContent: 'center' },
    emptyDay: { borderWidth: 1, borderColor: colors.hairline, borderStyle: 'dashed', borderRadius: radius.md, paddingVertical: 14, alignItems: 'center' },
    emptyText: { fontFamily: typography.body.fontFamily, fontSize: 12.5, color: colors.inkFaint },
    mealRow: { backgroundColor: colors.creamDeep, borderRadius: 12, padding: 8, marginBottom: 8 },
    highlight: { borderWidth: 2, borderColor: colors.sageDeep },
    dragSource: { opacity: 0.45 },
    mealTop: { flexDirection: 'row', alignItems: 'center' },
    mealMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
    thumb: { width: 48, height: 48, borderRadius: 10, backgroundColor: colors.paper },
    unavailableIcon: { width: 48, height: 48, borderRadius: 10, backgroundColor: colors.paper, alignItems: 'center', justifyContent: 'center' },
    mealTitle: { fontFamily: typography.body.semibold, fontSize: 13, color: colors.ink },
    mealMeta: { fontFamily: typography.body.fontFamily, fontSize: 11, color: colors.inkFaint, marginTop: 2 },
    dragHandle: { width: 46, minHeight: 44, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center', gap: 1 },
    dragText: { fontFamily: typography.body.semibold, fontSize: 10, color: colors.sageDeep },
    dragPreview: { position: 'absolute', top: 0, left: 0, zIndex: 20, elevation: 8, width: DRAG_PREVIEW_WIDTH, minHeight: 60, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.sageDeep, borderRadius: radius.md, backgroundColor: colors.paper, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    dragPreviewText: { flex: 1, fontFamily: typography.body.semibold, fontSize: 13, color: colors.ink },
    move: { paddingHorizontal: 7, paddingVertical: 6, alignItems: 'center', gap: 1 },
    moveText: { fontFamily: typography.body.semibold, fontSize: 10, color: colors.sageDeep },
    remove: { padding: 6 },
    ctaWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.xl, paddingTop: spacing.md, backgroundColor: colors.cream, borderTopWidth: 1, borderTopColor: colors.hairline },
    cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, borderRadius: radius.pill, backgroundColor: colors.sageDeep },
    ctaText: { fontFamily: typography.body.semibold, fontSize: 14, color: colors.onAccent },
  });
}
