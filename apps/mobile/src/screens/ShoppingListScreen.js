import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import { useShoppingList } from '../context/ShoppingListContext';
import { formatQuantity } from '../utils/recipe';
import { unitLabel } from '../api/recipeOptions';

// The Shopping List is backed entirely by the Express Shopping List REST API
// (via ShoppingListProvider) — see ShoppingListContext.js — for every
// currently-supported interaction (check/uncheck, remove, reload). The
// TEAMMATE screen (commit c1c86ed) is this screen's final visible product:
// its header is back-circle + title + Edit/Done ONLY (no clear-all control),
// its footer is an inline free-text name+qty "Add Item" form, and its rows
// are grouped into named sections. Where the real backend cannot honestly
// support a teammate-visible capability, this screen still renders the
// teammate control and reports the gap honestly in place — it never falls
// back to old WeCooked chrome and never fabricates data:
//
// - Clear-all: our REST API supports it (ShoppingListContext.clear /
//   DELETE /shopping-list/items) but the teammate final screen has no such
//   control, so no clear affordance is surfaced here. `clear()` remains
//   exported from ShoppingListContext for any future surface.
// - Manual add: the teammate inline name/qty fields are ported verbatim as
//   transient form state (never persisted, never AsyncStorage-backed, no
//   guessed ingredientId) — submitting shows an honest "not available yet"
//   message instead of creating a fake item. The real canonical
//   IngredientPickerModal + ShoppingListContext.addItem are NOT used by this
//   screen (free-text names can't be resolved to a real ingredientId
//   honestly) but remain intact/exported for any future real surface.
// - Section grouping: the teammate's Produce/Meat/Pantry sections are
//   guessed from the item NAME by its own local mock context — that keyword
//   guessing is never ported. The real API's shopping-list item shape has no
//   category field at all (see apps/api/.../shopping-list.serializer.js
//   toItemSummary — ingredient is `{ id, name }` only), so every real item is
//   grouped into one honest fallback section ("Other") via `itemCategory()`
//   below — a single swap point for a real backend category field later.
// - Unavailable badge: the teammate source has no such badge/state at all
//   (verified against c1c86ed — no Badge/warning concept anywhere in its
//   ShoppingListScreen.js), so none is rendered here. An archived/deleted
//   ingredient still needs a name to display (the field is genuinely null),
//   so the row falls back to a plain generic label — never a decorative
//   badge, never a fabricated name.

// The row's left-column name: the real ingredient name, or a safe generic
// label for an archived/deleted ingredient (no real name to show). The raw
// ingredientId is NEVER shown, and no unavailable badge/decoration is
// rendered — the teammate screen has none.
function itemPrimaryText(item) {
  if (item.ingredient && item.ingredient.name) return item.ingredient.name;
  return 'Unavailable ingredient';
}

// The row's right-column amount — real quantity/unit only, no conversion.
function itemAmountText(item) {
  if (item.unit === 'toTaste') return 'to taste';
  const qty = formatQuantity(item.quantity);
  const unit = item.unit ? unitLabel(item.unit) : '';
  const text = [qty, unit].filter(Boolean).join(' ');
  return text || null;
}

// No real category field exists yet on a shopping-list item (see file-header
// note). This is a single stable fallback bucket, never name-based
// classification — replace the return value with a real field (e.g.
// `item.ingredient.category`) once the backend serializes one.
function itemCategory() {
  return 'Other';
}

function groupItems(items) {
  const order = [];
  const byCategory = new Map();
  for (const item of items) {
    const category = itemCategory(item);
    if (!byCategory.has(category)) {
      byCategory.set(category, []);
      order.push(category);
    }
    byCategory.get(category).push(item);
  }
  return order.map((category) => ({ category, rows: byCategory.get(category) }));
}

