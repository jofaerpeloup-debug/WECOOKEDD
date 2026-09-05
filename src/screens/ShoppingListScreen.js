import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import { useShoppingList } from '../context/ShoppingListContext';

const GROUPS = ['Produce', 'Meat', 'Pantry'];

export default function ShoppingListScreen({ navigation }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors);
  const { items, toggle, remove, addCustom } = useShoppingList();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [qty, setQty] = useState('');

  const submitAdd = () => {
    if (!name.trim()) return;
    addCustom(name, qty);
    setName('');
    setQty('');
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.headerLeft}>
          <Pressable style={styles.backBtn} hitSlop={8} onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" size={18} color={colors.ink} />
          </Pressable>
          <Text style={styles.title}>Grocery List</Text>
        </View>
        <Pressable hitSlop={8} onPress={() => setEditing((v) => !v)}>
          <Text style={styles.edit}>{editing ? 'Done' : 'Edit'}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {items.length === 0 && (
          <Text style={styles.emptyList}>
            Your grocery list is empty. Add items below, or tap the cart icon on any recipe.
          </Text>
        )}
        {GROUPS.map((cat) => {
          const rows = items.filter((i) => i.cat === cat);
          if (rows.length === 0) return null;
          return (
            <View key={cat} style={styles.group}>
              <Text style={styles.groupLabel}>{cat}</Text>
              {rows.map((it) => (
                <Pressable
                  key={it.id}
                  style={styles.row}
                  onPress={() => (editing ? remove(it.id) : toggle(it.id))}
                >
                  <View style={styles.rowLeft}>
                    {editing ? (
                      <View style={styles.trash}>
                        <Ionicons name="remove" size={14} color={colors.onAccent} />
                      </View>
                    ) : (
                      <View style={[styles.check, it.checked && styles.checkOn]}>
                        {it.checked && <Ionicons name="checkmark" size={12} color={colors.onAccent} />}
                      </View>
                    )}
                    <Text style={[styles.name, !editing && it.checked && styles.nameChecked]}>{it.name}</Text>
                  </View>
                  <Text style={styles.qty}>{it.qty}</Text>
                </Pressable>
              ))}
            </View>
          );
        })}
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
    edit: { fontFamily: typography.body.medium, fontSize: 13, color: colors.stone },
    scroll: { paddingHorizontal: spacing.xl, paddingBottom: 120, paddingTop: spacing.sm },
    emptyList: {
      fontFamily: typography.body.fontFamily,
      fontSize: 13,
      color: colors.inkFaint,
      textAlign: 'center',
      lineHeight: 20,
      paddingVertical: 40,
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
    rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
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
    name: { fontFamily: typography.body.fontFamily, fontSize: 14, color: colors.ink },
    nameChecked: { color: colors.inkFaint, textDecorationLine: 'line-through' },
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
      outlineStyle: 'none',
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
