import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import Badge from './Badge';
import { getSubstitutesFor } from '../api/substitutionService';
import { getSubstitutionErrorMessage } from '../api/substitutionErrors';

const EMPTY_STATE = { forId: null, phase: 'loading', substitutes: [], error: null };

// Read-only sheet: suggestions never change recipe quantities or shopping lists.
export default function SubstitutionsSheet({ visible, ingredient, cacheRef, onClose }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const insets = useSafeAreaInsets();
  const ingredientId = ingredient?.id ? String(ingredient.id) : null;
  const [state, setState] = useState(EMPTY_STATE);
  const [retryTick, setRetryTick] = useState(0);
  const genRef = useRef(0);
  const localCacheRef = useRef(new Map());
  const cache = cacheRef?.current || localCacheRef.current;

  useEffect(() => {
    const gen = ++genRef.current;
    if (!visible || !ingredientId) return undefined;
    if (cache.has(ingredientId)) {
      setState({ forId: ingredientId, phase: 'ready', substitutes: cache.get(ingredientId), error: null });
      return undefined;
    }
    let cancelled = false;
    setState({ forId: ingredientId, phase: 'loading', substitutes: [], error: null });
    getSubstitutesFor(ingredientId)
      .then((res) => {
        if (cancelled || gen !== genRef.current) return;
        cache.set(ingredientId, res.substitutes);
        setState({ forId: ingredientId, phase: 'ready', substitutes: res.substitutes, error: null });
      })
      .catch((err) => {
        if (cancelled || gen !== genRef.current) return;
        setState({ forId: ingredientId, phase: 'error', substitutes: [], error: getSubstitutionErrorMessage(err) });
      });
    return () => { cancelled = true; };
  }, [visible, ingredientId, retryTick, cache]);

  const current = state.forId === ingredientId ? state : EMPTY_STATE;
  const retry = () => setRetryTick((t) => t + 1);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropFill} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.eyebrow}>SUBSTITUTES FOR</Text>
              <Text style={styles.title} numberOfLines={2}>{ingredient?.name || 'this ingredient'}</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Close substitutions">
              <Ionicons name="close" size={22} color={colors.inkSoft} />
            </Pressable>
          </View>
          <View style={styles.body}>
            {current.phase === 'loading' ? (
              <View style={styles.centerBlock}><ActivityIndicator color={colors.sageDeep} /></View>
            ) : current.phase === 'error' ? (
              <View style={styles.centerBlock}>
                <Ionicons name="cloud-offline-outline" size={26} color={colors.inkFaint} />
                <Text style={styles.noticeText}>{current.error}</Text>
                <Pressable style={styles.retryBtn} onPress={retry} hitSlop={8}>
                  <Ionicons name="refresh" size={14} color={colors.sageDeep} /><Text style={styles.retryText}>Try again</Text>
                </Pressable>
              </View>
            ) : current.substitutes.length === 0 ? (
              <View style={styles.centerBlock}><Ionicons name="swap-horizontal" size={26} color={colors.inkFaint} /><Text style={styles.noticeText}>No substitutions available.</Text></View>
            ) : (
              <ScrollView style={styles.scrollArea} showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
                {current.substitutes.map((s) => (
                  <View key={s.id || s.substitute.id} style={styles.card}>
                    <Text style={styles.subName}>{s.substitute.name}</Text>
                    {!!s.contexts?.length && <View style={styles.chipRow}>{s.contexts.map((c) => <Badge key={c} label={c} tone="sage" />)}</View>}
                    {s.notes ? <Text style={styles.subNotes}>{s.notes}</Text> : null}
                  </View>
                ))}
                <Text style={styles.footnote}>Suggestions from the WeCooked catalog — a starting point, not exact amounts. Adjust to taste.</Text>
              </ScrollView>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
    backdropFill: { ...StyleSheet.absoluteFill },
    sheet: { backgroundColor: colors.cream, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: spacing.lg, paddingTop: spacing.lg, maxHeight: '80%' },
    header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: spacing.md },
    headerText: { flex: 1, paddingRight: spacing.md },
    eyebrow: { fontFamily: typography.body.semibold, fontSize: 10, letterSpacing: 1, color: colors.inkFaint, marginBottom: 2 },
    title: { fontFamily: typography.display.fontFamily, fontSize: typography.sizes.xl, color: colors.ink },
    closeBtn: { padding: spacing.xs },
    body: { minHeight: 140, flexShrink: 1 }, scrollArea: { flexShrink: 1 },
    centerBlock: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xxl, gap: spacing.md },
    noticeText: { fontFamily: typography.body.medium, fontSize: typography.sizes.sm, color: colors.inkSoft, textAlign: 'center' },
    retryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: colors.hairline, borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: 8 },
    retryText: { fontFamily: typography.body.semibold, fontSize: typography.sizes.sm, color: colors.sageDeep },
    list: { paddingBottom: spacing.md, gap: spacing.sm },
    card: { backgroundColor: colors.paper, borderRadius: radius.md, borderWidth: 1, borderColor: colors.hairline, padding: spacing.md, gap: spacing.sm },
    subName: { fontFamily: typography.body.semibold, fontSize: typography.sizes.md, color: colors.ink },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    subNotes: { fontFamily: typography.body.fontFamily, fontSize: typography.sizes.sm, lineHeight: 19, color: colors.inkSoft },
    footnote: { fontFamily: typography.body.fontFamily, fontSize: typography.sizes.xs, lineHeight: 16, color: colors.inkFaint, marginTop: spacing.sm },
  });
}
