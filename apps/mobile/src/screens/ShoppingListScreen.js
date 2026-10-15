import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  Alert,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import { useShoppingList } from '../context/ShoppingListContext';
import IngredientPickerModal from '../components/IngredientPickerModal';
import ShoppingItemEditModal from '../components/ShoppingItemEditModal';
import SwipeToDelete from '../components/SwipeToDelete';
import { formatQuantity } from '../utils/recipe';
import { unitLabel } from '../api/recipeOptions';
import { groupShoppingListItems } from '../utils/shoppingListGrouping';
import { normalizeCustomLabel } from '../utils/shoppingCustomLabel';

function itemPrimaryText(item) {
  if (item.type === 'custom') return item.label;
  return item.ingredient?.name || 'Unavailable ingredient';
}

function itemAmountText(item) {
  if (item.type === 'custom') return null;
  if (item.unit === 'toTaste') return 'to taste';
  const quantity = formatQuantity(item.quantity);
  const unit = item.unit ? unitLabel(item.unit) : '';
  return [quantity, unit].filter(Boolean).join(' ') || null;
}

function sourceText(source) {
  if (!source || source.kind === 'legacy' || source.kind === 'manual') return null;
  const label = source.kind === 'single' ? `Includes ${source.title}`
    : source.kind === 'multiple' ? 'Includes multiple recipes' : 'Recipe source unavailable';
  return label;
}

function ItemRow({ item, editing, disabled, pending, onToggle, onRemove, onEdit }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const available = item.type === 'custom' || (item.isAvailable !== false && !!item.ingredient?.name);
  const primary = itemPrimaryText(item);
  const amount = itemAmountText(item);
  const sourceLabel = item.type === 'ingredient' ? sourceText(item.source) : null;
  const actionLabel = editing
    ? `Remove ${primary}`
    : `${item.isChecked ? 'Uncheck' : 'Check'} ${primary}`;

  return (
    <View style={styles.row}>
      <Pressable
        style={styles.rowAction}
        onPress={editing ? onRemove : onToggle}
        disabled={disabled}
        hitSlop={6}
        accessibilityRole={editing ? 'button' : 'checkbox'}
        accessibilityLabel={actionLabel}
        accessibilityState={{
          disabled,
          ...(editing ? {} : { checked: !!item.isChecked }),
          busy: pending,
        }}
      >
        {pending ? (
          <ActivityIndicator size="small" color={colors.sageDeep} style={styles.rowIcon} />
        ) : editing ? (
          <View style={styles.trash}>
            <Ionicons name="remove" size={14} color={colors.onAccent} />
          </View>
        ) : (
          <View style={[styles.check, item.isChecked && styles.checkOn]}>
            {item.isChecked ? <Ionicons name="checkmark" size={12} color={colors.onAccent} /> : null}
          </View>
        )}
      </Pressable>

      <View style={styles.itemText}>
        <Text
          style={[
            styles.name,
            !editing && item.isChecked && styles.nameChecked,
            !available && styles.nameUnavailable,
          ]}
        >
          {primary}
        </Text>
        {!available ? <Text style={styles.unavailable}>No longer in the ingredient catalog</Text> : null}
        {sourceLabel ? <Text style={styles.unavailable}>{sourceLabel}</Text> : null}
        {sourceLabel && item.source.quantityEdited
          ? <Text style={styles.unavailable}>Amount manually adjusted or mixed</Text> : null}
      </View>
      {amount ? <Text style={styles.qty}>{amount}</Text> : null}
      {!editing && available && item.type === 'ingredient' ? (
        <Pressable
          style={styles.editItemButton}
          onPress={onEdit}
          disabled={disabled}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={`Edit quantity and unit for ${primary}`}
          accessibilityState={{ disabled }}
        >
          <Ionicons name="create-outline" size={18} color={colors.sageDeep} />
        </Pressable>
      ) : null}
    </View>
  );
}

