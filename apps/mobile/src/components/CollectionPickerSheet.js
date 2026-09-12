import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  TextInput,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import { useCollections } from '../context/CollectionsContext';

// Real add-to-collection sheet for RecipeDetail's Collections icon, replacing
// the honest pending alert. Lists the caller's real Collections (never
// Favorites — Favorites stays a separate domain controlled by FavoriteHeart)
// via the shared CollectionsContext, and can create a collection inline the
// same way the teammate CollectionPickerSheet does (create -> immediately add
// the current recipe to it).
//
// Unlike the teammate's picker, this sheet does not show a live per-collection
// "already added" checkbox: the backend's collection-list endpoint reports
// cover images/counts, not "does collection X contain recipe Y" for an
// arbitrary recipe, and adding that lookup is out of M5A's API surface. A tap
// always calls the real add endpoint; a duplicate add is handled idempotently
// (backend 409 COLLECTION_RECIPE_ALREADY_EXISTS reads as success here — see
// collectionErrors.js) and shows the same checkmark. The sheet stays open
// after an add so more than one collection can be chosen in one visit; "Done"
// closes it.
export default function CollectionPickerSheet({ visible, onClose, recipeId }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const insets = useSafeAreaInsets();
  const { collections, status, error, reload, createCollection, addRecipeToCollection } = useCollections();

  const [addingOpen, setAddingOpen] = useState(false);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [addingId, setAddingId] = useState(null); // collectionId currently being added to
  const [addedIds, setAddedIds] = useState(() => new Set());
  const [formError, setFormError] = useState(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Fresh state every time the sheet opens, and pick up any collection
  // created/deleted elsewhere since it was last shown.
  useEffect(() => {
    if (!visible) return;
    setAddingOpen(false);
    setName('');
    setCreating(false);
    setAddingId(null);
    setAddedIds(new Set());
    setFormError(null);
    reload();
  }, [visible, reload]);

  const addTo = async (collectionId) => {
    if (addingId) return;
    setFormError(null);
    setAddingId(collectionId);
    const result = await addRecipeToCollection(collectionId, recipeId);
    if (!mountedRef.current) return;
    setAddingId(null);
    if (result.ok) {
      setAddedIds((prev) => new Set(prev).add(collectionId));
    } else {
      setFormError(result.error || 'Couldn’t add this recipe. Please try again.');
    }
  };

  const createAndAdd = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setFormError(null);
    setCreating(true);
    const created = await createCollection({ name: trimmed });
    if (!created.ok) {
      if (mountedRef.current) {
        setCreating(false);
        setFormError(created.error || 'Couldn’t create that collection. Please try again.');
      }
      return;
    }
    const added = await addRecipeToCollection(created.collection.id, recipeId);
    if (!mountedRef.current) return;
    setCreating(false);
    setName('');
    setAddingOpen(false);
    if (added.ok) {
      setAddedIds((prev) => new Set(prev).add(created.collection.id));
    } else {
      setFormError(added.error || 'Couldn’t add this recipe. Please try again.');
    }
  };

  const loadingInitial = (status === 'loading' || status === 'idle') && collections.length === 0;
  const loadFailed = status === 'error' && collections.length === 0;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropFill} onPress={onClose} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.kav}>
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
            <View style={styles.header}>
              <Text style={styles.title}>Add to Collection</Text>
              <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn}>
                <Ionicons name="close" size={22} color={colors.inkSoft} />
              </Pressable>
            </View>

            <ScrollView
              style={styles.list}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {loadingInitial ? (
                <View style={styles.centerBlock}>
                  <ActivityIndicator color={colors.sageDeep} />
                </View>
              ) : loadFailed ? (
                <View style={styles.centerBlock}>
                  <Text style={styles.errorText}>{error || 'Couldn’t load your collections.'}</Text>
                  <Pressable style={styles.retryBtn} onPress={() => reload()} hitSlop={8}>
                    <Ionicons name="refresh" size={14} color={colors.sageDeep} />
                    <Text style={styles.retryText}>Retry</Text>
                  </Pressable>
                </View>
              ) : collections.length === 0 && !addingOpen ? (
                <Text style={styles.hint}>No collections yet. Create one below.</Text>
              ) : (
                collections.map((c) => {
                  const added = addedIds.has(c.id);
                  const busy = addingId === c.id;
                  return (
                    <Pressable
                      key={c.id}
                      style={styles.row}
                      onPress={() => addTo(c.id)}
                      disabled={busy}
                    >
                      <View style={[styles.check, added && styles.checkOn]}>
                        {busy ? (
                          <ActivityIndicator size="small" color={colors.sageDeep} />
                        ) : added ? (
                          <Ionicons name="checkmark" size={13} color={colors.onAccent} />
                        ) : null}
                      </View>
                      <Text style={styles.rowLabel} numberOfLines={1}>
                        {c.name}
                      </Text>
                      <Text style={styles.rowCount}>{c.recipeCount}</Text>
                    </Pressable>
                  );
                })
              )}
            </ScrollView>

            {addingOpen ? (
              <View style={styles.newRow}>
                <TextInput
                  style={styles.input}
                  placeholder="Collection name"
                  placeholderTextColor={colors.inkFaint}
                  value={name}
                  onChangeText={setName}
                  autoFocus
                  maxLength={60}
                  onSubmitEditing={createAndAdd}
                  returnKeyType="done"
                  editable={!creating}
                />
                <Pressable style={styles.addBtn} onPress={createAndAdd} disabled={creating}>
                  {creating ? (
                    <ActivityIndicator size="small" color={colors.onAccent} />
                  ) : (
                    <Text style={styles.addBtnText}>Add</Text>
                  )}
                </Pressable>
              </View>
            ) : (
              <Pressable style={styles.newTrigger} onPress={() => setAddingOpen(true)}>
                <Ionicons name="add" size={16} color={colors.sageDeep} />
                <Text style={styles.newTriggerText}>New collection</Text>
              </Pressable>
            )}

            {formError && <Text style={styles.formError}>{formError}</Text>}

            <Pressable style={styles.done} onPress={onClose}>
              <Text style={styles.doneText}>Done</Text>
            </Pressable>
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
    kav: { width: '100%' },
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
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.md,
    },
    title: { fontFamily: typography.body.semibold, fontSize: typography.sizes.lg, color: colors.ink },
    closeBtn: { padding: spacing.xs },
    list: { maxHeight: 260 },
    centerBlock: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xl, gap: spacing.sm },
    hint: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.inkFaint,
      paddingVertical: spacing.lg,
      textAlign: 'center',
    },
    errorText: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.sm,
      color: colors.error,
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
    retryText: { fontFamily: typography.body.semibold, fontSize: typography.sizes.sm, color: colors.sageDeep },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: colors.hairline,
    },
    check: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 1,
      borderColor: colors.hairline,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkOn: { backgroundColor: colors.sageDeep, borderColor: colors.sageDeep },
    rowLabel: { flex: 1, fontFamily: typography.body.medium, fontSize: typography.sizes.base, color: colors.ink },
    rowCount: { fontFamily: typography.body.fontFamily, fontSize: typography.sizes.sm, color: colors.inkFaint },
    newRow: { flexDirection: 'row', gap: spacing.sm, paddingTop: spacing.md, alignItems: 'center' },
    input: {
      flex: 1,
      backgroundColor: colors.paper,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.hairline,
      paddingHorizontal: spacing.md,
      height: 44,
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.base,
      color: colors.ink,
      outlineStyle: 'none',
    },
    addBtn: {
      backgroundColor: colors.sageDeep,
      borderRadius: radius.md,
      paddingHorizontal: spacing.lg,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    addBtnText: { fontFamily: typography.body.semibold, fontSize: typography.sizes.sm, color: colors.onAccent },
    newTrigger: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingTop: spacing.md,
      paddingBottom: spacing.xs,
    },
    newTriggerText: { fontFamily: typography.body.semibold, fontSize: typography.sizes.sm, color: colors.sageDeep },
    formError: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.sm,
      color: colors.error,
      paddingTop: spacing.sm,
    },
    done: {
      marginTop: spacing.md,
      paddingVertical: spacing.md,
      alignItems: 'center',
      borderTopWidth: 1,
      borderTopColor: colors.hairline,
    },
    doneText: { fontFamily: typography.body.semibold, fontSize: typography.sizes.base, color: colors.ink },
  });
}
