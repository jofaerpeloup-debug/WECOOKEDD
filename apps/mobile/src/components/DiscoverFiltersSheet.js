import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius, spacing, typography } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import {
  DIETARY_OPTIONS,
  DIFFICULTY_OPTIONS,
  REGION_OPTIONS,
  CATEGORY_OPTIONS,
  draftFromFilters,
  validateDiscoverFilterDraft,
} from '../utils/discoverFilters';

function ChoiceGroup({ label, options, value, onChange, styles }) {
  return (
    <View style={styles.group} accessibilityRole="radiogroup" accessibilityLabel={label}>
      <Text style={styles.groupLabel}>{label}</Text>
      <View style={styles.choices}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value || 'any'}
              onPress={() => onChange(option.value)}
              style={[styles.choice, selected && styles.choiceSelected]}
              accessibilityRole="radio"
              accessibilityLabel={`${label}: ${option.label}`}
              accessibilityState={{ selected }}
            >
              <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function DiscoverFiltersSheet({ visible, appliedFilters, onCancel, onApply }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState(() => draftFromFilters(appliedFilters));
  const [prepError, setPrepError] = useState(null);

  useEffect(() => {
    if (!visible) return;
    setDraft(draftFromFilters(appliedFilters));
    setPrepError(null);
  }, [visible, appliedFilters]);

  const cancel = () => {
    setDraft(draftFromFilters(appliedFilters));
    setPrepError(null);
    onCancel();
  };

  const apply = () => {
    const result = validateDiscoverFilterDraft(draft);
    setPrepError(result.prepError);
    if (!result.filters) return;
    onApply(result.filters);
  };

  const reset = () => {
    setDraft(draftFromFilters({}));
    setPrepError(null);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={cancel}
      statusBarTranslucent
      accessibilityViewIsModal
    >
      <View style={styles.backdrop}>
        <Pressable
          style={styles.backdropFill}
          onPress={cancel}
          accessibilityRole="button"
          accessibilityLabel="Close recipe filters"
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboardArea}
        >
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
            <View style={styles.header}>
              <View>
                <Text style={styles.title} accessibilityRole="header">
                  Filter recipes
                </Text>
                <Text style={styles.subtitle}>All selections combine with your search.</Text>
              </View>
              <Pressable
                onPress={cancel}
                hitSlop={10}
                style={styles.closeButton}
                accessibilityRole="button"
                accessibilityLabel="Close recipe filters"
              >
                <Ionicons name="close" size={22} color={colors.inkSoft} />
              </Pressable>
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.content}
            >
              <ChoiceGroup
                label="Region"
                options={REGION_OPTIONS}
                value={draft.region}
                onChange={(region) => setDraft((current) => ({ ...current, region }))}
                styles={styles}
              />
              <ChoiceGroup
                label="Category"
                options={CATEGORY_OPTIONS}
                value={draft.category}
                onChange={(category) => setDraft((current) => ({ ...current, category }))}
                styles={styles}
              />
              <ChoiceGroup
                label="Difficulty"
                options={DIFFICULTY_OPTIONS}
                value={draft.difficulty}
                onChange={(difficulty) => setDraft((current) => ({ ...current, difficulty }))}
                styles={styles}
              />
              <ChoiceGroup
                label="Dietary tag"
                options={DIETARY_OPTIONS}
                value={draft.dietaryTag}
                onChange={(dietaryTag) => setDraft((current) => ({ ...current, dietaryTag }))}
                styles={styles}
              />

              <View style={styles.group}>
                <Text style={styles.groupLabel}>Maximum prep minutes</Text>
                <TextInput
                  style={[styles.prepInput, prepError && styles.prepInputError]}
                  value={draft.maxPrepTimeMinutes}
                  onChangeText={(maxPrepTimeMinutes) => {
                    setDraft((current) => ({ ...current, maxPrepTimeMinutes }));
                    if (prepError) setPrepError(null);
                  }}
                  placeholder="Any"
                  placeholderTextColor={colors.inkFaint}
                  keyboardType="number-pad"
                  inputMode="numeric"
                  returnKeyType="done"
                  maxLength={4}
                  accessibilityLabel="Maximum prep minutes, from 1 to 1440"
                  accessibilityHint={prepError || 'Leave blank for any prep time'}
                />
                <Text style={styles.hint}>Recipes without a prep time will not match.</Text>
                {prepError && (
                  <Text style={styles.errorText} accessibilityLiveRegion="polite">
                    {prepError}
                  </Text>
                )}
              </View>
            </ScrollView>

            <View style={styles.actions}>
              <Pressable
                style={styles.resetButton}
                onPress={reset}
                accessibilityRole="button"
                accessibilityLabel="Reset recipe filters"
              >
                <Text style={styles.resetText}>Reset</Text>
              </Pressable>
              <Pressable
                style={styles.applyButton}
                onPress={apply}
                accessibilityRole="button"
                accessibilityLabel="Apply recipe filters"
              >
                <Text style={styles.applyText}>Apply filters</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
    backdropFill: { ...StyleSheet.absoluteFill },
    keyboardArea: { width: '100%', maxHeight: '92%' },
    sheet: {
      maxHeight: '100%',
      backgroundColor: colors.cream,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.lg,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: spacing.md,
      paddingBottom: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: colors.hairline,
    },
    title: { fontFamily: typography.body.bold, fontSize: typography.sizes.lg, color: colors.ink },
    subtitle: {
      marginTop: spacing.xs,
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.inkFaint,
    },
    closeButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    content: { paddingVertical: spacing.lg, gap: spacing.xl },
    group: { gap: spacing.sm },
    groupLabel: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.base,
      color: colors.ink,
    },
    choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    choice: {
      minHeight: 44,
      justifyContent: 'center',
      paddingHorizontal: spacing.md,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.hairline,
      backgroundColor: colors.paper,
    },
    choiceSelected: { backgroundColor: colors.sageDeep, borderColor: colors.sageDeep },
    choiceText: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.sm,
      color: colors.inkSoft,
    },
    choiceTextSelected: { color: colors.onAccent },
    prepInput: {
      minHeight: 48,
      borderWidth: 1,
      borderColor: colors.hairline,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      backgroundColor: colors.paper,
      color: colors.ink,
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.base,
      outlineStyle: 'none',
    },
    prepInputError: { borderColor: colors.error },
    hint: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.xs,
      color: colors.inkFaint,
    },
    errorText: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.sm,
      color: colors.error,
    },
    actions: {
      flexDirection: 'row',
      gap: spacing.md,
      paddingTop: spacing.md,
      borderTopWidth: 1,
      borderTopColor: colors.hairline,
    },
    resetButton: {
      minHeight: 48,
      paddingHorizontal: spacing.lg,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.hairline,
    },
    resetText: { fontFamily: typography.body.semibold, fontSize: typography.sizes.base, color: colors.ink },
    applyButton: {
      flex: 1,
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
      backgroundColor: colors.sageDeep,
    },
    applyText: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.base,
      color: colors.onAccent,
    },
  });
}
