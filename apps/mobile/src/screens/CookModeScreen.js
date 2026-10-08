import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Alert,
  AppState,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { usePreventRemove } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import RecipeImage from '../components/RecipeImage';
import { notify } from '../utils/alert';
import { useCookHistory } from '../context/CookHistoryContext';
import { getCookHistoryErrorMessage } from '../api/cookHistoryErrors';
import {
  clampCookStepIndex,
  cookModeIngredientChecklist,
  cookModeSteps,
} from '../utils/recipe';
import {
  COOK_TIMER_STATES,
  createCookTimerEndAt,
  formatCookTimer,
  getCookTimerRemainingMs,
  validateCookTimerDuration,
} from '../utils/cookTimer';

const IDLE_TIMER = Object.freeze({
  status: COOK_TIMER_STATES.IDLE,
  durationMs: 0,
  remainingMs: 0,
  endAtMs: null,
});

const TIMER_INPUT_LIMITS = Object.freeze({ hours: 1, minutes: 2, seconds: 2 });

export default function CookModeScreen({ navigation, route }) {
  const params = route.params || {};
  const recipe = params.recipe || {};
  // Only a real backend recipe (RecipeDetailScreen's ApiRecipeDetail path)
  // has a Recipe id Cook History can record against. LegacyRecipeDetail's
  // mock recipes (ids like "r1") never carry this flag and can never be
  // tracked — there is no backend identity for them to attach an event to.
  const isApiRecipe = params.recipeSource === 'api';
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors);
  const { recordCompletion } = useCookHistory();
  const [isFinishing, setIsFinishing] = useState(false);
  // A ref, not just the `isFinishing` state: state updates are async, so two
  // onPress calls dispatched in the same tick could both read the same stale
  // `isFinishing` closure. The ref is set/read synchronously, so it is the
  // actual guard against a double-tap firing two POSTs; `isFinishing` only
  // drives the disabled/opacity UI.
  const isFinishingRef = useRef(false);
  const [timer, setTimer] = useState(IDLE_TIMER);
  const [timerInput, setTimerInput] = useState({ hours: '', minutes: '', seconds: '' });
  const [timerError, setTimerError] = useState('');
  const timerRef = useRef(IDLE_TIMER);
  const mountedRef = useRef(true);
  const intervalRef = useRef(null);
  const timerGenerationRef = useRef(0);
  const completionAnnouncedRef = useRef(false);
  const invalidLengthFieldsRef = useRef(new Set());
  const promptGenerationRef = useRef(0);
  const activePromptRef = useRef(null);

  const commitTimer = useCallback((nextTimer) => {
    timerRef.current = nextTimer;
    if (mountedRef.current) setTimer(nextTimer);
  }, []);

  const completeTimer = useCallback(() => {
    if (timerRef.current.status !== COOK_TIMER_STATES.RUNNING) return;
    commitTimer({
      ...timerRef.current,
      status: COOK_TIMER_STATES.COMPLETED,
      remainingMs: 0,
      endAtMs: null,
    });
    if (!completionAnnouncedRef.current && mountedRef.current) {
      completionAnnouncedRef.current = true;
      AccessibilityInfo.announceForAccessibility?.('Timer complete');
    }
  }, [commitTimer]);

  const reconcileTimer = useCallback(
    (nowMs = Date.now(), generation = timerGenerationRef.current) => {
      if (!mountedRef.current || generation !== timerGenerationRef.current) return;
      const current = timerRef.current;
      if (current.status !== COOK_TIMER_STATES.RUNNING) return;
      const remainingMs = getCookTimerRemainingMs(current.endAtMs, nowMs);
      if (remainingMs === null) return;
      if (remainingMs <= 0) {
        completeTimer();
        return;
      }
      if (remainingMs !== current.remainingMs) {
        commitTimer({ ...current, remainingMs });
      }
    },
    [commitTimer, completeTimer]
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      timerGenerationRef.current += 1;
      promptGenerationRef.current += 1;
      activePromptRef.current = null;
      timerRef.current = IDLE_TIMER;
      if (intervalRef.current !== null) clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (timer.status !== COOK_TIMER_STATES.RUNNING) return undefined;
    const generation = timerGenerationRef.current;
    const reconcileOwnedTimer = () => reconcileTimer(Date.now(), generation);
    reconcileOwnedTimer();
    intervalRef.current = setInterval(reconcileOwnedTimer, 250);
    return () => {
      if (intervalRef.current !== null) clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, [reconcileTimer, timer.endAtMs, timer.status]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (mountedRef.current && nextState === 'active') reconcileTimer();
    });
    return () => subscription.remove();
  }, [reconcileTimer]);

  const hasActiveTimer =
    timer.status === COOK_TIMER_STATES.RUNNING ||
    (timer.status === COOK_TIMER_STATES.PAUSED && timer.remainingMs > 0);

  usePreventRemove(hasActiveTimer, ({ data }) => {
    if (!mountedRef.current || activePromptRef.current !== null) return;

    const promptGeneration = promptGenerationRef.current + 1;
    promptGenerationRef.current = promptGeneration;
    activePromptRef.current = promptGeneration;
    const ownsPrompt = () =>
      mountedRef.current && activePromptRef.current === promptGeneration;
    const stay = () => {
      if (!ownsPrompt()) return;
      activePromptRef.current = null;
    };
    const discard = () => {
      if (!ownsPrompt()) return;
      activePromptRef.current = null;
      promptGenerationRef.current += 1;
      completionAnnouncedRef.current = true;
      invalidLengthFieldsRef.current.clear();
      timerGenerationRef.current += 1;
      commitTimer(IDLE_TIMER);
      setTimerInput({ hours: '', minutes: '', seconds: '' });
      setTimerError('');
      navigation.dispatch(data.action);
    };

    if (Platform.OS === 'web') {
      const accepted =
        typeof window !== 'undefined' &&
        window.confirm('Discard timer?\n\nLeaving Cook Mode will discard the active timer.');
      if (accepted) discard();
      else stay();
      return;
    }

    Alert.alert('Discard timer?', 'Leaving Cook Mode will discard the active timer.', [
      { text: 'Stay', style: 'cancel', onPress: stay },
      { text: 'Discard timer and leave', style: 'destructive', onPress: discard },
    ]);
  });

  const updateTimerInput = (field, value) => {
    const limit = TIMER_INPUT_LIMITS[field];
    if (value.length > limit) {
      invalidLengthFieldsRef.current.add(field);
      setTimerInput((current) => ({ ...current, [field]: '' }));
      setTimerError('Enter a duration from 00:00:01 to 03:00:00.');
      return;
    }
    invalidLengthFieldsRef.current.delete(field);
    setTimerInput((current) => ({ ...current, [field]: value }));
    setTimerError('');
  };

  const startTimer = () => {
    if (timerRef.current.status !== COOK_TIMER_STATES.IDLE) return;
    if (invalidLengthFieldsRef.current.size > 0) {
      setTimerError('Enter a duration from 00:00:01 to 03:00:00.');
      return;
    }
    const validation = validateCookTimerDuration(timerInput);
    if (!validation.ok) {
      setTimerError(validation.error);
      return;
    }
    const endAtMs = createCookTimerEndAt(Date.now(), validation.durationMs);
    if (endAtMs === null) {
      setTimerError('The timer could not start. Please try again.');
      return;
    }
    completionAnnouncedRef.current = false;
    timerGenerationRef.current += 1;
    setTimerError('');
    commitTimer({
      status: COOK_TIMER_STATES.RUNNING,
      durationMs: validation.durationMs,
      remainingMs: validation.durationMs,
      endAtMs,
    });
  };

  const pauseTimer = () => {
    const current = timerRef.current;
    if (current.status !== COOK_TIMER_STATES.RUNNING) return;
    const remainingMs = getCookTimerRemainingMs(current.endAtMs, Date.now());
    if (remainingMs === null) return;
    if (remainingMs <= 0) {
      completeTimer();
      return;
    }
    timerGenerationRef.current += 1;
    commitTimer({ ...current, status: COOK_TIMER_STATES.PAUSED, remainingMs, endAtMs: null });
  };

  const resumeTimer = () => {
    const current = timerRef.current;
    if (current.status !== COOK_TIMER_STATES.PAUSED || current.remainingMs <= 0) return;
    const endAtMs = createCookTimerEndAt(Date.now(), current.remainingMs);
    if (endAtMs === null) return;
    timerGenerationRef.current += 1;
    commitTimer({ ...current, status: COOK_TIMER_STATES.RUNNING, endAtMs });
  };

  const resetTimer = () => {
    completionAnnouncedRef.current = false;
    timerGenerationRef.current += 1;
    promptGenerationRef.current += 1;
    activePromptRef.current = null;
    invalidLengthFieldsRef.current.clear();
    commitTimer(IDLE_TIMER);
    setTimerInput({ hours: '', minutes: '', seconds: '' });
    setTimerError('');
  };

  const steps = useMemo(() => cookModeSteps(recipe), [recipe]);
  const cookServings =
    Number.isFinite(params.servings) && params.servings > 0
      ? params.servings
      : Number.isFinite(recipe.servings) && recipe.servings > 0
        ? recipe.servings
        : 1;
  const checklist = useMemo(
    () => cookModeIngredientChecklist(recipe, cookServings, params.ingredients),
    [recipe, cookServings, params.ingredients]
  );

  const [phase, setPhase] = useState('prep');
  const [checked, setChecked] = useState({});
  const [stepIndex, setStepIndex] = useState(0);

  const safeStepIndex = clampCookStepIndex(stepIndex, steps.length);
  const step = steps[safeStepIndex] || null;
  const isLast = steps.length > 0 && safeStepIndex === steps.length - 1;
  const gathered = checklist.reduce((count, _, index) => count + (checked[index] ? 1 : 0), 0);
  const allChecked = checklist.length > 0 && gathered === checklist.length;

  const toggleAll = () => {
    setChecked(allChecked ? {} : Object.fromEntries(checklist.map((_, index) => [index, true])));
  };

  const startCooking = () => {
    if (steps.length === 0) return;
    setStepIndex(0);
    setPhase('cook');
  };

  const goPrevious = () => {
    if (safeStepIndex === 0) {
      setPhase('prep');
      return;
    }
    setStepIndex((index) => clampCookStepIndex(index - 1, steps.length));
  };

  // A cook-history event is recorded ONLY here — the intentional Finish tap
  // at the end of the guided flow. Opening CookMode, viewing the prep
  // checklist, advancing a step, or exiting early must never create one.
  const finishCooking = async () => {
    if (isFinishingRef.current) return; // serializes Finish: a rapid double-tap is ignored, never a second POST.

    if (!isApiRecipe) {
      // No real backend recipe id to attach an event to — honest, not a
      // failure retry loop.
      notify('Nicely done!', 'Cook history isn’t available for this recipe.', () => navigation.goBack());
      return;
    }

    isFinishingRef.current = true;
    setIsFinishing(true);
    try {
      await recordCompletion({ recipeId: recipe.id, servings: cookServings });
      notify('Nicely done! 👏', `${recipe.title} is cooked. Enjoy your meal.`, () => navigation.goBack());
    } catch (err) {
      // Never pretend it saved: no navigation, no local "cooked" state — the
      // user stays on this step and can tap Finish again to retry.
      notify('Could not save', getCookHistoryErrorMessage(err));
    } finally {
      isFinishingRef.current = false;
      setIsFinishing(false);
    }
  };

  const goNext = () => {
    if (steps.length === 0) return;
    if (isLast) {
      finishCooking();
      return;
    }
    setStepIndex((index) => clampCookStepIndex(index + 1, steps.length));
  };

  const title = recipe.title || 'Cook Mode';
  const timerPanel = (
    <CookTimerPanel
      colors={colors}
      styles={styles}
      timer={timer}
      input={timerInput}
      error={timerError}
      onChangeInput={updateTimerInput}
      onStart={startTimer}
      onPause={pauseTimer}
      onResume={resumeTimer}
      onReset={resetTimer}
    />
  );

  if (phase === 'prep') {
    return (
      <View style={styles.root}>
        <CookHeader
          title={title}
          topInset={insets.top}
          colors={colors}
          styles={styles}
          onBack={() => navigation.goBack()}
        />

        {timerPanel}

        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.prepScroll}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.prepEyebrow}>Before you start</Text>
          <Text style={styles.prepTitle}>Gather your ingredients</Text>
          <Text style={styles.prepSub}>
            {cookServings} {cookServings === 1 ? 'serving' : 'servings'} · {gathered} of{' '}
            {checklist.length} ready
          </Text>

          <View style={styles.checkList}>
            {checklist.map((ingredient, index) => {
              const isChecked = !!checked[index];
              return (
                <Pressable
                  key={`${ingredient.name}-${index}`}
                  style={styles.checkRow}
                  onPress={() =>
                    setChecked((current) => ({ ...current, [index]: !current[index] }))
                  }
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: isChecked }}
                >
                  <View style={[styles.checkbox, isChecked && styles.checkboxOn]}>
                    {isChecked && (
                      <Ionicons name="checkmark" size={13} color={colors.onAccent} />
                    )}
                  </View>
                  <Text style={[styles.checkName, isChecked && styles.checkStruck]}>
                    {ingredient.name}
                  </Text>
                  {!!ingredient.qty && (
                    <Text style={[styles.checkQty, isChecked && styles.checkStruck]}>
                      {ingredient.qty}
                    </Text>
                  )}
                </Pressable>
              );
            })}

            {checklist.length === 0 && (
              <Text style={styles.emptyText}>No ingredient list is available for this recipe.</Text>
            )}
            {steps.length === 0 && (
              <Text style={styles.emptyText}>No cooking steps are available for this recipe.</Text>
            )}
          </View>
        </ScrollView>

        <View style={[styles.prepFooter, { paddingBottom: insets.bottom + spacing.lg }]}>
          {checklist.length > 0 && (
            <Pressable style={styles.checkAllBtn} onPress={toggleAll}>
              <Ionicons
                name={allChecked ? 'ellipse-outline' : 'checkmark-done'}
                size={15}
                color={colors.ink}
              />
              <Text style={styles.checkAllText}>{allChecked ? 'Uncheck all' : 'Check all'}</Text>
            </Pressable>
          )}
          <Pressable
            style={[styles.startBtn, steps.length === 0 && styles.startBtnDisabled]}
            onPress={startCooking}
            disabled={steps.length === 0}
          >
            <Ionicons name="play" size={15} color={colors.onAccent} />
            <Text style={styles.startText}>Start cooking</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <CookHeader
        title={title}
        topInset={insets.top}
        colors={colors}
        styles={styles}
        onBack={() => navigation.goBack()}
      />

      {timerPanel}

      <View style={styles.dotsRow}>
        {steps.map((item, index) => (
          <View
            key={item.order}
            style={[
              styles.dot,
              index === safeStepIndex && styles.dotCurrent,
              index < safeStepIndex && styles.dotDone,
            ]}
          >
            <Text
              style={[styles.dotText, index === safeStepIndex && styles.dotTextCurrent]}
            >
              {item.order}
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.normal}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.stepScroll}
          showsVerticalScrollIndicator={false}
        >
          <RecipeImage
            source={recipe.imageUrl ?? recipe.image}
            style={styles.stepPhoto}
            resizeMode="cover"
          />

          <Text style={styles.stepEyebrow}>Step {step.order}</Text>
          <Text style={styles.instruction}>{step.text}</Text>

        </ScrollView>

        <View style={[styles.btnRow, { paddingBottom: insets.bottom + spacing.lg }]}>
          <Pressable style={styles.secondaryBtn} onPress={goPrevious}>
            <Text style={styles.secondaryText}>Back</Text>
          </Pressable>
          <Pressable
            style={[styles.primaryBtn, styles.nextBtn, isLast && isFinishing && styles.nextBtnDisabled]}
            onPress={goNext}
            disabled={isLast && isFinishing}
          >
            <Text style={styles.primaryText}>{isLast ? 'Finish Cooking' : 'Next Step'}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function CookTimerPanel({
  colors,
  styles,
  timer,
  input,
  error,
  onChangeInput,
  onStart,
  onPause,
  onResume,
  onReset,
}) {
  const display = formatCookTimer(timer.remainingMs);
  const stateLabel = timer.status === COOK_TIMER_STATES.COMPLETED
    ? 'Timer complete'
    : `Timer ${timer.status.toLowerCase()}, ${display} remaining`;

  return (
    <View style={styles.timerPanel} accessibilityLabel="Cook timer">
      <View style={styles.timerHeadingRow}>
        <Ionicons
          name="time-outline"
          size={18}
          color={colors.stone}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
        />
        <Text style={styles.timerHeading}>Cook timer</Text>
      </View>

      {timer.status === COOK_TIMER_STATES.IDLE ? (
        <>
          <View style={styles.timerInputs}>
            {[
              ['hours', 'Hours', 1],
              ['minutes', 'Minutes', 2],
              ['seconds', 'Seconds', 2],
            ].map(([field, label, maxLength], index) => (
              <React.Fragment key={field}>
                {index > 0 && <Text style={styles.timerColon}>:</Text>}
                <View style={styles.timerInputGroup}>
                  <Text style={styles.timerInputLabel}>{label}</Text>
                  <TextInput
                    style={styles.timerInput}
                    value={input[field]}
                    onChangeText={(value) => onChangeInput(field, value)}
                    maxLength={maxLength}
                    keyboardType="number-pad"
                    inputMode="numeric"
                    placeholder={field === 'hours' ? '0' : '00'}
                    placeholderTextColor={colors.inkFaint}
                    accessibilityLabel={label}
                    accessibilityHint={`Enter ${label.toLowerCase()} for the cook timer`}
                  />
                </View>
              </React.Fragment>
            ))}
          </View>
          {!!error && (
            <Text style={styles.timerError} accessibilityRole="alert">
              {error}
            </Text>
          )}
          <Pressable
            style={styles.timerPrimaryButton}
            onPress={onStart}
            accessibilityRole="button"
            accessibilityLabel="Start timer"
          >
            <Text style={styles.timerPrimaryText}>Start timer</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={styles.timerReadout} accessibilityLabel={stateLabel}>
            {timer.status === COOK_TIMER_STATES.COMPLETED ? 'Timer complete' : display}
          </Text>
          <View style={styles.timerActions}>
            {timer.status === COOK_TIMER_STATES.RUNNING && (
              <Pressable
                style={styles.timerSecondaryButton}
                onPress={onPause}
                accessibilityRole="button"
                accessibilityLabel="Pause timer"
              >
                <Text style={styles.timerSecondaryText}>Pause</Text>
              </Pressable>
            )}
            {timer.status === COOK_TIMER_STATES.PAUSED && (
              <Pressable
                style={styles.timerPrimaryButton}
                onPress={onResume}
                accessibilityRole="button"
                accessibilityLabel="Resume timer"
              >
                <Text style={styles.timerPrimaryText}>Resume</Text>
              </Pressable>
            )}
            <Pressable
              style={styles.timerSecondaryButton}
              onPress={onReset}
              accessibilityRole="button"
              accessibilityLabel="Reset timer"
            >
              <Text style={styles.timerSecondaryText}>Reset</Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

function CookHeader({ title, topInset, colors, styles, onBack }) {
  return (
    <View style={[styles.header, { paddingTop: topInset + spacing.sm }]}>
      <Pressable
        style={styles.iconBtn}
        hitSlop={8}
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Back"
      >
        <Ionicons name="chevron-back" size={16} color={colors.ink} />
      </Pressable>
      <Text style={styles.headerTitle} numberOfLines={1}>
        {title}
      </Text>
    </View>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    flex: { flex: 1 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: spacing.xl,
      paddingBottom: spacing.sm,
    },
    iconBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.creamDeep,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerTitle: {
      flex: 1,
      fontFamily: typography.display.fontFamily,
      fontSize: 17,
      color: colors.ink,
    },
    prepScroll: {
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.md,
      paddingBottom: spacing.xxxl,
    },
    prepEyebrow: {
      fontFamily: typography.body.bold,
      fontSize: 11.5,
      letterSpacing: 1.1,
      textTransform: 'uppercase',
      color: colors.sageDeep,
    },
    prepTitle: {
      marginTop: 6,
      fontFamily: typography.display.fontFamily,
      fontSize: 24,
      color: colors.ink,
    },
    prepSub: {
      marginTop: 6,
      fontFamily: typography.body.fontFamily,
      fontSize: 12.5,
      color: colors.inkFaint,
    },
    checkList: {
      marginTop: spacing.lg,
      borderTopWidth: 1,
      borderTopColor: colors.hairline,
    },
    checkRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 13,
      borderBottomWidth: 1,
      borderBottomColor: colors.hairline,
    },
    checkbox: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 1.5,
      borderColor: colors.hairline,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxOn: { backgroundColor: colors.sageDeep, borderColor: colors.sageDeep },
    checkName: {
      flex: 1,
      fontFamily: typography.body.medium,
      fontSize: 14,
      color: colors.ink,
    },
    checkQty: {
      maxWidth: '38%',
      fontFamily: typography.body.fontFamily,
      fontSize: 13,
      color: colors.inkFaint,
      textAlign: 'right',
    },
    checkStruck: { textDecorationLine: 'line-through', color: colors.inkFaint },
    emptyText: {
      paddingVertical: spacing.md,
      fontFamily: typography.body.fontFamily,
      fontSize: 12.5,
      lineHeight: 19,
      color: colors.inkFaint,
    },
    prepFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.md,
      borderTopWidth: 1,
      borderTopColor: colors.hairline,
      backgroundColor: colors.cream,
    },
    checkAllBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      height: 50,
      paddingHorizontal: 16,
      borderRadius: radius.pill,
      backgroundColor: colors.creamDeep,
    },
    checkAllText: {
      fontFamily: typography.body.semibold,
      fontSize: 13,
      color: colors.ink,
    },
    startBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      height: 52,
      borderRadius: radius.pill,
      backgroundColor: colors.sageDeep,
    },
    startBtnDisabled: { opacity: 0.45 },
    startText: {
      fontFamily: typography.body.semibold,
      fontSize: 14,
      color: colors.onAccent,
    },
    dotsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.lg,
    },
    dot: {
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: colors.creamDeep,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dotCurrent: { backgroundColor: colors.sageDeep },
    dotDone: { backgroundColor: colors.sagePale },
    dotText: {
      fontFamily: typography.body.bold,
      fontSize: 11,
      color: colors.inkFaint,
    },
    dotTextCurrent: { color: colors.onAccent },
    normal: { flex: 1, paddingHorizontal: spacing.xl },
    stepScroll: { paddingBottom: spacing.xl },
    stepPhoto: {
      width: '100%',
      height: 220,
      borderRadius: 20,
      backgroundColor: colors.creamDeep,
    },
    stepEyebrow: {
      marginTop: spacing.xl,
      fontFamily: typography.body.bold,
      fontSize: 11.5,
      letterSpacing: 1.1,
      textTransform: 'uppercase',
      color: colors.sageDeep,
    },
    instruction: {
      marginTop: 10,
      fontFamily: typography.body.fontFamily,
      fontSize: 14,
      lineHeight: 22,
      color: colors.inkSoft,
    },
    timerPanel: {
      marginHorizontal: spacing.xl,
      marginBottom: spacing.sm,
      padding: spacing.md,
      borderWidth: 1,
      borderColor: colors.hairline,
      borderRadius: radius.lg,
      backgroundColor: colors.creamDeep,
    },
    timerHeadingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    timerHeading: {
      fontFamily: typography.body.semibold,
      fontSize: 13,
      color: colors.ink,
    },
    timerInputs: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'center',
      gap: 8,
      marginTop: spacing.sm,
    },
    timerInputGroup: { alignItems: 'center', gap: 4 },
    timerInputLabel: {
      fontFamily: typography.body.medium,
      fontSize: 11,
      color: colors.inkFaint,
    },
    timerInput: {
      width: 58,
      height: 44,
      borderWidth: 1,
      borderColor: colors.hairline,
      borderRadius: radius.md,
      backgroundColor: colors.cream,
      fontFamily: typography.body.semibold,
      fontSize: 18,
      color: colors.ink,
      textAlign: 'center',
    },
    timerColon: {
      paddingBottom: 10,
      fontFamily: typography.body.bold,
      fontSize: 18,
      color: colors.inkFaint,
    },
    timerError: {
      marginTop: spacing.sm,
      fontFamily: typography.body.medium,
      fontSize: 12,
      color: colors.error || '#9b2c2c',
      textAlign: 'center',
    },
    timerReadout: {
      marginTop: spacing.sm,
      fontFamily: typography.display.fontFamily,
      fontSize: 28,
      color: colors.ink,
      textAlign: 'center',
    },
    timerActions: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 10,
      marginTop: spacing.sm,
    },
    timerPrimaryButton: {
      minHeight: 42,
      minWidth: 110,
      paddingHorizontal: spacing.md,
      borderRadius: radius.pill,
      backgroundColor: colors.sageDeep,
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'center',
      marginTop: spacing.sm,
    },
    timerSecondaryButton: {
      minHeight: 42,
      minWidth: 100,
      paddingHorizontal: spacing.md,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.hairline,
      backgroundColor: colors.cream,
      alignItems: 'center',
      justifyContent: 'center',
    },
    timerPrimaryText: {
      fontFamily: typography.body.semibold,
      fontSize: 13,
      color: colors.onAccent,
    },
    timerSecondaryText: {
      fontFamily: typography.body.semibold,
      fontSize: 13,
      color: colors.ink,
    },
    btnRow: { flexDirection: 'row', gap: 12, width: '100%', maxWidth: 320 },
    secondaryBtn: {
      flex: 1,
      height: 50,
      borderRadius: radius.pill,
      backgroundColor: colors.creamDeep,
      alignItems: 'center',
      justifyContent: 'center',
    },
    secondaryText: {
      fontFamily: typography.body.semibold,
      fontSize: 14,
      color: colors.ink,
    },
    primaryBtn: {
      flex: 1,
      height: 50,
      borderRadius: radius.pill,
      backgroundColor: colors.sageDeep,
      alignItems: 'center',
      justifyContent: 'center',
    },
    nextBtn: { flex: 2 },
    nextBtnDisabled: { opacity: 0.45 },
    primaryText: {
      fontFamily: typography.body.semibold,
      fontSize: 14,
      color: colors.onAccent,
    },
  });
}
