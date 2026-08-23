import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import TopBar from '../components/TopBar';
import Badge from '../components/Badge';
import { useShoppingList } from '../context/ShoppingListContext';

function Checkbox({ checked }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
      {checked && <Ionicons name="checkmark" size={13} color={colors.onAccent} />}
    </View>
  );
}

function Section({ title, items, onToggle, onRemove }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {items.map((item) => (
        <View key={item.id} style={styles.row}>
          <Pressable style={styles.rowMain} onPress={() => onToggle(item.id)}>
            <Checkbox checked={item.checked} />
            <Text style={[styles.itemText, item.checked && styles.itemTextChecked]}>
              {item.name}
            </Text>
            {item.badge && <Badge label={item.badge} tone="warning" />}
          </Pressable>
          <Pressable
            onPress={() => onRemove(item.id)}
            hitSlop={10}
            style={({ pressed }) => [styles.removeBtn, pressed && styles.removeBtnPressed]}
          >
            <Ionicons name="trash-outline" size={17} color={colors.error} />
          </Pressable>
        </View>
      ))}
      {items.length === 0 && <Text style={styles.emptyText}>No items in this section.</Text>}
    </View>
  );
}

export default function ShoppingListScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { list, toggle, remove, addItem } = useShoppingList();
  const [newItem, setNewItem] = useState('');

  const addManualItem = () => {
    if (!newItem.trim()) return;
    addItem('produce', newItem.trim());
    setNewItem('');
  };

  const recipeGroups = useMemo(() => {
    const groups = new Map();
    for (const item of list.recipeItems) {
      const key = item.source || 'From Recipes';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    return Array.from(groups.entries());
  }, [list.recipeItems]);

  return (
    <View style={styles.root}>
      <TopBar mode="back" title="Shopping List" onBack={() => navigation.goBack()} />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {recipeGroups.map(([recipeName, items]) => (
            <Section
              key={recipeName}
              title={recipeName}
              items={items}
              onToggle={(id) => toggle('recipeItems', id)}
              onRemove={(id) => remove('recipeItems', id)}
            />
          ))}
          <Section
            title="Produce"
            items={list.produce}
            onToggle={(id) => toggle('produce', id)}
            onRemove={(id) => remove('produce', id)}
          />
          <Section
            title="Pantry"
            items={list.pantry}
            onToggle={(id) => toggle('pantry', id)}
            onRemove={(id) => remove('pantry', id)}
          />
          <Section
            title="Dairy"
            items={list.dairy}
            onToggle={(id) => toggle('dairy', id)}
            onRemove={(id) => remove('dairy', id)}
          />
        </ScrollView>

        <View style={styles.addBar}>
          <TextInput
            style={styles.addInput}
            placeholder="Add an item... (e.g. '3 Honeycrisp Apples')"
            placeholderTextColor={colors.inkFaint}
            value={newItem}
            onChangeText={setNewItem}
            onSubmitEditing={addManualItem}
            returnKeyType="done"
          />
          <Pressable style={styles.addBtn} onPress={addManualItem}>
            <Ionicons name="add" size={20} color={colors.onAccent} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    scroll: { padding: spacing.lg, paddingBottom: spacing.xl },
    section: { marginBottom: spacing.xl },
    sectionTitle: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.xs,
      color: colors.inkFaint,
      letterSpacing: 1,
      marginBottom: spacing.md,
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
      flex: 1,
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.md,
      color: colors.ink,
    },
    itemTextChecked: {
      color: colors.inkFaint,
      textDecorationLine: 'line-through',
    },
    addBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      padding: spacing.lg,
      borderTopWidth: 1,
      borderTopColor: colors.hairline,
      backgroundColor: colors.paper,
    },
    addInput: {
      flex: 1,
      height: 44,
      borderRadius: radius.pill,
      backgroundColor: colors.creamDeep,
      paddingHorizontal: spacing.lg,
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.ink,
    },
    addBtn: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.sageDeep,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
}
