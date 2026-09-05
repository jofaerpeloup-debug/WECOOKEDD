import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, Pressable, Vibration } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import { fmtTimer, scaleQty, applySpice, spiceLevel } from '../utils/recipe';
import { SPICE_LEVELS } from '../data/mockData';
import { imageSource } from '../utils/image';
import { notify } from '../utils/alert';
import { useCookedRecipes } from '../context/CookedRecipesContext';

export default function CookModeScreen({ navigation, route }) {
  const { recipe, servings } = route.params;
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors);
  const { markCooked } = useCookedRecipes();

  const steps = recipe.steps || [];
  const cookServings = servings || recipe.servings || 4;
  const ratio = cookServings / (recipe.servings || 4);

  const [phase, setPhase] = useState('prep'); // 'prep' -> ingredient checklist, then 'cook'
  const [spice, setSpice] = useState(recipe.spice?.default || 'medium');

  const checklist = useMemo(() => {
    const scaled = (recipe.ingredients || []).map((ing) => ({
      ...ing,
      qty: scaleQty(ing.qty, ratio),
    }));
    return applySpice(scaled, recipe, spice).map((ing) => ({ name: ing.name, qty: ing.qty }));
  }, [recipe, ratio, spice]);
  const [checked, setChecked] = useState({});
  const [stepIndex, setStepIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(steps[0]?.seconds || 0);
  const [running, setRunning] = useState(false);
  const [immersive, setImmersive] = useState(false);
  const tick = useRef(null);
  const alertedFor = useRef(-1);

  const gathered = Object.values(checked).filter(Boolean).length;
  const allChecked = checklist.length > 0 && gathered === checklist.length;
  const toggleAll = () =>
    setChecked(allChecked ? {} : Object.fromEntries(checklist.map((_, i) => [i, true])));
  const startCooking = () => {
    setPhase('cook');
    setRunning(true);
  };

  const step = steps[stepIndex] || { title: '', instruction: '', seconds: 0 };
  const isLast = stepIndex >= steps.length - 1;
  const total = step.seconds || 1;
  const timerDone = (step.seconds || 0) > 0 && timeLeft === 0;

  useEffect(() => {
    tick.current = setInterval(() => {
      setTimeLeft((t) => (running && t > 0 ? t - 1 : t));
    }, 1000);
    return () => clearInterval(tick.current);
  }, [running]);

  // One-time "step timer done" nudge.
  useEffect(() => {
    if (timerDone && alertedFor.current !== stepIndex) {
      alertedFor.current = stepIndex;
      setRunning(false);
      try {
        Vibration.vibrate(400);
      } catch {}
      notify('Timer done', `Step ${stepIndex + 1}: ${step.title}`);
    }
  }, [timerDone, stepIndex]);

  const goStep = (idx) => {
    if (idx < 0) return navigation.goBack();
    setStepIndex(idx);
    setTimeLeft(steps[idx].seconds || 0);
    setRunning(true);
  };

  const finish = () => {
    markCooked(recipe.id);
    notify('Nicely done! 👏', `${recipe.title} is cooked. Enjoy your meal.`, () => navigation.goBack());
  };

  const onNext = () => (isLast ? finish() : goStep(stepIndex + 1));

  if (phase === 'prep') {
    return (
      <View style={styles.root}>
        <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
          <Pressable style={styles.iconBtn} hitSlop={8} onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" size={16} color={colors.ink} />
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>{recipe.title}</Text>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.prepScroll}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.prepEyebrow}>Before you start</Text>
          <Text style={styles.prepTitle}>Gather your ingredients</Text>
          <Text style={styles.prepSub}>
            {cookServings} {cookServings === 1 ? 'serving' : 'servings'} · {gathered} of {checklist.length} ready
          </Text>

          {recipe.spice && (
            <View style={styles.spiceCard}>
              <View style={styles.spiceHead}>
                <Text style={styles.spiceTitle}>Spice level</Text>
                <Text style={styles.spiceValue}>{spiceLevel(spice).label}</Text>
              </View>
              <View style={styles.flamePicker}>
                {SPICE_LEVELS.map((lvl) => {
                  const active = lvl.key === spice;
                  const lit = lvl.flames <= spiceLevel(spice).flames;
                  return (
                    <Pressable
                      key={lvl.key}
                      style={styles.flameBtn}
                      hitSlop={4}
                      onPress={() => setSpice(lvl.key)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={`${lvl.label} spice`}
                    >
                      <Ionicons
                        name={lit ? 'flame' : 'flame-outline'}
                        size={26}
                        color={lit ? colors.favorite : colors.inkFaint}
                      />
                      <Text style={[styles.flameLabel, active && styles.flameLabelOn]} numberOfLines={1}>
                        {lvl.short}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.spiceHint}>{spiceLevel(spice).hint}</Text>
            </View>
          )}

          <View style={styles.checkList}>
            {checklist.map((ing, i) => {
              const on = !!checked[i];
              return (
                <Pressable
                  key={i}
                  style={styles.checkRow}
                  onPress={() => setChecked((c) => ({ ...c, [i]: !c[i] }))}
                >
                  <View style={[styles.checkbox, on && styles.checkboxOn]}>
                    {on && <Ionicons name="checkmark" size={13} color={colors.onAccent} />}
                  </View>
                  <Text style={[styles.checkName, on && styles.checkStruck]}>{ing.name}</Text>
                  {!!ing.qty && (
                    <Text style={[styles.checkQty, on && styles.checkStruck]}>{ing.qty}</Text>
                  )}
                </Pressable>
              );
            })}
            {checklist.length === 0 && (
              <Text style={styles.prepSub}>No ingredient list for this recipe.</Text>
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
          <Pressable style={styles.startBtn} onPress={startCooking}>
            <Ionicons name="play" size={15} color={colors.onAccent} />
            <Text style={styles.startText}>Start cooking</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable style={styles.iconBtn} hitSlop={8} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={16} color={colors.ink} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{recipe.title}</Text>
      </View>

      <View style={styles.dotsRow}>
        {steps.map((_, i) => (
          <View
            key={i}
            style={[
              styles.dot,
              i === stepIndex && styles.dotCurrent,
              i < stepIndex && styles.dotDone,
            ]}
          >
            <Text style={[styles.dotText, i === stepIndex && styles.dotTextCurrent]}>{i + 1}</Text>
          </View>
        ))}
      </View>

      {immersive ? (
        <View style={styles.immersive}>
          <Pressable style={styles.ringWrap} onPress={() => setImmersive(false)}>
            <Svg width={220} height={220}>
              <Circle cx={110} cy={110} r={100} stroke={colors.sagePale} strokeWidth={10} fill="none" />
              <Circle
                cx={110}
                cy={110}
                r={100}
                stroke={colors.sageDeep}
                strokeWidth={10}
                fill="none"
                strokeLinecap="round"
                strokeDasharray={`${(timeLeft / total) * 2 * Math.PI * 100} ${2 * Math.PI * 100}`}
                transform="rotate(-90 110 110)"
              />
            </Svg>
            <View style={styles.ringCenter}>
              <Text style={styles.ringTime}>{fmtTimer(timeLeft)}</Text>
              <Text style={[styles.ringCaption, timerDone && { color: colors.success }]}>
                {timerDone ? 'DONE' : running ? 'RUNNING' : 'PAUSED'}
              </Text>
            </View>
          </Pressable>

          <View style={styles.immersiveText}>
            <Text style={styles.stepTitleSm}>{step.title}</Text>
            <Text style={styles.instructionSm}>{step.instruction}</Text>
          </View>

          <View style={styles.btnRow}>
            <Pressable style={styles.secondaryBtn} onPress={() => navigation.goBack()}>
              <Text style={styles.secondaryText}>Cancel</Text>
            </Pressable>
            <Pressable style={styles.primaryBtn} onPress={() => setRunning((r) => !r)}>
              <Text style={styles.primaryText}>{running ? 'Pause' : 'Resume'}</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.normal}>
          <Pressable style={styles.stepPhoto} onPress={() => setImmersive(true)}>
            <Image source={imageSource(recipe.image)} style={styles.stepPhotoImg} />
          </Pressable>

          <Text style={styles.stepEyebrow}>Step {stepIndex + 1}</Text>
          <Text style={styles.stepTitle}>{step.title}</Text>
          <Text style={styles.instruction}>{step.instruction}</Text>

          <Pressable style={styles.timerReadout} onPress={() => setImmersive(true)}>
            <Ionicons
              name={timerDone ? 'checkmark-circle' : 'time-outline'}
              size={16}
              color={timerDone ? colors.success : colors.stone}
            />
            <Text style={[styles.timerText, timerDone && { color: colors.success }]}>
              {timerDone ? 'Timer done' : fmtTimer(timeLeft)}
            </Text>
          </Pressable>

          <View style={{ flex: 1 }} />

          <View style={[styles.btnRow, { paddingBottom: insets.bottom + spacing.lg }]}>
            <Pressable
              style={styles.secondaryBtn}
              onPress={() => (stepIndex === 0 ? setPhase('prep') : goStep(stepIndex - 1))}
            >
              <Text style={styles.secondaryText}>Back</Text>
            </Pressable>
            <Pressable style={[styles.primaryBtn, { flex: 2 }]} onPress={onNext}>
              <Text style={styles.primaryText}>{isLast ? 'Finish Cooking' : 'Next Step'}</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
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
    headerTitle: { fontFamily: typography.display.fontFamily, fontSize: 17, color: colors.ink, flex: 1 },

    prepScroll: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.xxxl },
    prepEyebrow: {
      fontFamily: typography.body.bold,
      fontSize: 11.5,
      letterSpacing: 1.1,
      textTransform: 'uppercase',
      color: colors.sageDeep,
    },
    prepTitle: { fontFamily: typography.display.fontFamily, fontSize: 24, color: colors.ink, marginTop: 6 },
    prepSub: { fontFamily: typography.body.fontFamily, fontSize: 12.5, color: colors.inkFaint, marginTop: 6 },
    checkList: { marginTop: spacing.lg, borderTopWidth: 1, borderTopColor: colors.hairline },
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
    checkName: { flex: 1, fontFamily: typography.body.medium, fontSize: 14, color: colors.ink },
    checkQty: { fontFamily: typography.body.fontFamily, fontSize: 13, color: colors.inkFaint },
    checkStruck: { textDecorationLine: 'line-through', color: colors.inkFaint },

    spiceCard: {
      marginTop: spacing.lg,
      padding: spacing.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.hairline,
      backgroundColor: colors.paper,
    },
    spiceHead: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      marginBottom: spacing.md,
    },
    spiceTitle: { fontFamily: typography.body.bold, fontSize: 13, color: colors.ink },
    spiceValue: { fontFamily: typography.body.semibold, fontSize: 12, color: colors.favorite },
    flamePicker: { flexDirection: 'row', justifyContent: 'space-between' },
    flameBtn: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 2 },
    flameLabel: {
      fontFamily: typography.body.medium,
      fontSize: 9.5,
      color: colors.inkFaint,
      textAlign: 'center',
    },
    flameLabelOn: { fontFamily: typography.body.bold, color: colors.ink },
    spiceHint: {
      fontFamily: typography.body.fontFamily,
      fontSize: 11.5,
      color: colors.inkFaint,
      marginTop: spacing.md,
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
    checkAllText: { fontFamily: typography.body.semibold, fontSize: 13, color: colors.ink },
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
    startText: { fontFamily: typography.body.semibold, fontSize: 14, color: colors.onAccent },

    dotsRow: { flexDirection: 'row', gap: 6, paddingHorizontal: spacing.xl, paddingVertical: spacing.lg, flexWrap: 'wrap' },
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
    dotText: { fontFamily: typography.body.bold, fontSize: 11, color: colors.inkFaint },
    dotTextCurrent: { color: colors.onAccent },

    normal: { flex: 1, paddingHorizontal: spacing.xl },
    stepPhoto: { height: 220, borderRadius: 20, overflow: 'hidden', backgroundColor: colors.creamDeep },
    stepPhotoImg: { width: '100%', height: '100%' },
    stepEyebrow: {
      fontFamily: typography.body.bold,
      fontSize: 11.5,
      letterSpacing: 1.1,
      textTransform: 'uppercase',
      color: colors.sageDeep,
      marginTop: spacing.xl,
    },
    stepTitle: { fontFamily: typography.display.fontFamily, fontSize: 22, color: colors.ink, marginTop: 6 },
    instruction: { fontFamily: typography.body.fontFamily, fontSize: 14, lineHeight: 22, color: colors.inkSoft, marginTop: 10 },
    timerReadout: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 18, alignSelf: 'flex-start' },
    timerText: { fontFamily: typography.display.fontFamily, fontSize: 22, color: colors.stone },

    immersive: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, gap: spacing.xxl },
    ringWrap: { width: 220, height: 220, alignItems: 'center', justifyContent: 'center' },
    ringCenter: { position: 'absolute', alignItems: 'center' },
    ringTime: { fontFamily: typography.display.fontFamily, fontSize: 40, color: colors.ink },
    ringCaption: {
      fontFamily: typography.body.fontFamily,
      fontSize: 11,
      letterSpacing: 1.1,
      color: colors.inkFaint,
      marginTop: 4,
    },
    immersiveText: { alignItems: 'center', maxWidth: 300 },
    stepTitleSm: { fontFamily: typography.display.fontFamily, fontSize: 19, color: colors.ink, textAlign: 'center' },
    instructionSm: { fontFamily: typography.body.fontFamily, fontSize: 13, color: colors.inkSoft, textAlign: 'center', marginTop: 8 },

    btnRow: { flexDirection: 'row', gap: 12, width: '100%', maxWidth: 320 },
    secondaryBtn: {
      flex: 1,
      height: 50,
      borderRadius: radius.pill,
      backgroundColor: colors.creamDeep,
      alignItems: 'center',
      justifyContent: 'center',
    },
    secondaryText: { fontFamily: typography.body.semibold, fontSize: 14, color: colors.ink },
    primaryBtn: {
      flex: 1,
      height: 50,
      borderRadius: radius.pill,
      backgroundColor: colors.sageDeep,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryText: { fontFamily: typography.body.semibold, fontSize: 14, color: colors.onAccent },
  });
}
