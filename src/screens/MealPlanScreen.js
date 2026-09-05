import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import MealPlanSheet from '../components/MealPlanSheet';
import TimePickerSheet, { fmtClock } from '../components/TimePickerSheet';
import { recipes } from '../data/mockData';
import { metaLine } from '../utils/recipe';
import { imageSource } from '../utils/image';
import { useMealPlan, PLAN_DAYS } from '../context/MealPlanContext';
import { useShoppingList } from '../context/ShoppingListContext';
import { remindersSupported, sendTestReminder } from '../utils/notifications';
import { notify, confirm } from '../utils/alert';

const fmtNextDate = (d) => {
  if (!d) return null;
  const now = new Date();
  const days = Math.round((d - now) / 86400000);
  const when =
    d.toDateString() === now.toDateString()
      ? 'today'
      : days <= 1
        ? 'tomorrow'
        : d.toLocaleDateString(undefined, { weekday: 'long' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${when} at ${time}`;
};

const byId = (id) => recipes.find((r) => r.id === id);

export default function MealPlanScreen({ navigation }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors);
  const { plan, removeFromPlan, clearAll, setMealTime, plannedCount } = useMealPlan();
  const { addFromRecipe } = useShoppingList();
  const [pickDay, setPickDay] = useState(null);
  const [timeFor, setTimeFor] = useState(null);

  const addAllToGrocery = () => {
    const ids = new Set(PLAN_DAYS.flatMap((d) => plan[d].map((it) => it.recipeId)));
    ids.forEach((id) => {
      const r = byId(id);
      if (r) addFromRecipe(r);
    });
    notify('Added to Grocery List', `Ingredients from ${ids.size} planned ${ids.size === 1 ? 'recipe' : 'recipes'}.`);
  };

  const chooseTime = async (slot) => {
    const target = timeFor;
    setTimeFor(null);
    if (!target) return;
    const time = slot ? { hour: slot.hour, minute: slot.minute } : null;
    const res = await setMealTime(target.day, target.recipeId, time);

    if (res.reason === 'permission') {
      notify(
        'Notifications are off',
        'Turn on notifications for WeCooked in your device settings, then set the reminder again.'
      );
    } else if (res.reason === 'error') {
      notify(
        "Couldn't set the reminder",
        `${res.message}\n\nScheduled reminders need the WeCooked app on a phone (a development build, not Expo Go / web).`
      );
    } else if (time && res.ok) {
      const clock = fmtClock(
        `${String(slot.hour).padStart(2, '0')}:${String(slot.minute).padStart(2, '0')}`
      );
      const next = fmtNextDate(res.nextDate);
      notify(
        'Reminder set',
        `You'll get a notification to cook ${target.title} every ${target.day} at ${clock}.` +
          (next ? `\n\nFirst one: ${next}.` : '')
      );
    }
  };

  const runTest = async () => {
    const ok = await sendTestReminder(timeFor?.title);
    setTimeFor(null);
    notify(
      ok ? 'Test notification sent' : 'Notifications are off',
      ok
        ? 'Lock your phone — a test notification should arrive in about 8 seconds. If it does, scheduled cook reminders will work too.'
        : 'Turn on notifications for WeCooked in your device settings first.'
    );
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable style={styles.backBtn} hitSlop={8} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={18} color={colors.ink} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Meal Plan</Text>
          <Text style={styles.subtitle}>{plannedCount} {plannedCount === 1 ? 'meal' : 'meals'} this week</Text>
        </View>
        {plannedCount > 0 && (
          <Pressable
            hitSlop={8}
            onPress={() => confirm('Clear meal plan', 'Remove every planned meal?', clearAll, { confirmLabel: 'Clear', destructive: true })}
          >
            <Text style={styles.clear}>Clear</Text>
          </Pressable>
        )}
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {PLAN_DAYS.map((day) => (
          <View key={day} style={styles.daySection}>
            <View style={styles.dayHead}>
              <Text style={styles.dayName}>{day}</Text>
              <Pressable style={styles.addBtn} hitSlop={6} onPress={() => setPickDay(day)}>
                <Ionicons name="add" size={16} color={colors.sageDeep} />
              </Pressable>
            </View>
            {plan[day].length === 0 ? (
              <Pressable style={styles.emptyDay} onPress={() => setPickDay(day)}>
                <Text style={styles.emptyText}>Tap + to plan a meal</Text>
              </Pressable>
            ) : (
              plan[day].map((item) => {
                const r = byId(item.recipeId);
                if (!r) return null;
                return (
                  <View key={item.recipeId} style={styles.mealRow}>
                    <View style={styles.mealTop}>
                      <Pressable
                        style={styles.mealMain}
                        onPress={() => navigation.navigate('RecipeDetail', { recipe: r })}
                      >
                        <Image source={imageSource(r.image)} style={styles.thumb} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.mealTitle}>{r.title}</Text>
                          <Text style={styles.mealMeta}>{metaLine(r)}</Text>
                        </View>
                      </Pressable>
                      <Pressable
                        hitSlop={8}
                        onPress={() => removeFromPlan(day, item.recipeId)}
                        style={styles.remove}
                      >
                        <Ionicons name="remove-circle-outline" size={20} color={colors.inkFaint} />
                      </Pressable>
                    </View>
                    {remindersSupported && (
                      <Pressable
                        style={[styles.reminderChip, item.time && styles.reminderChipOn]}
                        onPress={() =>
                          setTimeFor({ day, recipeId: item.recipeId, title: r.title, time: item.time })
                        }
                      >
                        <Ionicons
                          name={item.time ? 'notifications' : 'notifications-outline'}
                          size={12}
                          color={item.time ? colors.onAccent : colors.inkFaint}
                        />
                        <Text style={[styles.reminderText, item.time && styles.reminderTextOn]}>
                          {item.time ? `Cook at ${fmtClock(item.time)}` : 'Set a cook reminder'}
                        </Text>
                      </Pressable>
                    )}
                  </View>
                );
              })
            )}
          </View>
        ))}
      </ScrollView>

      {plannedCount > 0 && (
        <View style={[styles.ctaWrap, { paddingBottom: insets.bottom + spacing.lg }]}>
          <Pressable style={styles.cta} onPress={addAllToGrocery}>
            <Ionicons name="cart-outline" size={16} color={colors.onAccent} />
            <Text style={styles.ctaText}>Add planned recipes to Grocery List</Text>
          </Pressable>
        </View>
      )}

      <MealPlanSheet visible={!!pickDay} day={pickDay} onClose={() => setPickDay(null)} />
      <TimePickerSheet
        visible={!!timeFor}
        day={timeFor?.day}
        mealTitle={timeFor?.title}
        currentTime={timeFor?.time}
        onClose={() => setTimeFor(null)}
        onSelect={chooseTime}
        onTest={runTest}
      />
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
      paddingBottom: spacing.md,
    },
    backBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.creamDeep,
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: { fontFamily: typography.display.fontFamily, fontSize: 20, color: colors.ink },
    subtitle: { fontFamily: typography.body.fontFamily, fontSize: 12, color: colors.inkFaint, marginTop: 1 },
    clear: { fontFamily: typography.body.semibold, fontSize: 13, color: colors.error },
    scroll: { paddingHorizontal: spacing.xl, paddingBottom: 110 },
    daySection: { marginBottom: spacing.xl },
    dayHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
    dayName: {
      fontFamily: typography.body.bold,
      fontSize: 11.5,
      letterSpacing: 1.1,
      textTransform: 'uppercase',
      color: colors.inkFaint,
    },
    addBtn: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: colors.sagePale,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptyDay: {
      borderWidth: 1,
      borderColor: colors.hairline,
      borderStyle: 'dashed',
      borderRadius: radius.md,
      paddingVertical: 14,
      alignItems: 'center',
    },
    emptyText: { fontFamily: typography.body.fontFamily, fontSize: 12.5, color: colors.inkFaint },
    mealRow: {
      backgroundColor: colors.creamDeep,
      borderRadius: 12,
      padding: 8,
      marginBottom: 8,
    },
    mealTop: { flexDirection: 'row', alignItems: 'center' },
    mealMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
    thumb: { width: 48, height: 48, borderRadius: 10, backgroundColor: colors.paper },
    mealTitle: { fontFamily: typography.body.semibold, fontSize: 13, color: colors.ink },
    mealMeta: { fontFamily: typography.body.fontFamily, fontSize: 11, color: colors.inkFaint, marginTop: 2 },
    reminderChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      marginTop: 8,
      alignSelf: 'flex-start',
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: radius.pill,
      backgroundColor: colors.paper,
      borderWidth: 1,
      borderColor: colors.hairline,
    },
    reminderChipOn: { backgroundColor: colors.sageDeep, borderColor: colors.sageDeep },
    reminderText: { fontFamily: typography.body.medium, fontSize: 11, color: colors.inkFaint },
    reminderTextOn: { color: colors.onAccent, fontFamily: typography.body.semibold },
    remove: { padding: 6 },
    ctaWrap: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.md,
      backgroundColor: colors.cream,
      borderTopWidth: 1,
      borderTopColor: colors.hairline,
    },
    cta: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      height: 52,
      borderRadius: radius.pill,
      backgroundColor: colors.sageDeep,
    },
    ctaText: { fontFamily: typography.body.semibold, fontSize: 14, color: colors.onAccent },
  });
}
