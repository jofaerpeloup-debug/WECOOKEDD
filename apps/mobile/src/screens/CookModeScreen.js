import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import RecipeImage from '../components/RecipeImage';
import { notify } from '../utils/alert';
import {
  clampCookStepIndex,
  cookModeIngredientChecklist,
  cookModeSteps,
} from '../utils/recipe';

export default function CookModeScreen({ navigation, route }) {
  const params = route.params || {};
  const recipe = params.recipe || {};
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors);

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

  const finishCooking = () => {
    notify('Nicely done!', 'Cook history is not available yet.', () => navigation.goBack());
  };

  const goNext = () => {
    if (steps.length === 0) return;
    if (isLast) {
      finishCooking();
      return;
    }
    setStepIndex((index) => clampCookStepIndex(index + 1, steps.length));
  };

  const showTimerGap = () => {
    notify('Timer unavailable', 'This recipe does not include a timer for this step.');
  };

  const title = recipe.title || 'Cook Mode';

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

          <Pressable
            style={styles.timerReadout}
            onPress={showTimerGap}
            accessibilityRole="button"
            accessibilityLabel="Step timer unavailable"
          >
            <Ionicons name="time-outline" size={16} color={colors.stone} />
            <Text style={styles.timerText}>Timer unavailable</Text>
          </Pressable>
        </ScrollView>

        <View style={[styles.btnRow, { paddingBottom: insets.bottom + spacing.lg }]}>
          <Pressable style={styles.secondaryBtn} onPress={goPrevious}>
            <Text style={styles.secondaryText}>Back</Text>
          </Pressable>
          <Pressable style={[styles.primaryBtn, styles.nextBtn]} onPress={goNext}>
            <Text style={styles.primaryText}>{isLast ? 'Finish Cooking' : 'Next Step'}</Text>
          </Pressable>
        </View>
      </View>
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
    timerReadout: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: 8,
      marginTop: 18,
      paddingVertical: 6,
    },
    timerText: {
      fontFamily: typography.display.fontFamily,
      fontSize: 20,
      color: colors.stone,
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
    primaryText: {
      fontFamily: typography.body.semibold,
      fontSize: 14,
      color: colors.onAccent,
    },
  });
}
