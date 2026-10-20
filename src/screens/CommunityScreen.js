import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, FlatList, Pressable, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import TopBar from '../components/TopBar';
import AppImage from '../components/AppImage';
import EmptyState from '../components/EmptyState';
import FadeInView from '../components/FadeInView';
import { useTabBarScroll, TAB_BAR_CLEARANCE } from '../components/TabBarContext';
import { tapLight, tapMedium } from '../utils/haptics';
import { recipes, chef } from '../data/mockData';
import { useCommunity } from '../context/CommunityContext';
import { useProfile } from '../context/ProfileContext';
import { imageSource } from '../utils/image';
import { timeAgo } from '../utils/time';
import useFakeRefresh from '../hooks/useFakeRefresh';

const FEED_TABS = [
  { key: 'forYou', label: 'For You', icon: 'sparkles-outline' },
  { key: 'following', label: 'Following', icon: 'people-outline' },
  { key: 'trending', label: 'Trending', icon: 'flame-outline' },
  { key: 'saved', label: 'Saved', icon: 'bookmark-outline' },
];

export default function CommunityScreen({ navigation, route }) {
  const { colors, shadow, isDark } = useTheme();
  const accent = isDark ? colors.sage : colors.sageDeep;
  const { profile } = useProfile();
  const styles = makeStyles(colors, shadow, accent);
  // Rendered as the "Community" bottom tab (no back arrow); the `asTab`
  // guard mirrors the Swaps tab so a future pushed instance still works.
  const asTab = route.name === 'Community';
  const {
    posts,
    addPost,
    removePost,
    toggleLike,
    addComment,
    toggleFollow,
    isFollowing,
    toggleBookmark,
    isBookmarked,
  } = useCommunity();
  const tabScroll = useTabBarScroll();
  const { refreshing, onRefresh } = useFakeRefresh();
  const [caption, setCaption] = useState('');
  const [selectedRecipeId, setSelectedRecipeId] = useState(null);
  const [openComments, setOpenComments] = useState(null);
  const [commentDraft, setCommentDraft] = useState('');
  const [feedTab, setFeedTab] = useState('forYou'); // 'forYou' | 'following' | 'trending'

  const handleToggleLike = (id) => {
    tapLight();
    toggleLike(id);
  };

  const toggleComments = (id) => {
    tapLight();
    setCommentDraft('');
    setOpenComments((cur) => (cur === id ? null : id));
  };

  const submitComment = (postId) => {
    if (!commentDraft.trim()) return;
    tapMedium();
    addComment(postId, commentDraft);
    setCommentDraft('');
  };

  const selectedRecipe = recipes.find((r) => r.id === selectedRecipeId);

  const submitPost = () => {
    if (!caption.trim()) return;
    tapMedium();
    addPost({
      caption: caption.trim(),
      image: selectedRecipe?.image,
      recipeTag: selectedRecipe?.title,
      recipeId: selectedRecipe?.id,
      author: { name: profile.name, avatar: profile.avatar },
    });
    setCaption('');
    setSelectedRecipeId(null);
  };

  const engagement = (post) =>
    post.likes + (post.likedByMe ? 1 : 0) + (post.comments || 0) + (post.myComments?.length || 0);

  // Instagram-style split: only the Following tab is restricted to people
  // you follow. For You and Trending stay open to everyone — that's what
  // lets you discover a new cook's posts (and their Follow button) in the
  // first place.
  const visiblePosts = useMemo(() => {
    if (feedTab === 'following') return posts.filter((p) => isFollowing(p.author.name));
    if (feedTab === 'trending') return [...posts].sort((a, b) => engagement(b) - engagement(a));
    if (feedTab === 'saved') return posts.filter((p) => isBookmarked(p.id));
    return posts;
  }, [posts, feedTab, isFollowing, isBookmarked]);

  const header = (
    <>
      <View style={styles.feedTabRow}>
        {FEED_TABS.map((t) => {
          const active = feedTab === t.key;
          return (
            <Pressable
              key={t.key}
              style={[styles.feedTab, active && styles.feedTabActive]}
              onPress={() => {
                tapLight();
                setFeedTab(t.key);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Ionicons
                name={t.icon}
                size={14}
                color={active ? colors.onAccent : colors.inkSoft}
              />
              <Text style={[styles.feedTabText, active && styles.feedTabTextActive]}>
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.composeCard}>
        <View style={styles.composeHeader}>
          <AppImage source={imageSource(profile.avatar)} style={styles.avatar} />
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
                <AppImage source={imageSource(r.image)} style={styles.recipeThumb} />
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
    </>
  );

  const renderPost = ({ item: post, index }) => {
    const isLiked = !!post.likedByMe;
    const likeCount = post.likes + (isLiked ? 1 : 0);
    const myComments = post.myComments || [];
    const commentCount = (post.comments || 0) + myComments.length;
    const commentsOpen = openComments === post.id;
    const isMine = post.author.isMe || post.author.name === profile.name || post.author.name === chef.name;
    const authorName = post.author.isMe ? profile.name : post.author.name;
    const authorAvatar = post.author.isMe ? profile.avatar : post.author.avatar;
    const following = isFollowing(post.author.name);
    const bookmarked = isBookmarked(post.id);
    const taggedRecipe = post.recipeId
      ? recipes.find((r) => r.id === post.recipeId)
      : post.recipeTag
        ? recipes.find((r) => r.title === post.recipeTag)
        : null;
    return (
      <FadeInView style={styles.card} delay={Math.min(index, 6) * 45}>
        <View style={styles.postHeader}>
          <AppImage source={imageSource(authorAvatar)} style={styles.avatar} />
          <View style={{ flex: 1 }}>
            <Text style={styles.authorName}>{authorName}</Text>
            <Text style={styles.time}>{post.ts ? timeAgo(post.ts) : post.time}</Text>
          </View>
          {!isMine && (
            <Pressable
              style={[styles.followBtn, following && styles.followBtnOn]}
              onPress={() => {
                tapLight();
                toggleFollow(post.author.name);
              }}
              accessibilityRole="button"
              accessibilityLabel={following ? `Unfollow ${authorName}` : `Follow ${authorName}`}
              accessibilityState={{ selected: following }}
            >
              <Text style={[styles.followBtnText, following && styles.followBtnTextOn]}>
                {following ? 'Following' : 'Follow'}
              </Text>
            </Pressable>
          )}
          {isMine && (
            <Pressable
              onPress={() => removePost(post.id)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Delete post"
            >
              <Ionicons name="trash-outline" size={17} color={colors.inkFaint} />
            </Pressable>
          )}
        </View>

        {post.image && <AppImage source={imageSource(post.image)} style={styles.postImage} />}

        <View style={styles.postBody}>
          {post.recipeTag && (
            <View style={styles.tagRow}>
              <Ionicons name="restaurant-outline" size={12} color={accent} />
              <Text style={styles.tagText} numberOfLines={1}>{post.recipeTag}</Text>
            </View>
          )}
          <Text style={styles.caption}>{post.caption}</Text>

          {taggedRecipe && (
            <View style={styles.recipeCtaRow}>
              <Pressable
                style={styles.recipeCtaBtn}
                onPress={() => navigation.navigate('RecipeIngredients', { recipe: taggedRecipe })}
                accessibilityRole="button"
                accessibilityLabel={`View ${taggedRecipe.title} ingredients`}
              >
                <Text style={styles.recipeCtaText}>View Ingredients</Text>
              </Pressable>
            </View>
          )}

          <View style={styles.actionRow}>
            <Pressable
              style={styles.actionBtn}
              hitSlop={8}
              onPress={() => handleToggleLike(post.id)}
              accessibilityRole="button"
              accessibilityLabel={isLiked ? 'Unlike' : 'Like'}
              accessibilityState={{ selected: isLiked }}
            >
              <Ionicons
                name={isLiked ? 'heart' : 'heart-outline'}
                size={18}
                color={isLiked ? colors.error : colors.inkSoft}
              />
              <Text style={styles.actionText}>{likeCount}</Text>
            </Pressable>
            <Pressable
              style={styles.actionBtn}
              hitSlop={8}
              onPress={() => toggleComments(post.id)}
              accessibilityRole="button"
              accessibilityLabel={`${commentCount} comments`}
              accessibilityState={{ expanded: commentsOpen }}
            >
              <Ionicons
                name={commentsOpen ? 'chatbubble' : 'chatbubble-outline'}
                size={17}
                color={commentsOpen ? accent : colors.inkSoft}
              />
              <Text style={styles.actionText}>{commentCount}</Text>
            </Pressable>
            <View style={{ flex: 1 }} />
            <Pressable
              hitSlop={8}
              onPress={() => {
                tapLight();
                toggleBookmark(post.id);
              }}
              accessibilityRole="button"
              accessibilityLabel={bookmarked ? 'Remove bookmark' : 'Bookmark post'}
              accessibilityState={{ selected: bookmarked }}
            >
              <Ionicons
                name={bookmarked ? 'bookmark' : 'bookmark-outline'}
                size={18}
                color={bookmarked ? accent : colors.inkSoft}
              />
            </Pressable>
          </View>

          {commentsOpen && (
            <View style={styles.commentsPanel}>
              {post.comments > 0 && (
                <Text style={styles.commentsNote}>
                  {post.comments} earlier {post.comments === 1 ? 'comment' : 'comments'} from the
                  community aren’t shown in this demo.
                </Text>
              )}
              {myComments.length === 0 && !post.comments ? (
                <Text style={styles.commentsNote}>No comments yet — be the first.</Text>
              ) : (
                myComments.map((c) => (
                  <View key={c.id} style={styles.commentRow}>
                    <View style={styles.commentAvatar}>
                      <Ionicons name="person" size={12} color={accent} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.commentText}>
                        <Text style={styles.commentAuthor}>You </Text>
                        {c.text}
                      </Text>
                      <Text style={styles.commentTime}>{timeAgo(c.ts)}</Text>
                    </View>
                  </View>
                ))
              )}
              <View style={styles.commentInputRow}>
                <TextInput
                  style={styles.commentInput}
                  placeholder="Add a comment..."
                  placeholderTextColor={colors.inkFaint}
                  value={commentDraft}
                  onChangeText={setCommentDraft}
                  onSubmitEditing={() => submitComment(post.id)}
                  returnKeyType="send"
                />
                <Pressable
                  style={[styles.commentSend, !commentDraft.trim() && styles.commentSendOff]}
                  onPress={() => submitComment(post.id)}
                  disabled={!commentDraft.trim()}
                  accessibilityRole="button"
                  accessibilityLabel="Send comment"
                >
                  <Ionicons name="arrow-up" size={15} color={colors.onAccent} />
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </FadeInView>
    );
  };

  return (
    <View style={styles.root}>
      <TopBar title="Community" onBack={asTab ? undefined : () => navigation.goBack()} />

      <FlatList
        data={visiblePosts}
        keyExtractor={(post) => String(post.id)}
        renderItem={renderPost}
        ListHeaderComponent={header}
        ListEmptyComponent={
          feedTab === 'following' ? (
            <EmptyState
              icon="people-outline"
              title="Not following anyone yet"
              message="Tap Follow on a post's author to see their cooking here."
            />
          ) : feedTab === 'saved' ? (
            <EmptyState
              icon="bookmark-outline"
              title="No saved posts yet"
              message="Tap the bookmark icon on a post to find it here later."
            />
          ) : (
            <EmptyState
              icon="people-outline"
              title="No posts yet"
              message="Be the first to share what you're cooking — add a caption above and tap Post."
            />
          )
        }
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        removeClippedSubviews={false}
        refreshing={refreshing}
        onRefresh={onRefresh}
        {...tabScroll}
      />
    </View>
  );
}

function makeStyles(colors, shadow, accent) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    scroll: { padding: spacing.lg, paddingBottom: TAB_BAR_CLEARANCE },
    composeCard: {
      backgroundColor: colors.paper,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.hairline,
      padding: spacing.md,
      marginBottom: spacing.xl,
      ...shadow.soft,
    },
    feedTabRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginBottom: spacing.xl,
    },
    feedTab: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 5,
      paddingVertical: 9,
      borderRadius: radius.pill,
      backgroundColor: colors.paper,
      borderWidth: 1,
      borderColor: colors.hairline,
    },
    feedTabActive: { backgroundColor: colors.sageDeep, borderColor: colors.sageDeep },
    feedTabText: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.xs,
      color: colors.inkSoft,
    },
    feedTabTextActive: { color: colors.onAccent },
    followBtn: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: accent,
    },
    followBtnOn: { backgroundColor: colors.sagePale },
    followBtnText: {
      fontFamily: typography.body.semibold,
      fontSize: 11.5,
      color: accent,
    },
    followBtnTextOn: { color: accent },
    recipeCtaRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
    recipeCtaBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 5,
      height: 36,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: accent,
    },
    recipeCtaText: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.xs,
      color: accent,
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
      color: accent,
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
      color: accent,
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
    commentsPanel: {
      marginTop: spacing.md,
      paddingTop: spacing.md,
      borderTopWidth: 1,
      borderTopColor: colors.hairline,
      gap: spacing.sm,
    },
    commentsNote: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.xs,
      color: colors.inkFaint,
      lineHeight: 16,
    },
    commentRow: { flexDirection: 'row', gap: spacing.sm },
    commentAvatar: {
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: colors.sagePale,
      alignItems: 'center',
      justifyContent: 'center',
    },
    commentAuthor: { fontFamily: typography.body.semibold, color: colors.ink },
    commentText: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.ink,
      lineHeight: 18,
    },
    commentTime: {
      fontFamily: typography.body.fontFamily,
      fontSize: 10.5,
      color: colors.inkFaint,
      marginTop: 1,
    },
    commentInputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
    commentInput: {
      flex: 1,
      height: 38,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.hairline,
      backgroundColor: colors.cream,
      paddingHorizontal: spacing.md,
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.ink,
      outlineStyle: 'none',
    },
    commentSend: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: colors.sageDeep,
      alignItems: 'center',
      justifyContent: 'center',
    },
    commentSendOff: { backgroundColor: colors.hairline },
  });
}
