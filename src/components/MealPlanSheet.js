import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, ScrollView, Image, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import { recipes } from '../data/mockData';
import { metaLine } from '../utils/recipe';
import { imageSource } from '../utils/image';
import { useMealPlan, PLAN_DAYS } from '../context/MealPlanContext';

/**
 * Dual-purpose sheet:
 *  - pass `day`      -> pick a recipe to add to that day
 *  - pass `recipeId` -> pick a day to add that recipe to
 */
export default function MealPlanSheet({ visible, onClose, day, recipeId }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors);
  const { plan, addToPlan } = useMealPlan();
  const [q, setQ] = useState('');

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? recipes.filter((r) => r.title.toLowerCase().includes(t)) : recipes;
  }, [q]);

  const pickRecipeMode = !!day;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.xl) }]}>
        <View style={styles.grabber} />
        <Text style={styles.title}>
          {pickRecipeMode ? `Add a recipe to ${day}` : 'Add to which day?'}
        </Text>

        {pickRecipeMode ? (
          <>
            <View style={styles.search}>
              <Ionicons name="search" size={14} color={colors.inkFaint} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search recipes"
                placeholderTextColor={colors.inkFaint}
                value={q}
                onChangeText={setQ}
              />
            </View>
            <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
              {list.map((r) => (
                <Pressable
                  key={r.id}
                  style={styles.recRow}
                  onPress={() => {
                    addToPlan(day, r.id);
                    onClose();
                  }}
                >
                  <Image source={imageSource(r.image)} style={styles.thumb} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.recTitle}>{r.title}</Text>
                    <Text style={styles.recMeta}>{metaLine(r)}</Text>
                  </View>
                  <Ionicons name="add-circle" size={20} color={colors.sageDeep} />
                </Pressable>
              ))}
            </ScrollView>
          </>
        ) : (
          <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
            {PLAN_DAYS.map((d) => (
              <Pressable
                key={d}
                style={styles.dayRow}
                onPress={() => {
                  addToPlan(d, recipeId);
                  onClose();
                }}
              >
                <Text style={styles.dayLabel}>{d}</Text>
                <Text style={styles.dayCount}>
                  {plan[d].length} {plan[d].length === 1 ? 'meal' : 'meals'}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        )}

        <Pressable style={styles.done} onPress={onClose}>
          <Text style={styles.doneText}>Done</Text>
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
      maxHeight: '82%',
    },
    grabber: {
      alignSelf: 'center',
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.hairline,
      marginBottom: spacing.lg,
    },
    title: { fontFamily: typography.display.fontFamily, fontSize: 18, color: colors.ink, marginBottom: spacing.md },
    search: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.creamDeep,
      borderRadius: radius.md,
      paddingHorizontal: 12,
      height: 42,
      marginBottom: spacing.sm,
    },
    searchInput: {
      flex: 1,
      fontFamily: typography.body.fontFamily,
      fontSize: 13,
      color: colors.ink,
      outlineStyle: 'none',
    },
    list: { flexGrow: 0 },
    recRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: spacing.sm },
    thumb: { width: 46, height: 46, borderRadius: 10, backgroundColor: colors.creamDeep },
    recTitle: { fontFamily: typography.body.semibold, fontSize: 13, color: colors.ink },
    recMeta: { fontFamily: typography.body.fontFamily, fontSize: 11, color: colors.inkFaint, marginTop: 2 },
    dayRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: colors.hairline,
    },
    dayLabel: { fontFamily: typography.body.semibold, fontSize: 14, color: colors.ink },
    dayCount: { fontFamily: typography.body.fontFamily, fontSize: 12, color: colors.inkFaint },
    done: {
      marginTop: spacing.md,
      height: 50,
      borderRadius: radius.pill,
      backgroundColor: colors.creamDeep,
      alignItems: 'center',
      justifyContent: 'center',
    },
    doneText: { fontFamily: typography.body.semibold, fontSize: 14, color: colors.ink },
  });
}