export default function ShoppingListScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const insets = useSafeAreaInsets();
  const {
    items,
    sessionKey,
    status,
    error,
    isInitializing,
    isMutating,
    isItemPending,
    reload,
    addItem,
    addCustomItem,
    updateItem,
    setChecked,
    removeItem,
    clearChecked,
    clear,
  } = useShoppingList();

  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [selectedEditItem, setSelectedEditItem] = useState(null);
  const [customDraft, setCustomDraft] = useState('');
  const [customError, setCustomError] = useState(null);
  const [customSubmitting, setCustomSubmitting] = useState(false);
  const customSubmitLock = useRef(false);
  const customSessionRef = useRef(sessionKey);
  customSessionRef.current = sessionKey;
  const mountedRef = useRef(true);
  const focusRef = useRef(0);
  const focusedRef = useRef(false);
  const checkedCount = items.filter((item) => item.isChecked === true).length;

  useEffect(() => {
    setCustomDraft('');
    setCustomError(null);
    setCustomSubmitting(false);
    customSubmitLock.current = false;
  }, [sessionKey]);
  const clearCheckedLabel = `Clear ${checkedCount} checked ${checkedCount === 1 ? 'item' : 'items'}`;

  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      focusRef.current += 1;
      reload();
      return () => {
        focusedRef.current = false;
        focusRef.current += 1;
      };
    }, [reload])
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const mayAlert = useCallback((focus) =>
    mountedRef.current && focusedRef.current && focusRef.current === focus, []);

  useEffect(() => {
    if (editing && items.length === 0) setEditing(false);
  }, [editing, items.length]);

  useEffect(() => {
    if (!selectedEditItem) return;
    const current = items.find((item) => item.id === selectedEditItem.id);
    if (!current || current.type === 'custom' || current.isAvailable === false || !current.ingredient) {
      setSelectedEditItem(null);
    }
  }, [items, selectedEditItem]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await reload();
    } finally {
      setRefreshing(false);
    }
  }, [reload]);

  const onToggle = useCallback(async (item) => {
    const focus = focusRef.current;
    const result = await setChecked(item.id, !item.isChecked, item.type);
    if (!result.ok && result.error && mayAlert(focus)) Alert.alert('Could not update item', result.error);
  }, [mayAlert, setChecked]);

  const onRemove = useCallback(async (item) => {
    const focus = focusRef.current;
    const result = await removeItem(item.id);
    if (!result.ok && result.error && mayAlert(focus)) Alert.alert('Could not remove item', result.error);
  }, [mayAlert, removeItem]);

  const onClearChecked = useCallback(async () => {
    const focus = focusRef.current;
    const result = await clearChecked();
    if (!result.ok && result.error && mayAlert(focus)) Alert.alert('Could not clear checked items', result.error);
  }, [clearChecked]);

  const confirmClear = useCallback(() => {
    Alert.alert('Clear shopping list?', 'This removes every item from your shopping list.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear List',
        style: 'destructive',
        onPress: async () => {
          const focus = focusRef.current;
          const result = await clear();
          if (!result.ok && result.error && mayAlert(focus)) Alert.alert('Could not clear list', result.error);
        },
      },
    ]);
  }, [clear]);

  const onAddCustom = useCallback(async () => {
    if (customSubmitLock.current || isMutating) return;
    const label = normalizeCustomLabel(customDraft);
    if (label === null) {
      setCustomError('Enter a visible item name of 1 to 80 characters.');
      return;
    }
    const session = sessionKey;
    customSubmitLock.current = true;
    setCustomSubmitting(true);
    setCustomError(null);
    try {
      const result = await addCustomItem(label);
      if (!mountedRef.current || session !== customSessionRef.current) return;
      if (result.ok) setCustomDraft('');
      else if (!result.superseded) setCustomError(result.error || 'Could not add custom item.');
    } finally {
      if (mountedRef.current && session === customSessionRef.current) {
        customSubmitLock.current = false;
        setCustomSubmitting(false);
      }
    }
  }, [addCustomItem, customDraft, isMutating, sessionKey]);

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.headerLeft}>
        <Pressable
          style={styles.backBtn}
          hitSlop={8}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={18} color={colors.ink} />
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">Shopping List</Text>
      </View>
      {items.length > 0 ? (
        <View style={styles.headerActions}>
          {editing ? (
            <Pressable
              hitSlop={8}
              onPress={confirmClear}
              disabled={isMutating}
              accessibilityRole="button"
              accessibilityLabel="Clear shopping list"
              accessibilityState={{ disabled: isMutating }}
            >
              <Text style={[styles.clear, isMutating && styles.actionDisabled]}>Clear</Text>
            </Pressable>
          ) : checkedCount > 0 ? (
            <Pressable
              hitSlop={8}
              onPress={onClearChecked}
              disabled={isMutating}
              accessibilityRole="button"
              accessibilityLabel={clearCheckedLabel}
              accessibilityState={{ disabled: isMutating, busy: isMutating }}
            >
              <Text style={[styles.clear, isMutating && styles.actionDisabled]}>
                {clearCheckedLabel}
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            hitSlop={8}
            onPress={() => setEditing((value) => !value)}
            disabled={isMutating}
            accessibilityRole="button"
            accessibilityLabel={editing ? 'Finish editing shopping list' : 'Edit shopping list'}
            accessibilityState={{ disabled: isMutating }}
          >
            <Text style={[styles.edit, isMutating && styles.actionDisabled]}>
              {editing ? 'Done' : 'Edit'}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );

  if (isInitializing && items.length === 0) {
    return (
      <View style={styles.root} accessibilityState={{ busy: true }}>
        {header}
        <View style={styles.centerWrap}>
          <ActivityIndicator color={colors.sageDeep} accessibilityLabel="Loading shopping list" />
        </View>
      </View>
    );
  }

  if (status === 'error' && items.length === 0) {
    return (
      <View style={styles.root}>
        {header}
        <View style={styles.centerWrap}>
          <Ionicons name="cloud-offline-outline" size={28} color={colors.inkFaint} />
          <Text style={styles.centerText}>{error || 'Could not load your shopping list.'}</Text>
          <Pressable
            style={styles.retryBtn}
            onPress={() => reload()}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Retry loading shopping list"
          >
            <Ionicons name="refresh" size={14} color={colors.sageDeep} />
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const sections = groupShoppingListItems(items);

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
        <View style={styles.customEntry}>
          <Text style={styles.groupLabel} accessibilityRole="header">Add Custom Item</Text>
          <View style={styles.customEntryRow}>
            <TextInput
              style={styles.customInput}
              value={customDraft}
              onChangeText={(value) => { setCustomDraft(value); setCustomError(null); }}
              placeholder="Add a custom item"
              placeholderTextColor={colors.inkFaint}
              accessibilityLabel="Custom item name"
              editable={!customSubmitting}
              returnKeyType="done"
              onSubmitEditing={onAddCustom}
            />
            <Pressable
              style={styles.customAdd}
              onPress={onAddCustom}
              disabled={isMutating || customSubmitting}
              accessibilityRole="button"
              accessibilityLabel="Add custom item"
              accessibilityState={{ disabled: isMutating || customSubmitting, busy: customSubmitting }}
            ><Text style={styles.customAddText}>Add</Text></Pressable>
          </View>
          {customError ? <Text style={styles.customError} accessibilityRole="alert">{customError}</Text> : null}
        </View>
        {error && items.length > 0 ? (
          <Pressable
            style={styles.inlineBanner}
            onPress={() => reload()}
            accessibilityRole="button"
            accessibilityLabel={`${error}. Retry loading shopping list`}
          >
            <Ionicons name="refresh" size={14} color={colors.error} />
            <Text style={styles.inlineBannerText}>{error} Tap to retry.</Text>
          </Pressable>
        ) : null}

        {items.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="cart-outline" size={28} color={colors.inkFaint} />
            <Text style={styles.emptyTitle}>Your shopping list is empty</Text>
            <Text style={styles.emptyText}>
              Add a custom item above, a catalog ingredient below, or ingredients from a recipe.
            </Text>
          </View>
        ) : (
          sections.map(({ category, label, rows }) => (
            <View key={category ?? 'category-unavailable'} style={styles.group}>
              <Text style={styles.groupLabel} accessibilityRole="header">{label}</Text>
              {rows.map((item) => {
                const row = (
                  <ItemRow
                    item={item}
                    editing={editing}
                    disabled={isMutating}
                    pending={isItemPending(item.id)}
                    onToggle={() => onToggle(item)}
                    onRemove={() => onRemove(item)}
                    onEdit={() => setSelectedEditItem(item)}
                  />
                );
                return editing ? (
                  <React.Fragment key={item.id}>{row}</React.Fragment>
                ) : (
                  <SwipeToDelete
                    key={item.id}
                    itemName={itemPrimaryText(item)}
                    disabled={isMutating}
                    onDelete={() => onRemove(item)}
                    testID={`shopping-item-${item.id}-swipe`}
                  >
                    {row}
                  </SwipeToDelete>
                );
              })}
            </View>
          ))
        )}
      </ScrollView>

      <View style={[styles.ctaWrap, { paddingBottom: insets.bottom + spacing.lg }]}>
        <Pressable
          style={[styles.cta, isMutating && styles.ctaDisabled]}
          onPress={() => setPickerVisible(true)}
          disabled={isMutating}
          accessibilityRole="button"
          accessibilityLabel="Add catalog ingredient"
          accessibilityState={{ disabled: isMutating }}
        >
          <Ionicons name="add" size={16} color={colors.onAccent} />
          <Text style={styles.ctaText}>Add Item</Text>
        </Pressable>
      </View>

      <IngredientPickerModal
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        onAdd={addItem}
      />
      <ShoppingItemEditModal
        visible={!!selectedEditItem}
        item={selectedEditItem}
        onClose={() => setSelectedEditItem(null)}
        onSave={updateItem}
      />
    </View>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: spacing.xl, paddingBottom: spacing.md,
    },
    headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
    backBtn: {
      width: 36, height: 36, borderRadius: 18, backgroundColor: colors.creamDeep,
      alignItems: 'center', justifyContent: 'center',
    },
    title: { fontFamily: typography.display.fontFamily, fontSize: 22, color: colors.ink },
    edit: { fontFamily: typography.body.medium, fontSize: 13, color: colors.inkSoft },
    clear: { fontFamily: typography.body.semibold, fontSize: 13, color: colors.error },
    actionDisabled: { opacity: 0.45 },
    scroll: { paddingHorizontal: spacing.xl, paddingBottom: 120, paddingTop: spacing.sm },
    emptyState: { alignItems: 'center', paddingVertical: 44, gap: spacing.sm },
    emptyTitle: { fontFamily: typography.body.semibold, fontSize: 15, color: colors.ink },
    emptyText: {
      maxWidth: 280, fontFamily: typography.body.fontFamily, fontSize: 13,
      color: colors.inkFaint, textAlign: 'center', lineHeight: 20,
    },
    centerWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, gap: spacing.md },
    centerText: { fontFamily: typography.body.fontFamily, fontSize: typography.sizes.sm, color: colors.inkSoft, textAlign: 'center' },
    retryBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1,
      borderColor: colors.hairline, borderRadius: radius.pill,
      paddingHorizontal: spacing.lg, paddingVertical: 8,
    },
    retryText: { fontFamily: typography.body.semibold, fontSize: typography.sizes.sm, color: colors.sageDeep },
    inlineBanner: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      backgroundColor: colors.errorBg, borderRadius: radius.md,
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginBottom: spacing.md,
    },
    inlineBannerText: { flex: 1, fontFamily: typography.body.medium, fontSize: typography.sizes.xs, color: colors.error },
    group: { marginBottom: spacing.lg },
    customEntry: { marginBottom: spacing.lg },
    customEntryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    customInput: { flex: 1, minHeight: 48, paddingHorizontal: spacing.md, borderWidth: 1,
      borderColor: colors.hairline, borderRadius: radius.md, backgroundColor: colors.paper,
      color: colors.ink, fontFamily: typography.body.fontFamily },
    customAdd: { minHeight: 48, paddingHorizontal: spacing.lg, justifyContent: 'center',
      borderRadius: radius.md, backgroundColor: colors.sageDeep },
    customAddText: { color: colors.onAccent, fontFamily: typography.body.semibold },
    customError: { color: colors.error, marginTop: spacing.xs, fontFamily: typography.body.fontFamily },
    groupLabel: {
      fontFamily: typography.body.bold, fontSize: 11.5, letterSpacing: 1.1,
      textTransform: 'uppercase', color: colors.inkFaint, marginBottom: spacing.xs,
    },
    row: { minHeight: 48, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.hairline },
    rowAction: { width: 44, minHeight: 44, alignItems: 'flex-start', justifyContent: 'center' },
    rowIcon: { width: 20 },
    check: {
      width: 20, height: 20, borderRadius: 10, borderWidth: 1.5,
      borderColor: colors.inkFaint, alignItems: 'center', justifyContent: 'center',
    },
    checkOn: { backgroundColor: colors.sageDeep, borderColor: colors.sageDeep },
    trash: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.error, alignItems: 'center', justifyContent: 'center' },
    itemText: { flex: 1, paddingVertical: 10 },
    name: { fontFamily: typography.body.fontFamily, fontSize: 14, color: colors.ink },
    nameChecked: { color: colors.inkFaint, textDecorationLine: 'line-through' },
    nameUnavailable: { color: colors.inkFaint, fontStyle: 'italic' },
    unavailable: { fontFamily: typography.body.fontFamily, fontSize: 11, color: colors.inkFaint, marginTop: 2 },
    qty: { marginLeft: spacing.sm, fontFamily: typography.body.fontFamily, fontSize: 13, color: colors.inkFaint },
    editItemButton: { width: 44, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' },
    ctaWrap: {
      position: 'absolute', left: 0, right: 0, bottom: 0,
      paddingHorizontal: spacing.xl, paddingTop: spacing.md,
      backgroundColor: colors.cream, borderTopWidth: 1, borderTopColor: colors.hairline,
    },
    cta: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      minHeight: 52, borderRadius: radius.pill, backgroundColor: colors.sageDeep,
    },
    ctaDisabled: { opacity: 0.55 },
    ctaText: { fontFamily: typography.body.semibold, fontSize: typography.sizes.md, color: colors.onAccent },
  });
}
