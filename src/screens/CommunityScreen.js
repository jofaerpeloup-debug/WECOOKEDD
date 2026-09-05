import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, Pressable, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import TopBar from '../components/TopBar';
import { recipes, chef } from '../data/mockData';
import { useCommunity } from '../context/CommunityContext';
import { imageSource } from '../utils/image';

export default function CommunityScreen({ navigation, route }) {
  const { colors, shadow } = useTheme();
  const styles = makeStyles(colors, shadow);
  // Rendered as the "Community" bottom tab (no back arrow); the `asTab`
  // guard mirrors the Swaps tab so a future pushed instance still works.
  const asTab = route.name === 'Community';
  const { posts, addPost, removePost } = useCommunity();
  const [liked, setLiked] = useState({});
  const [caption, setCaption] = useState('');
  const [selectedRecipeId, setSelectedRecipeId] = useState(null);

  const toggleLike = (id) => setLiked((prev) => ({ ...prev, [id]: !prev[id] }));

  const selectedRecipe = recipes.find((r) => r.id === selectedRecipeId);

  const submitPost = () => {
    if (!caption.trim()) return;
    addPost({
      caption: caption.trim(),
      image: selectedRecipe?.image,
      recipeTag: selectedRecipe?.title,
    });
    setCaption('');
    setSelectedRecipeId(null);
  };

  return (
    <View style={styles.root}>
      <TopBar title="Community" onBack={asTab ? undefined : () => navigation.goBack()} />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.subtitle}>See what other home cooks are making.</Text>

        <View style={styles.composeCard}>
          <View style={styles.composeHeader}>
            <Image source={imageSource(chef.avatar)} style={styles.avatar} />
            <TextInput
              style={styles.composeInput}
              placeholder="Share what you're cooking..."
              placeholderTextColor={colors.inkFaint}
              value={caption}
              onChangeText={setCaption}
              multiline
            />
          </View>

          <Text style={styles.composeLabel}>Tag a recipe (optional)</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.recipePickerRow}
          >
            {recipes.map((r) => {
              const active = r.id === selectedRecipeId;
              return (
                <Pressable
                  key={r.id}
                  style={[styles.recipeThumbWrap, active && styles.recipeThumbWrapActive]}
                  onPress={() => setSelectedRecipeId((prev) => (prev === r.id ? null : r.id))}
                >
                  <Image source={imageSource(r.image)} style={styles.recipeThumb} />
                  {active && (
                    <View style={styles.recipeThumbCheck}>
                      <Ionicons name="checkmark" size={12} color={colors.onAccent} />
                    </View>
                  )}
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={styles.composeFooter}>
            <Text style={styles.composeTagText} numberOfLines={1}>
              {selectedRecipe ? `Tagging: ${selectedRecipe.title}` : ' '}
            </Text>
            <Pressable
              style={[styles.postBtn, !caption.trim() && styles.postBtnDisabled]}
              onPress={submitPost}
              disabled={!caption.trim()}
            >
              <Text style={styles.postBtnText}>Post</Text>
            </Pressable>
          </View>
        </View>

        {posts.map((post) => {
          const isLiked = !!liked[post.id];
          const likeCount = post.likes + (isLiked ? 1 : 0);
          const isMine = post.author.name === chef.name;
          return (
            <View key={post.id} style={styles.card}>
              <View style={styles.postHeader}>
                <Image source={imageSource(post.author.avatar)} style={styles.avatar} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.authorName}>{post.author.name}</Text>
                  <Text style={styles.time}>{post.time}</Text>
                </View>
                {isMine && (
                  <Pressable onPress={() => removePost(post.id)} hitSlop={8}>
                    <Ionicons name="trash-outline" size={17} color={colors.inkFaint} />
                  </Pressable>
                )}
              </View>

              {post.image && (
                <Image source={imageSource(post.image)} style={styles.postImage} />
              )}

              <View style={styles.postBody}>
                {post.recipeTag && (
                  <View style={styles.tagRow}>
                    <Ionicons name="restaurant-outline" size={12} color={colors.sageDeep} />
                    <Text style={styles.tagText} numberOfLines={1}>{post.recipeTag}</Text>
                  </View>
                )}
                <Text style={styles.caption}>{post.caption}</Text>

                <View style={styles.actionRow}>
                  <Pressable style={styles.actionBtn} hitSlop={8} onPress={() => toggleLike(post.id)}>
                    <Ionicons
                      name={isLiked ? 'heart' : 'heart-outline'}
                      size={18}
                      color={isLiked ? colors.error : colors.inkSoft}
                    />
                    <Text style={styles.actionText}>{likeCount}</Text>
                  </Pressable>
                  <View style={styles.actionBtn}>
                    <Ionicons name="chatbubble-outline" size={17} color={colors.inkSoft} />
                    <Text style={styles.actionText}>{post.comments}</Text>
                  </View>
                </View>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

function makeStyles(colors, shadow) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
    subtitle: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.inkSoft,
      marginBottom: spacing.lg,
      lineHeight: 19,
    },
    composeCard: {
      backgroundColor: colors.paper,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.hairline,
      padding: spacing.md,
      marginBottom: spacing.xl,
      ...shadow.soft,
    },
    composeHeader: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
    composeInput: {
      flex: 1,
      minHeight: 40,
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.ink,
      paddingTop: 8,
      outlineStyle: 'none',
    },
    composeLabel: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.xs,
      color: colors.inkFaint,
      marginBottom: spacing.sm,
    },
    recipePickerRow: { gap: spacing.sm, paddingBottom: spacing.sm },
    recipeThumbWrap: {
      width: 52,
      height: 52,
      borderRadius: radius.md,
      overflow: 'hidden',
      borderWidth: 2,
      borderColor: 'transparent',
    },
    recipeThumbWrapActive: { borderColor: colors.sageDeep },
    recipeThumb: { width: '100%', height: '100%' },
    recipeThumbCheck: {
      position: 'absolute',
      top: 2,
      right: 2,
      width: 16,
      height: 16,
      borderRadius: 8,
      backgroundColor: colors.sageDeep,
      alignItems: 'center',
      justifyContent: 'center',
    },
    composeFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
      marginTop: spacing.xs,
    },
    composeTagText: {
      flex: 1,
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.xs,
      color: colors.sageDeep,
    },
    postBtn: {
      backgroundColor: colors.sageDeep,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.lg,
      paddingVertical: 8,
    },
    postBtnDisabled: { backgroundColor: colors.hairline },
    postBtnText: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.sm,
      color: colors.onAccent,
    },
    card: {
      backgroundColor: colors.paper,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.hairline,
      overflow: 'hidden',
      marginBottom: spacing.lg,
      ...shadow.soft,
    },
    postHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      padding: spacing.md,
    },
    avatar: { width: 36, height: 36, borderRadius: 18 },
    authorName: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.sm,
      color: colors.ink,
    },
    time: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.xs,
      color: colors.inkFaint,
      marginTop: 1,
    },
    postImage: { width: '100%', height: 200 },
    postBody: { padding: spacing.md },
    tagRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: spacing.xs },
    tagText: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.xs,
      color: colors.sageDeep,
      flexShrink: 1,
    },
    caption: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.ink,
      lineHeight: 19,
      marginBottom: spacing.sm,
    },
    actionRow: { flexDirection: 'row', gap: spacing.lg },
    actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    actionText: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.xs,
      color: colors.inkSoft,
    },
  });
}
