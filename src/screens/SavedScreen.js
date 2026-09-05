import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Image, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import { COLLECTIONS, recipes } from '../data/mockData';
import { useSavedRecipes } from '../context/SavedRecipesContext';
import { useCollections } from '../context/CollectionsContext';
import { collectionRecipes } from '../utils/recipe';
import { imageSource } from '../utils/image';

export default function SavedScreen({ navigation }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors);
  const { savedIds } = useSavedRecipes();
  const { collections: userCollections, addCollection } = useCollections();
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);

  const create = () => {
    const t = name.trim();
    if (t) addCollection(t);
    setName('');
    setAdding(false);
  };

  // Built-in "smart" collections + the user's own.
  const cards = [
    ...COLLECTIONS.map((c) => {
      const list = collectionRecipes(c, savedIds);
      return { id: c.id, title: c.title, recipeList: list };
    }),
    ...userCollections.map((c) => ({
      id: c.id,
      title: c.title,
      recipeList: recipes.filter((r) => c.recipeIds.includes(r.id)),
    })),
  ];

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.xl }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Pressable style={styles.iconBtn} hitSlop={6} onPress={() => navigation.goBack()}>
              <Ionicons name="arrow-back" size={18} color={colors.ink} />
            </Pressable>
            <Text style={styles.title}>My Collections</Text>
          </View>
          <View style={styles.headerActions}>
            <Pressable style={styles.iconBtn} hitSlop={6} onPress={() => navigation.navigate('Grocery')}>
              <Ionicons name="cart-outline" size={16} color={colors.ink} />
            </Pressable>
            <Pressable style={styles.iconBtn} hitSlop={6} onPress={() => setAdding((v) => !v)}>
              <Ionicons name={adding ? 'close' : 'add'} size={18} color={colors.ink} />
            </Pressable>
          </View>
        </View>

        {adding && (
          <View style={styles.newRow}>
            <TextInput
              style={styles.input}
              placeholder="New collection name"
              placeholderTextColor={colors.inkFaint}
              value={name}
              onChangeText={setName}
              autoFocus
              onSubmitEditing={create}
              returnKeyType="done"
            />
            <Pressable style={styles.createBtn} onPress={create}>
              <Text style={styles.createText}>Create</Text>
            </Pressable>
          </View>
        )}

        <View style={styles.grid}>
          {cards.map((c) => {
            const covers = c.recipeList.slice(0, 4);
            return (
              <Pressable
                key={c.id}
                style={styles.card}
                onPress={() =>
                  navigation.navigate('CollectionDetail', { collection: { id: c.id, title: c.title } })
                }
              >
                <View style={styles.cardImg}>
                  {covers.length === 0 ? (
                    <Ionicons name="bookmark-outline" size={18} color={colors.inkFaint} />
                  ) : covers.length === 1 ? (
                    <Image source={imageSource(covers[0].image)} style={styles.coverFull} />
                  ) : (
                    <View style={styles.coverGrid}>
                      {covers.map((r, i) => (
                        <Image key={r.id + i} source={imageSource(r.image)} style={styles.coverQuad} />
                      ))}
                    </View>
                  )}
                </View>
                <Text style={styles.cardTitle}>{c.title}</Text>
                <Text style={styles.cardCount}>
                  {c.recipeList.length} {c.recipeList.length === 1 ? 'recipe' : 'recipes'}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    flex: { flex: 1 },
    scroll: { paddingHorizontal: spacing.xl, paddingBottom: 120 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.lg,
    },
    title: { fontFamily: typography.display.fontFamily, fontSize: 24, color: colors.ink },
    headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    headerActions: { flexDirection: 'row', gap: 8 },
    iconBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.creamDeep,
      alignItems: 'center',
      justifyContent: 'center',
    },
    newRow: { flexDirection: 'row', gap: 8, marginBottom: spacing.lg },
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
    createBtn: {
      paddingHorizontal: 16,
      height: 44,
      borderRadius: radius.md,
      backgroundColor: colors.sageDeep,
      alignItems: 'center',
      justifyContent: 'center',
    },
    createText: { fontFamily: typography.body.semibold, fontSize: 13, color: colors.onAccent },
    grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 14 },
    card: { width: '47.5%' },
    cardImg: {
      height: 96,
      borderRadius: 14,
      backgroundColor: colors.creamDeep,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
    },
    coverFull: { width: '100%', height: '100%' },
    coverGrid: { width: '100%', height: '100%', flexDirection: 'row', flexWrap: 'wrap' },
    coverQuad: { width: '50%', height: '50%' },
    cardTitle: { fontFamily: typography.body.semibold, fontSize: 13.5, color: colors.ink, marginTop: 8 },
    cardCount: { fontFamily: typography.body.fontFamily, fontSize: 11.5, color: colors.inkFaint, marginTop: 2 },
  });
}
