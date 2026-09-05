import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { typography, spacing } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import { recipes } from '../data/mockData';
import { metaLine, collectionRecipes } from '../utils/recipe';
import { imageSource } from '../utils/image';
import { useSavedRecipes } from '../context/SavedRecipesContext';
import { useCollections } from '../context/CollectionsContext';
import { confirm } from '../utils/alert';

export default function CollectionDetailScreen({ navigation, route }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors);
  const { savedIds } = useSavedRecipes();
  const { collections, toggleInCollection, removeCollection } = useCollections();
  const collection = route?.params?.collection || { title: 'Collection' };

  const userCollection = collections.find((c) => c.id === collection.id);
  const list = useMemo(() => {
    if (userCollection) return recipes.filter((r) => userCollection.recipeIds.includes(r.id));
    return collectionRecipes(collection, savedIds);
  }, [userCollection, collection, savedIds]);

  const confirmDelete = () =>
    confirm(
      'Delete collection',
      `Remove "${collection.title}"?`,
      () => {
        removeCollection(collection.id);
        navigation.goBack();
      },
      { confirmLabel: 'Delete', destructive: true }
    );

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable style={styles.backBtn} hitSlop={8} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={18} color={colors.ink} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{collection.title}</Text>
          <Text style={styles.count}>
            {list.length} {list.length === 1 ? 'recipe' : 'recipes'}
          </Text>
        </View>
        {userCollection && (
          <Pressable hitSlop={8} onPress={confirmDelete}>
            <Ionicons name="trash-outline" size={18} color={colors.error} />
          </Pressable>
        )}
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {list.length === 0 ? (
          <Text style={styles.empty}>
            {userCollection ? 'Add recipes from any recipe page.' : 'Nothing here yet.'}
          </Text>
        ) : (
          list.map((r) => (
            <View key={r.id} style={styles.row}>
              <Pressable
                style={styles.rowMain}
                onPress={() => navigation.navigate('RecipeDetail', { recipe: r })}
              >
                <Image source={imageSource(r.image)} style={styles.thumb} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{r.title}</Text>
                  <Text style={styles.rowMeta}>{metaLine(r)}</Text>
                </View>
              </Pressable>
              {userCollection && (
                <Pressable hitSlop={8} onPress={() => toggleInCollection(collection.id, r.id)} style={styles.remove}>
                  <Ionicons name="remove-circle-outline" size={20} color={colors.inkFaint} />
                </Pressable>
              )}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: spacing.xl,
      paddingBottom: spacing.md,
    },
    backBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.creamDeep,
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: { fontFamily: typography.display.fontFamily, fontSize: 20, color: colors.ink },
    count: { fontFamily: typography.body.fontFamily, fontSize: 12, color: colors.inkFaint, marginTop: 1 },
    scroll: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl, gap: 10 },
    empty: { fontFamily: typography.body.fontFamily, fontSize: 13, color: colors.inkFaint, textAlign: 'center', paddingVertical: 32 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.creamDeep,
      borderRadius: 14,
      paddingRight: 8,
    },
    rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10 },
    thumb: { width: 60, height: 60, borderRadius: 10, backgroundColor: colors.paper },
    rowTitle: { fontFamily: typography.body.semibold, fontSize: 13.5, color: colors.ink },
    rowMeta: { fontFamily: typography.body.fontFamily, fontSize: 11.5, color: colors.inkFaint, marginTop: 4 },
    remove: { padding: 6 },
  });
}
