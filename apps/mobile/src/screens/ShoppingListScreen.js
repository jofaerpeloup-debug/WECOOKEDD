import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import TopBar from '../components/TopBar';
import Badge from '../components/Badge';
import IngredientPickerModal from '../components/IngredientPickerModal';
import { useShoppingList } from '../context/ShoppingListContext';
import { ingredientPrimaryLine, formatQuantity } from '../utils/recipe';
import { unitLabel } from '../api/recipeOptions';

// The Shopping List is backed entirely by the Express Shopping List REST API
// (via ShoppingListProvider). Items are rendered in BACKEND ARRAY ORDER — there
// is no produce/pantry/dairy/recipeItems grouping and no `item.source`; those
// fields do not exist in backend Shopping List data. Manual add goes through
// IngredientPickerModal, which only ever submits CANONICAL backend ingredient
// ids (GET /api/v1/ingredients) via ShoppingListContext.addItem — there is no
// free-text / local-only item and no optimistic merge.

const UNAVAILABLE_LABEL = 'Unavailable ingredient';

// The primary line for one backend shopping-list item. Available items reuse the
// shared Recipe quantity/unit helper ("1 kg Chicken" / "Black Pepper — to
// taste"). Unavailable items (archived/deleted ingredient — `ingredient: null`,
// no historical name in the serializer) get a safe generic label; the raw
// ingredientId is NEVER shown.
function itemPrimaryText(item) {
  if (item.ingredient && item.ingredient.name) {
    return ingredientPrimaryLine(item) || item.ingredient.name;
  }
  return UNAVAILABLE_LABEL;
}

// A short amount string for the secondary line (only used for unavailable items,
// which have no name to fold the amount into). No unit conversion.
function itemAmountText(item) {
  if (item.unit === 'toTaste') return 'to taste';
  const qty = formatQuantity(item.quantity);
  const unit = item.unit ? unitLabel(item.unit) : '';
  const text = [qty, unit].filter(Boolean).join(' ');
  return text || null;
}

function Checkbox({ checked }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
      {checked && <Ionicons name="checkmark" size={13} color={colors.onAccent} />}
    </View>
  );
}

function ItemRow({ item, disabled, pending, onToggle, onRemove }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const available = !!(item.ingredient && item.ingredient.name);
  const primary = itemPrimaryText(item);
  const amount = itemAmountText(item);

  return (
    <View style={styles.row}>
      <Pressable
        style={styles.rowMain}
        onPress={onToggle}
        disabled={disabled}
        hitSlop={4}
      >
        <Checkbox checked={item.isChecked} />
        <View style={styles.rowTextWrap}>
          <Text
            style={[
              styles.itemText,
              item.isChecked && styles.itemTextChecked,
              !available && styles.itemTextUnavailable,
            ]}
          >
            {primary}
          </Text>
          {!available && amount ? <Text style={styles.itemSub}>{amount}</Text> : null}
        </View>
        {!available && <Badge label="Unavailable" tone="warning" />}
      </Pressable>

      {pending ? (
        <ActivityIndicator size="small" color={colors.sageDeep} style={styles.rowSpinner} />
      ) : (
        <Pressable
          onPress={onRemove}
          hitSlop={10}
          disabled={disabled}
          style={({ pressed }) => [styles.removeBtn, pressed && styles.removeBtnPressed]}
        >
          <Ionicons name="trash-outline" size={17} color={disabled ? colors.inkFaint : colors.error} />
        </Pressable>
      )}
    </View>
  );
}

export default function ShoppingListScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const {
    items,
    status,
    error,
    isInitializing,
    isMutating,
    isItemPending,
    reload,
    addItem,
    setChecked,
    removeItem,
    clear,
  } = useShoppingList();

  const [refreshing, setRefreshing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const openPicker = useCallback(() => setPickerOpen(true), []);
  const closePicker = useCallback(() => setPickerOpen(false), []);

  // Reconcile with server truth on focus. `reload` is generation-guarded and
  // is a no-op while a mutation or another GET is already in flight.
  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

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

  const confirmClear = useCallback(() => {
    if (isMutating || items.length === 0) return;
    Alert.alert(
      'Clear shopping list?',
      'This removes every item from your shopping list.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            const result = await clear();
            if (!result.ok && result.error) {
              Alert.alert('Couldn’t clear list', result.error);
            }
          },
        },
      ]
    );
  }, [clear, isMutating, items.length]);

  const header = (
    <TopBar
      mode="back"
      title="Shopping List"
      onBack={() => navigation.goBack()}
      rightIcon={items.length > 0 ? 'trash-outline' : undefined}
      onRightPress={confirmClear}
    />
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

        <Pressable
          onPress={openPicker}
          disabled={isMutating}
          style={({ pressed }) => [
            styles.addBtn,
            pressed && !isMutating && styles.addBtnPressed,
            isMutating && styles.addBtnDisabled,
          ]}
        >
          <Ionicons
            name="add-circle-outline"
            size={18}
            color={isMutating ? colors.inkFaint : colors.sageDeep}
          />
          <Text style={[styles.addBtnText, isMutating && styles.addBtnTextDisabled]}>Add item</Text>
        </Pressable>

        {items.length === 0 ? (
          <Text style={styles.emptyText}>
            Your shopping list is empty. Add an ingredient above, or add everything from a recipe.
          </Text>
        ) : (
          items.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              disabled={isMutating}
              pending={isItemPending(item.id)}
              onToggle={() => onToggle(item)}
              onRemove={() => onRemove(item)}
            />
          ))
        )}
      </ScrollView>

      <IngredientPickerModal visible={pickerOpen} onClose={closePicker} onAdd={addItem} />
    </View>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
    addBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: colors.sage,
      borderRadius: radius.md,
      paddingVertical: spacing.md,
      marginBottom: spacing.lg,
    },
    addBtnPressed: { opacity: 0.6 },
    addBtnDisabled: { opacity: 0.5, borderColor: colors.hairline },
    addBtnText: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.sm,
      color: colors.sageDeep,
    },
    addBtnTextDisabled: { color: colors.inkFaint },
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
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.sm,
    },
    rowMain: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    rowTextWrap: { flex: 1 },
    rowSpinner: { marginLeft: spacing.sm, width: 29, alignItems: 'center' },
    removeBtn: {
      padding: spacing.xs,
      marginLeft: spacing.sm,
    },
    removeBtnPressed: { opacity: 0.5 },
    emptyText: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.inkFaint,
      paddingVertical: spacing.sm,
    },
    checkbox: {
      width: 21,
      height: 21,
      borderRadius: 6,
      borderWidth: 1.5,
      borderColor: colors.hairline,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxChecked: { backgroundColor: colors.sageDeep, borderColor: colors.sageDeep },
    itemText: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.md,
      color: colors.ink,
    },
    itemTextChecked: {
      color: colors.inkFaint,
      textDecorationLine: 'line-through',
    },
    itemTextUnavailable: {
      color: colors.inkFaint,
      fontStyle: 'italic',
    },
    itemSub: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.xs,
      color: colors.inkFaint,
      marginTop: 2,
    },
  });
}