function ItemRow({ item, editing, disabled, pending, onToggle, onRemove }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const available = !!(item.ingredient && item.ingredient.name);
  const primary = itemPrimaryText(item);
  const amount = itemAmountText(item);

  return (
    <Pressable
      style={styles.row}
      onPress={editing ? onRemove : onToggle}
      disabled={disabled}
      hitSlop={4}
    >
      <View style={styles.rowLeft}>
        {pending ? (
          <ActivityIndicator size="small" color={colors.sageDeep} style={styles.rowIcon} />
        ) : editing ? (
          <View style={styles.trash}>
            <Ionicons name="remove" size={14} color={colors.onAccent} />
          </View>
        ) : (
          <View style={[styles.check, item.isChecked && styles.checkOn]}>
            {item.isChecked && <Ionicons name="checkmark" size={12} color={colors.onAccent} />}
          </View>
        )}
        <Text
          style={[
            styles.name,
            !editing && item.isChecked && styles.nameChecked,
            !available && styles.nameUnavailable,
          ]}
        >
          {primary}
        </Text>
      </View>
      {amount ? <Text style={styles.qty}>{amount}</Text> : null}
    </Pressable>
  );
}

export default function ShoppingListScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const insets = useSafeAreaInsets();
  const { items, status, error, isInitializing, isMutating, isItemPending, reload, setChecked, removeItem } =
    useShoppingList();

  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [qty, setQty] = useState('');

  // Reconcile with server truth on focus. `reload` is generation-guarded and
  // is a no-op while a mutation or another GET is already in flight.
  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  // Nothing left to edit once the list empties out (e.g. every item removed
  // while editing) — fall back to the normal check/uncheck presentation.
  useEffect(() => {
    if (editing && items.length === 0) setEditing(false);
  }, [editing, items.length]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await reload();
    } finally {
      setRefreshing(false);
    }
  }, [reload]);

  const onToggle = useCallback(
    async (item) => {
      const result = await setChecked(item.id, !item.isChecked);
      if (!result.ok && result.error) {
        Alert.alert('Couldn’t update item', result.error);
      }
    },
    [setChecked]
  );

  const onRemove = useCallback(
    async (item) => {
      const result = await removeItem(item.id);
      if (!result.ok && result.error) {
        Alert.alert('Couldn’t remove item', result.error);
      }
    },
    [removeItem]
  );

  // The teammate inline "Add Item" form, kept as transient form state only.
  // There is no honest way to turn a free-text name into a real canonical
  // ingredientId, so nothing is added to the list, nowhere local or remote —
  // just an honest capability notice, matching the teammate control's final
  // visible presence without faking persistence.
  const submitAdd = useCallback(() => {
    if (!name.trim()) return;
    Alert.alert('Custom shopping items are not available yet.');
  }, [name]);

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.headerLeft}>
        <Pressable style={styles.backBtn} hitSlop={8} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={18} color={colors.ink} />
        </Pressable>
        <Text style={styles.title}>Shopping List</Text>
      </View>
      <Pressable hitSlop={8} onPress={() => setEditing((v) => !v)} disabled={isMutating}>
        <Text style={[styles.edit, isMutating && styles.actionDisabled]}>
          {editing ? 'Done' : 'Edit'}
        </Text>
      </Pressable>
    </View>
  );

  // Initial load — nothing to show yet.
  if (isInitializing && items.length === 0) {
    return (
      <View style={styles.root}>
        {header}
        <View style={styles.centerWrap}>
          <ActivityIndicator color={colors.sageDeep} />
        </View>
      </View>
    );
  }

  // Initial load failed with nothing to show.
  if (status === 'error' && items.length === 0) {
    return (
      <View style={styles.root}>
        {header}
        <View style={styles.centerWrap}>
          <Ionicons name="cloud-offline-outline" size={28} color={colors.inkFaint} />
          <Text style={styles.centerText}>{error || 'Couldn’t load your shopping list.'}</Text>
          <Pressable style={styles.retryBtn} onPress={() => reload()} hitSlop={8}>
            <Ionicons name="refresh" size={14} color={colors.sageDeep} />
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const sections = groupItems(items);

  return (
    <View style={styles.root}>
      {header}
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.sageDeep}
            colors={[colors.sageDeep]}
          />
        }
      >
        {error && items.length > 0 ? (
          <Pressable style={styles.inlineBanner} onPress={() => reload()}>
            <Ionicons name="refresh" size={14} color={colors.error} />
            <Text style={styles.inlineBannerText}>{error} Tap to retry.</Text>
          </Pressable>
        ) : null}

        {items.length === 0 ? (
          <Text style={styles.emptyText}>
            Your shopping list is empty. Add items below, or add everything from a recipe.
          </Text>
        ) : (
          sections.map(({ category, rows }) => (
            <View key={category} style={styles.group}>
              <Text style={styles.groupLabel}>{category}</Text>
              {rows.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  editing={editing}
                  disabled={isMutating}
                  pending={isItemPending(item.id)}
                  onToggle={() => onToggle(item)}
                  onRemove={() => onRemove(item)}
                />
              ))}
            </View>
          ))
        )}
      </ScrollView>

      <View style={[styles.ctaWrap, { paddingBottom: insets.bottom + spacing.lg }]}>
        {adding && (
          <View style={styles.addRow}>
            <TextInput
              style={[styles.addInput, { flex: 2 }]}
              placeholder="Item"
              placeholderTextColor={colors.inkFaint}
              value={name}
              onChangeText={setName}
              autoFocus
              onSubmitEditing={submitAdd}
              returnKeyType="done"
            />
            <TextInput
              style={[styles.addInput, { flex: 1 }]}
              placeholder="Qty"
              placeholderTextColor={colors.inkFaint}
              value={qty}
              onChangeText={setQty}
              onSubmitEditing={submitAdd}
              returnKeyType="done"
            />
            <Pressable style={styles.addConfirm} onPress={submitAdd}>
              <Ionicons name="checkmark" size={18} color={colors.onAccent} />
            </Pressable>
          </View>
        )}
        <Pressable style={styles.cta} onPress={() => setAdding((v) => !v)}>
          <Ionicons name={adding ? 'checkmark' : 'add'} size={16} color={colors.onAccent} />
          <Text style={styles.ctaText}>{adding ? 'Done Adding' : 'Add Item'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.xl,
      paddingBottom: spacing.md,
    },
    headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    backBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.creamDeep,
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: { fontFamily: typography.display.fontFamily, fontSize: 22, color: colors.ink },
    edit: { fontFamily: typography.body.medium, fontSize: 13, color: colors.inkFaint },
    actionDisabled: { opacity: 0.45 },
    scroll: { paddingHorizontal: spacing.xl, paddingBottom: 120, paddingTop: spacing.sm },
    emptyText: {
      fontFamily: typography.body.fontFamily,
      fontSize: 13,
      color: colors.inkFaint,
      textAlign: 'center',
      lineHeight: 20,
      paddingVertical: 40,
    },
    centerWrap: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.xxl,
      gap: spacing.md,
    },
    centerText: {
      fontFamily: typography.body.fontFamily,
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
    inlineBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.errorBg,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      marginBottom: spacing.md,
    },
    inlineBannerText: {
      flex: 1,
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.xs,
      color: colors.error,
    },
    group: { marginBottom: spacing.lg },
    groupLabel: {
      fontFamily: typography.body.bold,
      fontSize: 11.5,
      letterSpacing: 1.1,
      textTransform: 'uppercase',
      color: colors.inkFaint,
      marginBottom: spacing.xs,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 11,
      borderBottomWidth: 1,
      borderBottomColor: colors.hairline,
    },
    rowLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
    rowIcon: { width: 20, alignItems: 'center' },
    check: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 1.5,
      borderColor: colors.inkFaint,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkOn: { backgroundColor: colors.sageDeep, borderColor: colors.sageDeep },
    trash: {
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: colors.error,
      alignItems: 'center',
      justifyContent: 'center',
    },
    name: { flex: 1, fontFamily: typography.body.fontFamily, fontSize: 14, color: colors.ink },
    nameChecked: { color: colors.inkFaint, textDecorationLine: 'line-through' },
    nameUnavailable: { color: colors.inkFaint, fontStyle: 'italic' },
    qty: { fontFamily: typography.body.fontFamily, fontSize: 13, color: colors.inkFaint },
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
    addRow: { flexDirection: 'row', gap: 8, marginBottom: spacing.sm },
    addInput: {
      height: 44,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.hairline,
      paddingHorizontal: 12,
      fontFamily: typography.body.fontFamily,
      fontSize: 13,
      color: colors.ink,
    },
    addConfirm: {
      width: 44,
      height: 44,
      borderRadius: radius.md,
      backgroundColor: colors.sageDeep,
      alignItems: 'center',
      justifyContent: 'center',
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
    ctaText: { fontFamily: typography.body.semibold, fontSize: typography.sizes.md, color: colors.onAccent },
  });
}
