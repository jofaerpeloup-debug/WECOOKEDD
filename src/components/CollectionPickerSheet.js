import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, ScrollView, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import { useCollections } from '../context/CollectionsContext';

/**
 * Bottom sheet to add/remove a recipe from the user's collections.
 */
export default function CollectionPickerSheet({ visible, onClose, recipeId }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors);
  const { collections, addCollection, toggleInCollection, isInCollection } = useCollections();
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);

  const createAndAdd = () => {
    const t = name.trim();
    if (!t) return;
    const id = addCollection(t);
    toggleInCollection(id, recipeId);
    setName('');
    setAdding(false);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.xl) }]}>
        <View style={styles.grabber} />
        <Text style={styles.title}>Add to collection</Text>

        <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
          {collections.length === 0 && !adding && (
            <Text style={styles.empty}>No collections yet. Create one below.</Text>
          )}
          {collections.map((c) => {
            const on = isInCollection(c.id, recipeId);
            return (
              <Pressable key={c.id} style={styles.row} onPress={() => toggleInCollection(c.id, recipeId)}>
                <View style={[styles.check, on && styles.checkOn]}>
                  {on && <Ionicons name="checkmark" size={13} color={colors.onAccent} />}
                </View>
                <Text style={styles.rowLabel}>{c.title}</Text>
                <Text style={styles.rowCount}>{c.recipeIds.length}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {adding ? (
          <View style={styles.newRow}>
            <TextInput
              style={styles.input}
              placeholder="Collection name"
              placeholderTextColor={colors.inkFaint}
              value={name}
              onChangeText={setName}
              autoFocus
              onSubmitEditing={createAndAdd}
              returnKeyType="done"
            />
            <Pressable style={styles.addBtn} onPress={createAndAdd}>
              <Text style={styles.addBtnText}>Add</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable style={styles.newTrigger} onPress={() => setAdding(true)}>
            <Ionicons name="add" size={16} color={colors.sageDeep} />
            <Text style={styles.newTriggerText}>New collection</Text>
          </Pressable>
        )}

        <Pressable style={styles.done} onPress={onClose}>
          <Text style={styles.doneText}>Done</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.overlay },
    sheet: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: colors.paper,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.md,
      maxHeight: '80%',
    },
    grabber: {
      alignSelf: 'center',
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.hairline,
      marginBottom: spacing.lg,
    },
    title: { fontFamily: typography.display.fontFamily, fontSize: 18, color: colors.ink, marginBottom: spacing.md },
    list: { flexGrow: 0 },
    empty: { fontFamily: typography.body.fontFamily, fontSize: 13, color: colors.inkFaint, paddingVertical: spacing.md },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: spacing.md },
    check: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 1.5,
      borderColor: colors.inkFaint,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkOn: { backgroundColor: colors.sageDeep, borderColor: colors.sageDeep },
    rowLabel: { flex: 1, fontFamily: typography.body.medium, fontSize: 14, color: colors.ink },
    rowCount: { fontFamily: typography.body.fontFamily, fontSize: 12, color: colors.inkFaint },
    newTrigger: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: spacing.md },
    newTriggerText: { fontFamily: typography.body.semibold, fontSize: 13.5, color: colors.sageDeep },
    newRow: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingVertical: spacing.md },
    input: {
      flex: 1,
      height: 44,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.hairline,
      paddingHorizontal: 14,
      fontFamily: typography.body.fontFamily,
      fontSize: 14,
      color: colors.ink,
      outlineStyle: 'none',
    },
    addBtn: {
      paddingHorizontal: 16,
      height: 44,
      borderRadius: radius.md,
      backgroundColor: colors.sageDeep,
      alignItems: 'center',
      justifyContent: 'center',
    },
    addBtnText: { fontFamily: typography.body.semibold, fontSize: 13, color: colors.onAccent },
    done: {
      marginTop: spacing.md,
      height: 50,
      borderRadius: radius.pill,
      backgroundColor: colors.creamDeep,
      alignItems: 'center',
      justifyContent: 'center',
    },
    doneText: { fontFamily: typography.body.semibold, fontSize: 14, color: colors.ink },
  });
}
