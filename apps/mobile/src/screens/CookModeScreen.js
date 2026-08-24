import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, Pressable, TextInput, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import TopBar from '../components/TopBar';
import { loadJSON, saveJSON } from '../utils/storage';

const TABS = [
  { key: 'ingredients', label: 'Ingredients' },
  { key: 'steps', label: 'Steps' },
  { key: 'notes', label: 'Notes' },
];

export default function CookModeScreen({ navigation, route }) {
  const { recipe, ingredients } = route.params;
  const { colors, shadow } = useTheme();
  const styles = makeStyles(colors, shadow);
  const [tab, setTab] = useState('steps');
  const [notes, setNotes] = useState('');
  const [cooked, setCooked] = useState(false);
  const storageKey = `wecooked:cookmode:${recipe.id}`;
  const hydrated = useRef(false);

  useEffect(() => {
    (async () => {
      const stored = await loadJSON(storageKey, null);
      if (stored) {
        setNotes(stored.notes || '');
        setCooked(!!stored.cooked);
      }
      hydrated.current = true;
    })();
  }, [storageKey]);

  useEffect(() => {
    if (!hydrated.current) return;
    saveJSON(storageKey, { notes, cooked });
  }, [notes, cooked, storageKey]);

  const steps = recipe.steps || [];

  const markCooked = () => {
    setCooked(true);
    Alert.alert('Nicely done!', `${recipe.title} marked as cooked.`);
  };

  return (
    <View style={styles.root}>
      <TopBar
        mode="back"
        title={recipe.title}
        onBack={() => navigation.goBack()}
        rightIcon="ellipsis-horizontal"
        onRightPress={() => {}}
      />

      <View style={styles.tabRow}>
        {TABS.map((t) => {
          const active = t.key === tab;
          return (
            <Pressable key={t.key} style={styles.tab} onPress={() => setTab(t.key)}>
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{t.label}</Text>
              {active && <View style={styles.tabUnderline} />}
            </Pressable>
          );
        })}
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {tab === 'ingredients' && (
          <>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionLabel}>Ingredients</Text>
              <Text style={styles.servingsBadge}>4 servings</Text>
            </View>
            <View style={styles.ingredientsCard}>
              {(ingredients || []).map((ing, i) => (
                <View key={i} style={styles.ingredientRow}>
                  <View style={styles.bullet} />
                  <Text style={styles.ingredientText}>{ing}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {tab === 'steps' && (
          <View style={styles.stepsList}>
            {steps.length === 0 ? (
              <Text style={styles.emptyText}>No steps available for this recipe yet.</Text>
            ) : (
              steps.map((step, i) => (
                <View key={i} style={styles.stepRow}>
                  <View style={styles.stepIndexCol}>
                    <View style={styles.stepIndex}>
                      <Text style={styles.stepIndexText}>{i + 1}</Text>
                    </View>
                    {i < steps.length - 1 && <View style={styles.stepLine} />}
                  </View>
                  <Image source={{ uri: recipe.image }} style={styles.stepThumb} />
                  <View style={styles.stepBody}>
                    <Text style={styles.stepTitle}>{step.title}</Text>
                    <Text style={styles.stepDesc}>{step.description}</Text>
                  </View>
                </View>
              ))
            )}
          </View>
        )}

        {tab === 'notes' && (
          <View style={styles.notesWrap}>
            <Text style={styles.sectionLabel}>Your Notes</Text>
            <TextInput
              style={styles.notesInput}
              placeholder="Add tweaks, timing notes, or anything you want to remember for next time..."
              placeholderTextColor={colors.inkFaint}
              value={notes}
              onChangeText={setNotes}
              multiline
              textAlignVertical="top"
            />
          </View>
        )}

        <Pressable
          style={[styles.markBtn, cooked && styles.markBtnDone]}
          onPress={markCooked}
          disabled={cooked}
        >
          <Ionicons
            name={cooked ? 'checkmark-circle' : 'checkmark-circle-outline'}
            size={18}
            color={cooked ? colors.onAccent : colors.sageDeep}
          />
          <Text style={[styles.markBtnText, cooked && styles.markBtnTextDone]}>
            {cooked ? 'Marked as Cooked' : 'Mark as Cooked'}
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function makeStyles(colors, shadow) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    tabRow: {
      flexDirection: 'row',
      paddingHorizontal: spacing.lg,
      borderBottomWidth: 1,
      borderBottomColor: colors.hairline,
    },
    tab: { paddingVertical: spacing.md, marginRight: spacing.xl },
    tabLabel: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.base,
      color: colors.inkFaint,
    },
    tabLabelActive: { color: colors.sageDeep, fontFamily: typography.body.semibold },
    tabUnderline: {
      position: 'absolute',
      bottom: -1,
      left: 0,
      right: 0,
      height: 2,
      backgroundColor: colors.sageDeep,
      borderRadius: 1,
    },
    scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
    sectionHeaderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.md,
    },
    sectionLabel: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.lg,
      color: colors.ink,
      marginBottom: spacing.md,
    },
    servingsBadge: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.xs,
      color: colors.sageDeep,
    },
    ingredientsCard: {
      backgroundColor: colors.paper,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.hairline,
      padding: spacing.lg,
    },
    ingredientRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 6 },
    bullet: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.sageDeep },
    ingredientText: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.base,
      color: colors.ink,
    },
    stepsList: { paddingTop: spacing.sm },
    stepRow: { flexDirection: 'row', gap: spacing.md },
    stepIndexCol: { alignItems: 'center', width: 26 },
    stepIndex: {
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: colors.sageDeep,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepIndexText: {
      fontFamily: typography.body.bold,
      fontSize: typography.sizes.sm,
      color: colors.onAccent,
    },
    stepLine: { flex: 1, width: 2, backgroundColor: colors.hairline, marginVertical: 4 },
    stepThumb: { width: 56, height: 56, borderRadius: radius.md, backgroundColor: colors.creamDeep },
    stepBody: { flex: 1, paddingBottom: spacing.xl },
    stepTitle: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.md,
      color: colors.ink,
      marginBottom: 4,
    },
    stepDesc: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      lineHeight: 19,
      color: colors.inkSoft,
    },
    emptyText: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.inkFaint,
    },
    notesWrap: { flex: 1 },
    notesInput: {
      minHeight: 160,
      backgroundColor: colors.paper,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.hairline,
      padding: spacing.lg,
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.base,
      color: colors.ink,
    },
    markBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      marginTop: spacing.xl,
      paddingVertical: 15,
      borderRadius: radius.pill,
      borderWidth: 1.5,
      borderColor: colors.sageDeep,
    },
    markBtnDone: { backgroundColor: colors.sageDeep },
    markBtnText: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.md,
      color: colors.sageDeep,
    },
    markBtnTextDone: { color: colors.onAccent },
  });
}
