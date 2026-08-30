import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import Badge from './Badge';
import { getSubstitutesFor } from '../api/substitutionService';
import { getSubstitutionErrorMessage } from '../api/substitutionErrors';

// Read-only "what can I use instead of {ingredient}?" bottom-sheet, opened from
// an API Recipe Detail ingredient row. It NEVER mutates the recipe, the
// shopping list, servings, or Favorites — it only displays what the backend
// returns for GET /api/v1/substitutions?sourceIngredientId=<id>.
//
// `ratio` is not requested/shown (see substitutionService.js): the backend
// gives no replacement-unit semantics, so the sheet shows canonical substitute
// names + optional notes + optional context tags only, plus an explicit
// "starting point, not exact amounts" footnote.
//
// Stale / lifecycle safety (all handled here):
//   - `genRef`      — monotonic, bumped on every effect run (fetch, cache hit,
//                     close). A `.then`/`.catch` whose captured `gen` is no
//                     longer current returns without touching state — a stale
//                     success cannot replace newer results, a stale error
//                     cannot clear them. There is NO shared "in-flight" ref: a
//                     settled request must never mutate state a newer request
//                     relies on.
//   - per-effect `cancelled` flag + the cleanup — switching ingredient / closing
//                     / unmounting abandons the in-flight request; no setState
//                     after unmount.
//   - render derives from `state` ONLY when `state.forId === ingredient.id`,
//                     otherwise it shows loading — so reopening for a different
//                     ingredient can never flash the previous ingredient's list,
//                     regardless of effect timing.
//   - de-dup of the realistic "impatient double-tap on the same row": the same
//                     `ingredient` object ref (from a stable `ingredientRows`
//                     memo) makes `setState`/re-render a no-op, and the string
//                     `ingredientId` effect dependency does not change, so the
//                     effect never re-runs and no second request is issued.
//                     Closing then reopening the same ingredient before its
//                     first response lands may issue one fresh (idempotent GET)
//                     request; the earlier one is dropped by `genRef`.
//
// `cacheRef` (a Map<ingredientId, substitutes[]>) is owned by the parent screen
// and survives sheet open/close and ingredient switches; it dies when the
// screen remounts (RecipeDetail container is keyed by recipeId). A cache hit
// renders instantly with no request.

const EMPTY_STATE = { forId: null, phase: 'loading', substitutes: [], error: null };

export default function SubstitutionsSheet({ visible, ingredient, cacheRef, onClose }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const insets = useSafeAreaInsets();

  const ingredientId = ingredient && ingredient.id ? String(ingredient.id) : null;

  const [state, setState] = useState(EMPTY_STATE);
  const [retryTick, setRetryTick] = useState(0);

  const genRef = useRef(0);
  const localCacheRef = useRef(new Map());
  const cache = cacheRef && cacheRef.current ? cacheRef.current : localCacheRef.current;

  useEffect(() => {
    // Every run bumps the generation: any earlier in-flight request now fails
    // its `gen === genRef.current` check and is dropped on arrival.
    const gen = ++genRef.current;

    if (!visible || !ingredientId) {
      // Closing, or opened with nothing selected — nothing to load.
      return undefined;
    }

    // Cache hit — render immediately, issue no request.
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
        setState({
          forId: ingredientId,
          phase: 'error',
          substitutes: [],
          error: getSubstitutionErrorMessage(err),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [visible, ingredientId, retryTick, cache]);

  const retry = () => setRetryTick((t) => t + 1);

  // Only trust `state` when it belongs to the ingredient currently being shown;
  // otherwise fall back to a loading view (covers the first frame after the
  // sheet is reopened for a different ingredient, before the effect runs).
  const current = state.forId === ingredientId ? state : EMPTY_STATE;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropFill} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.eyebrow}>SUBSTITUTES FOR</Text>
              <Text style={styles.title} numberOfLines={2}>
                {ingredient && ingredient.name ? ingredient.name : 'this ingredient'}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={colors.inkSoft} />
            </Pressable>
          </View>

          <View style={styles.body}>
            {current.phase === 'loading' ? (
              <View style={styles.centerBlock}>
                <ActivityIndicator color={colors.sageDeep} />
              </View>
            ) : current.phase === 'error' ? (
              <View style={styles.centerBlock}>
                <Ionicons name="cloud-offline-outline" size={26} color={colors.inkFaint} />
                <Text style={styles.noticeText}>{current.error}</Text>
                <Pressable style={styles.retryBtn} onPress={retry} hitSlop={8}>
                  <Ionicons name="refresh" size={14} color={colors.sageDeep} />
                  <Text style={styles.retryText}>Try again</Text>
                </Pressable>
              </View>
            ) : current.substitutes.length === 0 ? (
              <View style={styles.centerBlock}>
                <Ionicons name="swap-horizontal" size={26} color={colors.inkFaint} />
                <Text style={styles.noticeText}>No substitutions available.</Text>
              </View>
            ) : (
              <ScrollView
                style={styles.scrollArea}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.list}
              >
                {current.substitutes.map((s) => (
                  <View key={s.id || s.substitute.id} style={styles.card}>
                    <Text style={styles.subName}>{s.substitute.name}</Text>
                    {s.contexts.length > 0 && (
                      <View style={styles.chipRow}>
                        {s.contexts.map((c) => (
                          <Badge key={c} label={c} tone="sage" />
                        ))}
                      </View>
                    )}
                    {s.notes ? <Text style={styles.subNotes}>{s.notes}</Text> : null}
                  </View>
                ))}
                <Text style={styles.footnote}>
                  Suggestions from the WeCooked catalog — a starting point, not exact amounts. Adjust
                  to taste.
                </Text>
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
    backdropFill: { ...StyleSheet.absoluteFillObject },
    sheet: {
      backgroundColor: colors.cream,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      maxHeight: '80%',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      marginBottom: spacing.md,
    },
    headerText: { flex: 1, paddingRight: spacing.md },
    eyebrow: {
      fontFamily: typography.body.semibold,
      fontSize: 10,
      letterSpacing: 1,
      color: colors.inkFaint,
      marginBottom: 2,
    },
    title: {
      fontFamily: typography.display.fontFamily,
      fontSize: typography.sizes.xl,
      color: colors.ink,
    },
    closeBtn: { padding: spacing.xs },
    // `flexShrink: 1` lets the body (and the scroll area inside it) give up
    // height once the sheet hits its `maxHeight` clamp, so a long substitutes
    // list scrolls inside the sheet instead of overflowing it. RN defaults
    // `flexShrink` to 0, so this must be explicit.
    body: { minHeight: 140, flexShrink: 1 },
    scrollArea: { flexShrink: 1 },
    centerBlock: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: spacing.xxl,
      gap: spacing.md,
    },
    noticeText: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.sm,
      color: colors.inkSoft,
      textAlign: 'center',
    },
    retryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderWidth: 1,
      borderColor: colors.hairline,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.lg,
      paddingVertical: 8,
    },
    retryText: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.sm,
      color: colors.sageDeep,
    },
    list: { paddingBottom: spacing.md, gap: spacing.sm },
    card: {
      backgroundColor: colors.paper,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.hairline,
      padding: spacing.md,
      gap: spacing.sm,
    },
    subName: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.md,
      color: colors.ink,
    },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    subNotes: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      lineHeight: 19,
      color: colors.inkSoft,
    },
    footnote: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.xs,
      lineHeight: 16,
      color: colors.inkFaint,
      marginTop: spacing.sm,
    },
  });
}