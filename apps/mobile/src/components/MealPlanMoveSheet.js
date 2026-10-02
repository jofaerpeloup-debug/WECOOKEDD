import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  findNodeHandle,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';
import { typography, spacing, radius } from '../theme/theme';
import {
  dateKeyFromLocalDate,
  formatDayDate,
  formatWeekRange,
  localDate,
  shiftWeek,
  weekDays,
} from '../utils/mealPlanDates';

function localDateFromKey(dateKey) {
  const [year, month, day] = String(dateKey || '').split('-').map(Number);
  return localDate(year, month - 1, day);
}

function formatPlannedDate(date) {
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

export default function MealPlanMoveSheet({
  visible,
  entry,
  pending,
  error,
  onClose,
  onMove,
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors);
  const titleRef = useRef(null);
  const [weekAnchor, setWeekAnchor] = useState(() => localDateFromKey(
    entry?.dateKey || dateKeyFromLocalDate(new Date())
  ));
  const [selectedDateKey, setSelectedDateKey] = useState(entry?.dateKey || null);
  const days = useMemo(() => weekDays(weekAnchor), [weekAnchor]);
  const todayKey = dateKeyFromLocalDate(new Date());

  useEffect(() => {
    if (!visible || !entry) return;
    setWeekAnchor(localDateFromKey(entry.dateKey));
    setSelectedDateKey(entry.dateKey);
  }, [visible, entry?.id]);

  useEffect(() => {
    if (!visible) return undefined;
    const timer = setTimeout(() => {
      const node = findNodeHandle(titleRef.current);
      if (node) AccessibilityInfo.setAccessibilityFocus(node);
    }, 100);
    return () => clearTimeout(timer);
  }, [visible, entry?.id]);

  if (!entry) return null;
  const title = entry.isAvailable ? entry.recipe?.title : 'Unavailable recipe';
  const sourceDate = localDateFromKey(entry.dateKey);
  const unchanged = selectedDateKey === entry.dateKey;
  const moveDisabled = pending || unchanged || !selectedDateKey;
  const close = () => { if (!pending) onClose(); };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable
        style={styles.backdrop}
        onPress={close}
        disabled={pending}
        accessibilityLabel="Close move meal"
      />
      <View
        style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.xl) }]}
        accessibilityViewIsModal
      >
        <View style={styles.grabber} />
        <View style={styles.headingRow}>
          <View style={styles.headingCopy}>
            <Text ref={titleRef} style={styles.title} accessibilityRole="header">Move meal</Text>
            <Text style={styles.subtitle}>{title}</Text>
          </View>
          <Pressable
            style={styles.closeButton}
            onPress={close}
            disabled={pending}
            accessibilityRole="button"
            accessibilityLabel="Close move meal"
            accessibilityState={{ disabled: pending }}
          >
            <Ionicons name="close" size={20} color={colors.inkSoft} />
          </Pressable>
        </View>

        <View style={styles.sourceSummary} accessibilityLabel={`Moving from ${formatPlannedDate(sourceDate)}`}>
          <Text style={styles.sourceLabel}>Moving from</Text>
          <Text style={styles.sourceDate}>{formatPlannedDate(sourceDate)}</Text>
        </View>

        <View style={styles.weekNav}>
          <Pressable
            style={styles.weekButton}
            onPress={() => setWeekAnchor((date) => shiftWeek(date, -1))}
            disabled={pending}
            accessibilityRole="button"
            accessibilityLabel="Previous target week"
            accessibilityState={{ disabled: pending }}
          >
            <Ionicons name="chevron-back" size={18} color={colors.sageDeep} />
          </Pressable>
          <Text style={styles.weekLabel}>{formatWeekRange(days)}</Text>
          <Pressable
            style={styles.weekButton}
            onPress={() => setWeekAnchor((date) => shiftWeek(date, 1))}
            disabled={pending}
            accessibilityRole="button"
            accessibilityLabel="Next target week"
            accessibilityState={{ disabled: pending }}
          >
            <Ionicons name="chevron-forward" size={18} color={colors.sageDeep} />
          </Pressable>
        </View>

        <View style={styles.days}>
          {days.map((day) => {
            const selected = day.dateKey === selectedDateKey;
            const current = day.dateKey === todayKey;
            const accessibilityLabel = [
              day.label,
              formatDayDate(day.date),
              current ? 'Current date' : null,
              selected ? 'Selected' : null,
            ].filter(Boolean).join(', ');
            return (
              <Pressable
                key={day.dateKey}
                style={[styles.day, selected && styles.daySelected, current && styles.dayCurrent]}
                onPress={() => setSelectedDateKey(day.dateKey)}
                disabled={pending}
                accessibilityRole="button"
                accessibilityLabel={accessibilityLabel}
                accessibilityState={{ disabled: pending, selected }}
              >
                <Text style={[styles.dayName, selected && styles.dayTextSelected]}>{day.label.slice(0, 3)}</Text>
                <Text style={[styles.dayNumber, selected && styles.dayTextSelected]}>{day.date.getDate()}</Text>
                {current ? <Text style={[styles.today, selected && styles.dayTextSelected]}>Today</Text> : null}
              </Pressable>
            );
          })}
        </View>

        <View style={styles.selection} accessibilityLiveRegion="polite">
          <Text style={styles.selectionLabel}>{unchanged ? 'Current plan' : 'Selected target'}</Text>
          <Text style={styles.selectionDate}>{formatPlannedDate(localDateFromKey(selectedDateKey))}</Text>
          {unchanged ? <Text style={styles.selectionHint}>Choose a different date to move this meal.</Text> : null}
        </View>
        {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}

        <Pressable
          style={[styles.moveButton, moveDisabled && styles.moveButtonDisabled]}
          onPress={() => { if (!moveDisabled) onMove(selectedDateKey); }}
          disabled={moveDisabled}
          accessibilityRole="button"
          accessibilityLabel="Move meal"
          accessibilityState={{ disabled: moveDisabled, busy: pending }}
        >
          {pending ? <ActivityIndicator size="small" color={colors.onAccent} /> : null}
          <Text style={styles.moveText}>{pending ? 'Moving…' : 'Move meal'}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.overlay },
    sheet: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: colors.paper,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.md,
    },
    grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.hairline, marginBottom: spacing.lg },
    headingRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: spacing.lg },
    headingCopy: { flex: 1 },
    title: { fontFamily: typography.display.fontFamily, fontSize: 22, color: colors.ink },
    subtitle: { fontFamily: typography.body.fontFamily, fontSize: 13, color: colors.inkFaint, marginTop: 3 },
    closeButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.creamDeep, alignItems: 'center', justifyContent: 'center' },
    sourceSummary: { marginBottom: spacing.lg, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.creamDeep },
    sourceLabel: { fontFamily: typography.body.medium, fontSize: 10, textTransform: 'uppercase', color: colors.inkFaint },
    sourceDate: { marginTop: 3, fontFamily: typography.body.semibold, fontSize: 14, color: colors.ink },
    weekNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.md, marginBottom: spacing.lg },
    weekButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.sagePale, alignItems: 'center', justifyContent: 'center' },
    weekLabel: { minWidth: 170, textAlign: 'center', fontFamily: typography.body.semibold, fontSize: 13, color: colors.inkSoft },
    days: { flexDirection: 'row', gap: spacing.xs },
    day: { flex: 1, minHeight: 78, borderRadius: radius.md, borderWidth: 1, borderColor: colors.hairline, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cream },
    daySelected: { backgroundColor: colors.sageDeep, borderColor: colors.sageDeep },
    dayCurrent: { borderColor: colors.stone, borderWidth: 2 },
    dayName: { fontFamily: typography.body.semibold, fontSize: 10, textTransform: 'uppercase', color: colors.inkFaint },
    dayNumber: { fontFamily: typography.body.bold, fontSize: 17, color: colors.ink, marginTop: 3 },
    today: { fontFamily: typography.body.medium, fontSize: 9, color: colors.stone, marginTop: 2 },
    dayTextSelected: { color: colors.onAccent },
    selection: { minHeight: 58, marginTop: spacing.md, padding: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.sagePale },
    selectionLabel: { fontFamily: typography.body.medium, fontSize: 10, textTransform: 'uppercase', color: colors.sageDeep },
    selectionDate: { marginTop: 2, fontFamily: typography.body.semibold, fontSize: 13, color: colors.ink },
    selectionHint: { marginTop: 3, fontFamily: typography.body.fontFamily, fontSize: 11, color: colors.inkFaint },
    error: { marginTop: spacing.sm, padding: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.errorBg, fontFamily: typography.body.fontFamily, fontSize: 12, textAlign: 'center', color: colors.error },
    moveButton: { marginTop: spacing.md, minHeight: 50, borderRadius: radius.pill, backgroundColor: colors.sageDeep, flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'center' },
    moveButtonDisabled: { opacity: 0.5 },
    moveText: { fontFamily: typography.body.semibold, fontSize: 14, color: colors.onAccent },
  });
}
