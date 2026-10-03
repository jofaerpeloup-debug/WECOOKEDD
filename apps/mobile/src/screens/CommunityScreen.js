import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../context/AuthContext';
import TopBar from '../components/TopBar';
import RecipeImage from '../components/RecipeImage';
import { listRecipes } from '../api/recipeService';
import {
  createCommunityPost,
  createCommunityComment,
  deleteCommunityComment,
  deleteCommunityPost,
  listCommunityComments,
  listCommunityPosts,
  setCommunityPostLiked,
} from '../api/communityService';
import { getCommunityErrorMessage } from '../api/communityErrors';
import { formatCommunityTime } from '../utils/communityTime';
import { notify } from '../utils/alert';

const PAGE_SIZE = 20;
const RECIPE_PAGE_SIZE = 20;
const MAX_CAPTION_LENGTH = 2000;
const MAX_COMMENT_LENGTH = 1000;

function initialFor(name) {
  return (name || 'C').trim().charAt(0).toUpperCase() || 'C';
}

function appendUnique(existing, incoming) {
  const seen = new Set(existing.map((item) => item.id));
  return [...existing, ...incoming.filter((item) => !seen.has(item.id))];
}

export default function CommunityScreen() {
  const { colors, shadow } = useTheme();
  const { user } = useAuth();
  const styles = makeStyles(colors, shadow);
  const ownerId = user?.id || null;

  const [caption, setCaption] = useState('');
  const [selectedRecipe, setSelectedRecipe] = useState(null);
  const [posting, setPosting] = useState(false);
  const [posts, setPosts] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [feedStatus, setFeedStatus] = useState('loading');
  const [feedError, setFeedError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [feedReloadKey, setFeedReloadKey] = useState(0);
  const [recipeQuery, setRecipeQuery] = useState('');
  const [recipes, setRecipes] = useState([]);
  const [recipePagination, setRecipePagination] = useState(null);
  const [recipeStatus, setRecipeStatus] = useState('loading');
  const [recipeReloadKey, setRecipeReloadKey] = useState(0);
  const [loadingMoreRecipes, setLoadingMoreRecipes] = useState(false);
  const [activePostId, setActivePostId] = useState(null);
  const [comments, setComments] = useState([]);
  const [commentPagination, setCommentPagination] = useState(null);
  const [commentStatus, setCommentStatus] = useState('closed');
  const [commentError, setCommentError] = useState('');
  const [commentActionError, setCommentActionError] = useState('');
  const [commentDraft, setCommentDraft] = useState('');
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [loadingMoreComments, setLoadingMoreComments] = useState(false);

  const ownerRef = useRef(ownerId);
  const mountedGenerationRef = useRef(0);
  const feedGenerationRef = useRef(0);
  const feedOperationRef = useRef(null);
  const feedMutationVersionRef = useRef(0);
  const postCreateOperationRef = useRef(null);
  const recipeGenerationRef = useRef(0);
  const pendingLikesRef = useRef(new Map());
  const pendingDeletesRef = useRef(new Map());
  const activePostRef = useRef(null);
  const commentGenerationRef = useRef(0);
  const commentMutationVersionRef = useRef(0);
  const commentMutationSequenceRef = useRef(0);
  const commentAppliedMutationRef = useRef(0);
  const commentReadOperationRef = useRef(null);
  const commentCreateOperationRef = useRef(null);
  const pendingCommentDeletesRef = useRef(new Map());
  const [, forcePendingRender] = useState(0);

  const clearCommentPanel = () => {
    commentGenerationRef.current += 1;
    activePostRef.current = null;
    commentReadOperationRef.current = null;
    commentCreateOperationRef.current = null;
    pendingCommentDeletesRef.current.clear();
    setActivePostId(null);
    setComments([]);
    setCommentPagination(null);
    setCommentStatus('closed');
    setCommentError('');
    setCommentActionError('');
    setCommentDraft('');
    setCommentSubmitting(false);
    setLoadingMoreComments(false);
  };

  useEffect(() => {
    mountedGenerationRef.current += 1;
    return () => {
      mountedGenerationRef.current += 1;
      feedGenerationRef.current += 1;
      commentGenerationRef.current += 1;
      feedOperationRef.current = null;
      postCreateOperationRef.current = null;
      commentReadOperationRef.current = null;
      commentCreateOperationRef.current = null;
      pendingLikesRef.current.clear();
      pendingDeletesRef.current.clear();
      pendingCommentDeletesRef.current.clear();
    };
  }, []);

  useEffect(() => {
    ownerRef.current = ownerId;
    pendingLikesRef.current.clear();
    pendingDeletesRef.current.clear();
    feedOperationRef.current = null;
    postCreateOperationRef.current = null;
    feedGenerationRef.current += 1;
    setCaption('');
    setSelectedRecipe(null);
    setPosting(false);
    setRecipeQuery('');
    clearCommentPanel();
    forcePendingRender((value) => value + 1);
  }, [ownerId]);

  useEffect(() => {
    setPosts([]);
    setPagination(null);
    setFeedError('');
    setRefreshing(false);
    setLoadingMore(false);

    const generation = ++feedGenerationRef.current;
    const operation = {};
    const mutationVersion = feedMutationVersionRef.current;
    feedOperationRef.current = operation;
    if (!ownerId) {
      setFeedStatus('error');
      return undefined;
    }
    setFeedStatus('loading');
    (async () => {
      let requestMutationVersion = mutationVersion;
      while (operation === feedOperationRef.current
        && generation === feedGenerationRef.current && ownerRef.current === ownerId) {
        try {
          const result = await listCommunityPosts({ page: 1, limit: PAGE_SIZE });
          if (operation !== feedOperationRef.current || generation !== feedGenerationRef.current
            || ownerRef.current !== ownerId) return;
          if (requestMutationVersion !== feedMutationVersionRef.current) {
            requestMutationVersion = feedMutationVersionRef.current;
            continue;
          }
          setPosts(result.posts);
          setPagination(result.pagination);
          setFeedStatus('ready');
          feedOperationRef.current = null;
        } catch (error) {
          if (operation !== feedOperationRef.current || generation !== feedGenerationRef.current
            || ownerRef.current !== ownerId) return;
          if (requestMutationVersion !== feedMutationVersionRef.current) {
            requestMutationVersion = feedMutationVersionRef.current;
            continue;
          }
          setFeedError(getCommunityErrorMessage(error));
          setFeedStatus('error');
          feedOperationRef.current = null;
        }
      }
    })();
    return () => {
      if (feedOperationRef.current === operation) feedOperationRef.current = null;
      feedGenerationRef.current += 1;
    };
  }, [ownerId, feedReloadKey]);

  useEffect(() => {
    setRecipes([]);
    setRecipePagination(null);
    setLoadingMoreRecipes(false);
    const generation = ++recipeGenerationRef.current;
    if (!ownerId) {
      setRecipeStatus('error');
      return undefined;
    }
    setRecipeStatus('loading');
    const timer = setTimeout(async () => {
      try {
        const result = await listRecipes({
          search: recipeQuery.trim() || undefined,
          page: 1,
          limit: RECIPE_PAGE_SIZE,
          sort: 'titleAsc',
        });
        if (generation !== recipeGenerationRef.current || ownerRef.current !== ownerId) return;
        setRecipes(result.recipes);
        setRecipePagination(result.pagination);
        setRecipeStatus('ready');
      } catch {
        if (generation !== recipeGenerationRef.current || ownerRef.current !== ownerId) return;
        setRecipeStatus('error');
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      recipeGenerationRef.current += 1;
    };
  }, [ownerId, recipeQuery, recipeReloadKey]);

  const refreshFeed = async () => {
    if (!ownerId) return;
    const requestOwner = ownerId;
    const generation = ++feedGenerationRef.current;
    const screenGeneration = mountedGenerationRef.current;
    const mutationVersion = feedMutationVersionRef.current;
    const operation = {};
    feedOperationRef.current = operation;
    setLoadingMore(false);
    setRefreshing(true);
    try {
      const result = await listCommunityPosts({ page: 1, limit: PAGE_SIZE });
      if (operation !== feedOperationRef.current || generation !== feedGenerationRef.current
        || screenGeneration !== mountedGenerationRef.current || ownerRef.current !== requestOwner
        || mutationVersion !== feedMutationVersionRef.current) return;
      setPosts(result.posts);
      setPagination(result.pagination);
      setFeedError('');
      setFeedStatus('ready');
    } catch (error) {
      if (operation === feedOperationRef.current && generation === feedGenerationRef.current
        && screenGeneration === mountedGenerationRef.current && ownerRef.current === requestOwner
        && mutationVersion === feedMutationVersionRef.current) {
        notify('Couldn’t refresh Community', getCommunityErrorMessage(error));
      }
    } finally {
      if (operation === feedOperationRef.current && generation === feedGenerationRef.current
        && screenGeneration === mountedGenerationRef.current && ownerRef.current === requestOwner) {
        setRefreshing(false);
        feedOperationRef.current = null;
      }
    }
  };

  const loadMorePosts = async () => {
    if (!ownerId || feedOperationRef.current || feedStatus !== 'ready' || !pagination || pagination.page >= pagination.totalPages) return;
    const requestOwner = ownerId;
    const generation = feedGenerationRef.current;
    const screenGeneration = mountedGenerationRef.current;
    const mutationVersion = feedMutationVersionRef.current;
    const operation = {};
    feedOperationRef.current = operation;
    setLoadingMore(true);
    try {
      const result = await listCommunityPosts({ page: pagination.page + 1, limit: PAGE_SIZE });
      if (operation !== feedOperationRef.current || generation !== feedGenerationRef.current
        || screenGeneration !== mountedGenerationRef.current || ownerRef.current !== requestOwner
        || mutationVersion !== feedMutationVersionRef.current) return;
      setPosts((current) => appendUnique(current, result.posts));
      setPagination(result.pagination);
    } catch (error) {
      if (operation === feedOperationRef.current && generation === feedGenerationRef.current
        && screenGeneration === mountedGenerationRef.current && ownerRef.current === requestOwner
        && mutationVersion === feedMutationVersionRef.current) {
        notify('Couldn’t load more posts', getCommunityErrorMessage(error));
      }
    } finally {
      if (operation === feedOperationRef.current && generation === feedGenerationRef.current
        && screenGeneration === mountedGenerationRef.current && ownerRef.current === requestOwner) {
        setLoadingMore(false);
        feedOperationRef.current = null;
      }
    }
  };

  const loadMoreRecipes = async () => {
    if (!ownerId || loadingMoreRecipes || recipeStatus !== 'ready' || !recipePagination || recipePagination.page >= recipePagination.totalPages) return;
    const requestOwner = ownerId;
    const generation = recipeGenerationRef.current;
    setLoadingMoreRecipes(true);
    try {
      const result = await listRecipes({
        search: recipeQuery.trim() || undefined,
        page: recipePagination.page + 1,
        limit: RECIPE_PAGE_SIZE,
        sort: 'titleAsc',
      });
      if (generation !== recipeGenerationRef.current || ownerRef.current !== requestOwner) return;
      setRecipes((current) => appendUnique(current, result.recipes));
      setRecipePagination(result.pagination);
    } catch (error) {
      if (generation === recipeGenerationRef.current && ownerRef.current === requestOwner) {
        notify('Couldn’t load recipes', getCommunityErrorMessage(error));
      }
    } finally {
      if (generation === recipeGenerationRef.current && ownerRef.current === requestOwner) setLoadingMoreRecipes(false);
    }
  };

  const submitPost = async () => {
    const trimmed = caption.trim();
    if (!trimmed || postCreateOperationRef.current || !ownerId) return;
    const requestOwner = ownerId;
    const screenGeneration = mountedGenerationRef.current;
    const operation = {};
    postCreateOperationRef.current = operation;
    setPosting(true);
    try {
      const post = await createCommunityPost({ caption: trimmed, recipeId: selectedRecipe?.id });
      if (postCreateOperationRef.current !== operation || ownerRef.current !== requestOwner
        || screenGeneration !== mountedGenerationRef.current) return;
      feedMutationVersionRef.current += 1;
      setPosts((current) => [post, ...current.filter((item) => item.id !== post.id)]);
      setPagination((current) => current ? {
        ...current,
        total: current.total + 1,
        totalPages: Math.ceil((current.total + 1) / current.limit),
      } : current);
      setFeedStatus('ready');
      setCaption('');
      setSelectedRecipe(null);
    } catch (error) {
      if (postCreateOperationRef.current === operation && ownerRef.current === requestOwner
        && screenGeneration === mountedGenerationRef.current) notify('Couldn’t publish post', getCommunityErrorMessage(error));
    } finally {
      if (postCreateOperationRef.current === operation) {
        postCreateOperationRef.current = null;
        if (ownerRef.current === requestOwner && screenGeneration === mountedGenerationRef.current) setPosting(false);
      }
    }
  };

  // Pessimistic, single-flight mutation: UI changes only to the server-returned
  // count/state, so failure needs no rollback and rapid taps cannot drift.
  const toggleLike = async (post) => {
    if (!ownerId || pendingLikesRef.current.has(post.id)) return;
    const requestOwner = ownerId;
    const screenGeneration = mountedGenerationRef.current;
    const operation = {};
    pendingLikesRef.current.set(post.id, operation);
    forcePendingRender((value) => value + 1);
    try {
      const state = await setCommunityPostLiked(post.id, !post.likedByCurrentUser);
      if (pendingLikesRef.current.get(post.id) !== operation || ownerRef.current !== requestOwner
        || screenGeneration !== mountedGenerationRef.current) return;
      feedMutationVersionRef.current += 1;
      setPosts((current) => current.map((item) => item.id === post.id
        ? { ...item, likedByCurrentUser: state.liked, likeCount: state.likeCount }
        : item));
    } catch (error) {
      if (pendingLikesRef.current.get(post.id) === operation && ownerRef.current === requestOwner
        && screenGeneration === mountedGenerationRef.current) notify('Couldn’t update like', getCommunityErrorMessage(error));
    } finally {
      if (pendingLikesRef.current.get(post.id) === operation) {
        pendingLikesRef.current.delete(post.id);
        if (ownerRef.current === requestOwner && screenGeneration === mountedGenerationRef.current) forcePendingRender((value) => value + 1);
      }
    }
  };

  const removePost = async (postId) => {
    if (!ownerId || pendingDeletesRef.current.has(postId)) return;
    const requestOwner = ownerId;
    const screenGeneration = mountedGenerationRef.current;
    const operation = {};
    pendingDeletesRef.current.set(postId, operation);
    forcePendingRender((value) => value + 1);
    try {
      await deleteCommunityPost(postId);
      if (pendingDeletesRef.current.get(postId) !== operation || ownerRef.current !== requestOwner
        || screenGeneration !== mountedGenerationRef.current) return;
      feedMutationVersionRef.current += 1;
      setPosts((current) => current.filter((post) => post.id !== postId));
      setPagination((current) => current ? {
        ...current,
        total: Math.max(0, current.total - 1),
        totalPages: Math.ceil(Math.max(0, current.total - 1) / current.limit),
      } : current);
      if (activePostRef.current === postId) clearCommentPanel();
    } catch (error) {
      if (pendingDeletesRef.current.get(postId) === operation && ownerRef.current === requestOwner
        && screenGeneration === mountedGenerationRef.current) notify('Couldn’t delete post', getCommunityErrorMessage(error));
    } finally {
      if (pendingDeletesRef.current.get(postId) === operation) {
        pendingDeletesRef.current.delete(postId);
        if (ownerRef.current === requestOwner && screenGeneration === mountedGenerationRef.current) forcePendingRender((value) => value + 1);
      }
    }
  };

  const replacePostCommentCount = (postId, commentCount) => {
    feedMutationVersionRef.current += 1;
    setPosts((current) => current.map((post) =>
      post.id === postId ? { ...post, commentCount } : post));
  };

  const loadCommentPage = async (postId, page, replace) => {
    if (!ownerId || activePostRef.current !== postId || commentReadOperationRef.current) return;
    const requestOwner = ownerId;
    const screenGeneration = mountedGenerationRef.current;
    const generation = commentGenerationRef.current;
    const mutationVersion = commentMutationVersionRef.current;
    const operation = {};
    commentReadOperationRef.current = operation;
    setCommentActionError('');
    if (replace) {
      setCommentStatus('loading');
      setCommentError('');
    } else {
      setLoadingMoreComments(true);
    }
    try {
      const result = await listCommunityComments(postId, { page, limit: PAGE_SIZE });
      if (commentReadOperationRef.current !== operation
        || activePostRef.current !== postId
        || generation !== commentGenerationRef.current
        || screenGeneration !== mountedGenerationRef.current
        || ownerRef.current !== requestOwner
        || mutationVersion !== commentMutationVersionRef.current) return;
      setComments((current) => replace ? result.comments : appendUnique(current, result.comments));
      setCommentPagination(result.pagination);
      setCommentError('');
      setCommentStatus('ready');
      replacePostCommentCount(postId, result.commentCount);
    } catch (error) {
      if (commentReadOperationRef.current !== operation
        || activePostRef.current !== postId
        || generation !== commentGenerationRef.current
        || screenGeneration !== mountedGenerationRef.current
        || ownerRef.current !== requestOwner) return;
      const message = getCommunityErrorMessage(error);
      if (replace) {
        setCommentError(message);
        setCommentStatus('error');
      } else {
        setCommentActionError(`Couldn’t load more comments. ${message}`);
      }
    } finally {
      if (commentReadOperationRef.current === operation) {
        commentReadOperationRef.current = null;
        if (activePostRef.current === postId
          && generation === commentGenerationRef.current
          && screenGeneration === mountedGenerationRef.current
          && ownerRef.current === requestOwner) setLoadingMoreComments(false);
      }
    }
  };

  const toggleComments = (postId) => {
    if (activePostRef.current === postId) {
      clearCommentPanel();
      return;
    }
    clearCommentPanel();
    activePostRef.current = postId;
    setActivePostId(postId);
    setCommentStatus('loading');
    loadCommentPage(postId, 1, true);
  };

  const submitComment = async (postId) => {
    const trimmedDraft = commentDraft.trim();
    if (!trimmedDraft || !ownerId || activePostRef.current !== postId
      || commentCreateOperationRef.current) return;
    const requestOwner = ownerId;
    const screenGeneration = mountedGenerationRef.current;
    const generation = commentGenerationRef.current;
    const mutationSequence = ++commentMutationSequenceRef.current;
    const operation = {};
    commentCreateOperationRef.current = operation;
    setCommentSubmitting(true);
    setCommentActionError('');
    try {
      const result = await createCommunityComment(postId, trimmedDraft);
      if (commentCreateOperationRef.current !== operation
        || activePostRef.current !== postId
        || generation !== commentGenerationRef.current
        || screenGeneration !== mountedGenerationRef.current
        || ownerRef.current !== requestOwner) return;
      commentMutationVersionRef.current += 1;
      setComments((current) => [
        result.comment,
        ...current.filter((comment) => comment.id !== result.comment.id),
      ]);
      if (mutationSequence >= commentAppliedMutationRef.current) {
        commentAppliedMutationRef.current = mutationSequence;
        replacePostCommentCount(postId, result.commentCount);
      }
      setCommentDraft('');
      setCommentStatus('ready');
    } catch (error) {
      if (commentCreateOperationRef.current === operation
        && activePostRef.current === postId
        && generation === commentGenerationRef.current
        && screenGeneration === mountedGenerationRef.current
        && ownerRef.current === requestOwner) {
        setCommentActionError(`Couldn’t add comment. ${getCommunityErrorMessage(error)}`);
      }
    } finally {
      if (commentCreateOperationRef.current === operation) {
        commentCreateOperationRef.current = null;
        if (activePostRef.current === postId
          && generation === commentGenerationRef.current
          && screenGeneration === mountedGenerationRef.current
          && ownerRef.current === requestOwner) setCommentSubmitting(false);
      }
    }
  };

  const removeComment = async (postId, commentId) => {
    if (!ownerId || activePostRef.current !== postId
      || pendingCommentDeletesRef.current.has(commentId)) return;
    const requestOwner = ownerId;
    const screenGeneration = mountedGenerationRef.current;
    const generation = commentGenerationRef.current;
    const mutationSequence = ++commentMutationSequenceRef.current;
    const operation = {};
    pendingCommentDeletesRef.current.set(commentId, operation);
    setCommentActionError('');
    forcePendingRender((value) => value + 1);
    try {
      const result = await deleteCommunityComment(commentId);
      if (pendingCommentDeletesRef.current.get(commentId) !== operation
        || activePostRef.current !== postId
        || generation !== commentGenerationRef.current
        || screenGeneration !== mountedGenerationRef.current
        || ownerRef.current !== requestOwner) return;
      commentMutationVersionRef.current += 1;
      setComments((current) => current.filter((comment) => comment.id !== commentId));
      if (mutationSequence >= commentAppliedMutationRef.current) {
        commentAppliedMutationRef.current = mutationSequence;
        replacePostCommentCount(postId, result.commentCount);
      }
    } catch (error) {
      if (pendingCommentDeletesRef.current.get(commentId) === operation
        && activePostRef.current === postId
        && generation === commentGenerationRef.current
        && screenGeneration === mountedGenerationRef.current
        && ownerRef.current === requestOwner) {
        setCommentActionError(`Couldn’t delete comment. ${getCommunityErrorMessage(error)}`);
      }
    } finally {
      if (pendingCommentDeletesRef.current.get(commentId) === operation) {
        pendingCommentDeletesRef.current.delete(commentId);
        if (activePostRef.current === postId
          && generation === commentGenerationRef.current
          && screenGeneration === mountedGenerationRef.current
          && ownerRef.current === requestOwner) forcePendingRender((value) => value + 1);
      }
    }
  };

  const canPost = !!caption.trim() && !posting;

  return (
    <View style={styles.root}>
      <TopBar mode="title" title="Community" />
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshFeed} accessibilityLabel="Refresh Community" />}
      >
        <Text style={styles.subtitle}>See what other home cooks are making.</Text>

        <View style={styles.composeCard}>
          <View style={styles.composeHeader}>
            <View style={styles.avatar}><Text style={styles.avatarInitial}>{initialFor(user?.name)}</Text></View>
            <TextInput
              style={styles.composeInput}
              placeholder="Share what you're cooking..."
              placeholderTextColor={colors.inkFaint}
              value={caption}
              onChangeText={setCaption}
              multiline
              maxLength={MAX_CAPTION_LENGTH}
              editable={!posting}
            />
          </View>

          <View style={styles.composeLabelRow}>
            <Text style={styles.composeLabel}>Tag a recipe (optional)</Text>
            <Text style={styles.characterCount}>{caption.length}/{MAX_CAPTION_LENGTH}</Text>
          </View>
          <View style={styles.recipeSearch}>
            <Ionicons name="search" size={14} color={colors.inkFaint} />
            <TextInput
              style={styles.recipeSearchInput}
              value={recipeQuery}
              onChangeText={setRecipeQuery}
              placeholder="Search recipes"
              placeholderTextColor={colors.inkFaint}
              editable={!posting}
            />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.recipePickerRow}>
            {recipeStatus === 'loading' && (
              <View style={styles.recipeMessage}><ActivityIndicator size="small" color={colors.sageDeep} /><Text style={styles.recipeMessageText}>Loading recipes…</Text></View>
            )}
            {recipeStatus === 'error' && (
              <Pressable style={styles.recipeMessage} onPress={() => setRecipeReloadKey((key) => key + 1)}>
                <Ionicons name="refresh" size={15} color={colors.sageDeep} /><Text style={styles.recipeMessageText}>Retry recipes</Text>
              </Pressable>
            )}
            {recipeStatus === 'ready' && recipes.length === 0 && <Text style={styles.recipeMessageText}>No recipes found.</Text>}
            {recipes.map((recipe) => {
              const active = recipe.id === selectedRecipe?.id;
              return (
                <Pressable
                  key={recipe.id}
                  style={[styles.recipeThumbWrap, active && styles.recipeThumbWrapActive]}
                  onPress={() => setSelectedRecipe((current) => (current?.id === recipe.id ? null : recipe))}
                  accessibilityLabel={`Tag ${recipe.title}`}
                >
                  <RecipeImage source={recipe.imageUrl} style={styles.recipeThumb} />
                  {active && <View style={styles.recipeThumbCheck}><Ionicons name="checkmark" size={12} color={colors.onAccent} /></View>}
                </Pressable>
              );
            })}
            {recipePagination && recipePagination.page < recipePagination.totalPages && (
              <Pressable style={styles.recipeMore} onPress={loadMoreRecipes} disabled={loadingMoreRecipes}>
                {loadingMoreRecipes ? <ActivityIndicator size="small" color={colors.sageDeep} /> : <Text style={styles.recipeMoreText}>More</Text>}
              </Pressable>
            )}
          </ScrollView>

          <View style={styles.composeFooter}>
            <Text style={styles.composeTagText} numberOfLines={1}>{selectedRecipe ? `Tagging: ${selectedRecipe.title}` : ' '}</Text>
            <Pressable style={[styles.postBtn, !canPost && styles.postBtnDisabled]} onPress={submitPost} disabled={!canPost}>
              {posting ? <ActivityIndicator size="small" color={colors.onAccent} /> : <Text style={styles.postBtnText}>Post</Text>}
            </Pressable>
          </View>
        </View>

        {feedStatus === 'loading' && <View style={styles.stateCard}><ActivityIndicator color={colors.sageDeep} /><Text style={styles.stateText}>Loading Community…</Text></View>}
        {feedStatus === 'error' && (
          <View style={styles.stateCard}>
            <Ionicons name="cloud-offline-outline" size={24} color={colors.sageDeep} />
            <Text style={styles.stateTitle}>Couldn’t load Community</Text>
            <Text style={styles.stateText}>{feedError}</Text>
            <Pressable style={styles.retryBtn} onPress={() => setFeedReloadKey((key) => key + 1)}><Text style={styles.retryText}>Retry</Text></Pressable>
          </View>
        )}
        {feedStatus === 'ready' && posts.length === 0 && (
          <View style={styles.stateCard}>
            <Ionicons name="people-outline" size={24} color={colors.sageDeep} />
            <Text style={styles.stateTitle}>No posts yet</Text>
            <Text style={styles.stateText}>Share what you’re cooking to start the Community feed.</Text>
          </View>
        )}

        {feedStatus === 'ready' && posts.map((post) => {
          const authorName = post.author?.name || 'Community member';
          const attachment = post.recipeAttachment;
          const likePending = pendingLikesRef.current.has(post.id);
          const deletePending = pendingDeletesRef.current.has(post.id);
          return (
            <View key={post.id} style={styles.card}>
              <View style={styles.postHeader}>
                <View style={styles.avatar}><Text style={styles.avatarInitial}>{initialFor(authorName)}</Text></View>
                <View style={styles.headerText}>
                  <Text style={styles.authorName}>{authorName}</Text>
                  <Text style={styles.time}>{formatCommunityTime(post.createdAt)}</Text>
                </View>
                {post.isOwner && (
                  <Pressable onPress={() => removePost(post.id)} hitSlop={8} disabled={deletePending} accessibilityLabel="Delete post">
                    {deletePending ? <ActivityIndicator size="small" color={colors.inkFaint} /> : <Ionicons name="trash-outline" size={17} color={colors.inkFaint} />}
                  </Pressable>
                )}
              </View>

              {attachment?.isAvailable && attachment.recipe && <RecipeImage source={attachment.recipe.imageUrl} style={styles.postImage} />}
              {attachment && !attachment.isAvailable && (
                <View style={styles.unavailableRecipe}><Ionicons name="restaurant-outline" size={18} color={colors.inkFaint} /><Text style={styles.unavailableRecipeText}>Recipe unavailable</Text></View>
              )}
              <View style={styles.postBody}>
                {attachment?.isAvailable && attachment.recipe && (
                  <View style={styles.tagRow}><Ionicons name="restaurant-outline" size={12} color={colors.sageDeep} /><Text style={styles.tagText} numberOfLines={1}>{attachment.recipe.title}</Text></View>
                )}
                <Text style={styles.caption}>{post.caption}</Text>
                <View style={styles.actionRow}>
                  <Pressable
                    style={styles.actionBtn}
                    hitSlop={8}
                    onPress={() => toggleLike(post)}
                    disabled={likePending}
                    accessibilityLabel={post.likedByCurrentUser ? 'Unlike post' : 'Like post'}
                  >
                    <Ionicons name={post.likedByCurrentUser ? 'heart' : 'heart-outline'} size={18} color={post.likedByCurrentUser ? colors.error : colors.inkSoft} />
                    <Text style={styles.actionText}>{post.likeCount}</Text>
                  </Pressable>
                  <Pressable
                    style={styles.actionBtn}
                    onPress={() => toggleComments(post.id)}
                    accessibilityLabel={`${post.commentCount} comments`}
                    accessibilityState={{ expanded: activePostId === post.id }}
                  >
                    <Ionicons name="chatbubble-outline" size={17} color={colors.inkSoft} /><Text style={styles.actionText}>{post.commentCount}</Text>
                  </Pressable>
                </View>
                {activePostId === post.id && (
                  <View style={styles.commentPanel} accessibilityLabel="Comments panel">
                    {commentStatus === 'loading' && (
                      <View style={styles.commentState}>
                        <ActivityIndicator size="small" color={colors.sageDeep} />
                        <Text style={styles.commentHint}>Loading comments…</Text>
                      </View>
                    )}
                    {commentStatus === 'error' && (
                      <View style={styles.commentState}>
                        <Text style={styles.commentHint}>{commentError}</Text>
                        <Pressable
                          style={styles.retryBtn}
                          onPress={() => loadCommentPage(post.id, 1, true)}
                          accessibilityLabel="Retry comments"
                        >
                          <Text style={styles.retryText}>Retry</Text>
                        </Pressable>
                      </View>
                    )}
                    {commentStatus === 'ready' && comments.length === 0 && (
                      <Text style={styles.commentHint}>No comments yet. Start the conversation.</Text>
                    )}
                    {commentStatus === 'ready' && comments.map((comment) => {
                      const commentAuthor = comment.author?.name || 'Community member';
                      const commentDeletePending = pendingCommentDeletesRef.current.has(comment.id);
                      return (
                        <View key={comment.id} style={styles.commentRow}>
                          <View style={styles.commentAvatar}>
                            <Text style={styles.commentAvatarText}>{initialFor(commentAuthor)}</Text>
                          </View>
                          <View style={styles.commentContent}>
                            <View style={styles.commentHeader}>
                              <Text style={styles.commentAuthor}>{commentAuthor}</Text>
                              <Text style={styles.commentTime}>{formatCommunityTime(comment.createdAt)}</Text>
                              {comment.isOwner && (
                                <Pressable
                                  onPress={() => removeComment(post.id, comment.id)}
                                  disabled={commentDeletePending}
                                  accessibilityLabel={`Delete comment by ${commentAuthor}`}
                                >
                                  {commentDeletePending
                                    ? <ActivityIndicator size="small" color={colors.inkFaint} />
                                    : <Ionicons name="trash-outline" size={15} color={colors.inkFaint} />}
                                </Pressable>
                              )}
                            </View>
                            <Text style={styles.commentBody}>{comment.body}</Text>
                          </View>
                        </View>
                      );
                    })}
                    {commentStatus === 'ready' && commentPagination
                      && commentPagination.page < commentPagination.totalPages && (
                      <Pressable
                        style={styles.commentMore}
                        onPress={() => loadCommentPage(post.id, commentPagination.page + 1, false)}
                        disabled={loadingMoreComments}
                        accessibilityLabel="Load more comments"
                      >
                        {loadingMoreComments
                          ? <ActivityIndicator size="small" color={colors.sageDeep} />
                          : <Text style={styles.retryText}>Load more comments</Text>}
                      </Pressable>
                    )}
                    {!!commentActionError && <Text style={styles.commentError}>{commentActionError}</Text>}
                    <View style={styles.commentComposer}>
                      <TextInput
                        style={styles.commentInput}
                        value={commentDraft}
                        onChangeText={setCommentDraft}
                        placeholder="Add a comment…"
                        placeholderTextColor={colors.inkFaint}
                        multiline
                        maxLength={MAX_COMMENT_LENGTH}
                        editable={!commentSubmitting}
                        accessibilityLabel="Comment"
                      />
                      <View style={styles.commentComposerFooter}>
                        <Text style={styles.commentCount}>{commentDraft.length}/{MAX_COMMENT_LENGTH}</Text>
                        <Pressable
                          style={[styles.commentSubmit, (!commentDraft.trim() || commentSubmitting) && styles.postBtnDisabled]}
                          onPress={() => submitComment(post.id)}
                          disabled={!commentDraft.trim() || commentSubmitting}
                          accessibilityLabel="Post comment"
                          accessibilityState={{ disabled: !commentDraft.trim() || commentSubmitting, busy: commentSubmitting }}
                        >
                          {commentSubmitting
                            ? <ActivityIndicator size="small" color={colors.onAccent} />
                            : <Text style={styles.commentSubmitText}>Comment</Text>}
                        </Pressable>
                      </View>
                    </View>
                  </View>
                )}
              </View>
            </View>
          );
        })}

        {feedStatus === 'ready' && pagination && pagination.page < pagination.totalPages && (
          <Pressable style={styles.loadMoreBtn} onPress={loadMorePosts} disabled={loadingMore}>
            {loadingMore ? <ActivityIndicator size="small" color={colors.sageDeep} /> : <Text style={styles.loadMoreText}>Load more posts</Text>}
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

function makeStyles(colors, shadow) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
    subtitle: { fontFamily: typography.body.fontFamily, fontSize: typography.sizes.sm, color: colors.inkSoft, marginBottom: spacing.lg, lineHeight: 19 },
    composeCard: { backgroundColor: colors.paper, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.hairline, padding: spacing.md, marginBottom: spacing.xl, ...shadow.soft },
    composeHeader: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
    avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.sagePale, alignItems: 'center', justifyContent: 'center' },
    avatarInitial: { fontFamily: typography.body.semibold, fontSize: typography.sizes.sm, color: colors.sageDeep },
    composeInput: { flex: 1, minHeight: 40, fontFamily: typography.body.fontFamily, fontSize: typography.sizes.sm, color: colors.ink, paddingTop: 8, outlineStyle: 'none' },
    composeLabelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    composeLabel: { fontFamily: typography.body.medium, fontSize: typography.sizes.xs, color: colors.inkFaint, marginBottom: spacing.sm },
    characterCount: { fontFamily: typography.body.fontFamily, fontSize: 10, color: colors.inkFaint, marginBottom: spacing.sm },
    recipeSearch: { height: 36, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderColor: colors.hairline, borderRadius: radius.md, paddingHorizontal: spacing.sm, marginBottom: spacing.sm },
    recipeSearchInput: { flex: 1, fontFamily: typography.body.fontFamily, fontSize: typography.sizes.xs, color: colors.ink, outlineStyle: 'none' },
    recipePickerRow: { gap: spacing.sm, minHeight: 52, alignItems: 'center', paddingBottom: spacing.sm },
    recipeThumbWrap: { width: 52, height: 52, borderRadius: radius.md, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent' },
    recipeThumbWrapActive: { borderColor: colors.sageDeep },
    recipeThumb: { width: '100%', height: '100%' },
    recipeThumbCheck: { position: 'absolute', top: 2, right: 2, width: 16, height: 16, borderRadius: 8, backgroundColor: colors.sageDeep, alignItems: 'center', justifyContent: 'center' },
    recipeMessage: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    recipeMessageText: { fontFamily: typography.body.fontFamily, fontSize: typography.sizes.xs, color: colors.inkFaint },
    recipeMore: { width: 52, height: 52, borderRadius: radius.md, borderWidth: 1, borderColor: colors.hairline, alignItems: 'center', justifyContent: 'center' },
    recipeMoreText: { fontFamily: typography.body.semibold, fontSize: 11, color: colors.sageDeep },
    composeFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginTop: spacing.xs },
    composeTagText: { flex: 1, fontFamily: typography.body.medium, fontSize: typography.sizes.xs, color: colors.sageDeep },
    postBtn: { minWidth: 70, minHeight: 34, backgroundColor: colors.sageDeep, borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: 8, alignItems: 'center', justifyContent: 'center' },
    postBtnDisabled: { backgroundColor: colors.hairline },
    postBtnText: { fontFamily: typography.body.semibold, fontSize: typography.sizes.sm, color: colors.onAccent },
    card: { backgroundColor: colors.paper, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.hairline, overflow: 'hidden', marginBottom: spacing.lg, ...shadow.soft },
    postHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md },
    headerText: { flex: 1 },
    authorName: { fontFamily: typography.body.semibold, fontSize: typography.sizes.sm, color: colors.ink },
    time: { fontFamily: typography.body.fontFamily, fontSize: typography.sizes.xs, color: colors.inkFaint, marginTop: 1 },
    postImage: { width: '100%', height: 200 },
    unavailableRecipe: { height: 90, alignItems: 'center', justifyContent: 'center', gap: spacing.xs, backgroundColor: colors.creamDeep },
    unavailableRecipeText: { fontFamily: typography.body.medium, fontSize: typography.sizes.xs, color: colors.inkFaint },
    postBody: { padding: spacing.md },
    tagRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: spacing.xs },
    tagText: { fontFamily: typography.body.medium, fontSize: typography.sizes.xs, color: colors.sageDeep, flexShrink: 1 },
    caption: { fontFamily: typography.body.fontFamily, fontSize: typography.sizes.sm, color: colors.ink, lineHeight: 19, marginBottom: spacing.sm },
    actionRow: { flexDirection: 'row', gap: spacing.lg },
    actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    actionText: { fontFamily: typography.body.medium, fontSize: typography.sizes.xs, color: colors.inkSoft },
    commentPanel: { marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.hairline, gap: spacing.sm },
    commentState: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.sm },
    commentHint: { fontFamily: typography.body.fontFamily, fontSize: typography.sizes.xs, color: colors.inkFaint, textAlign: 'center' },
    commentRow: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.xs },
    commentAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.sagePale, alignItems: 'center', justifyContent: 'center' },
    commentAvatarText: { fontFamily: typography.body.semibold, fontSize: typography.sizes.xs, color: colors.sageDeep },
    commentContent: { flex: 1 },
    commentHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    commentAuthor: { flex: 1, fontFamily: typography.body.semibold, fontSize: typography.sizes.xs, color: colors.ink },
    commentTime: { fontFamily: typography.body.fontFamily, fontSize: 10, color: colors.inkFaint },
    commentBody: { fontFamily: typography.body.fontFamily, fontSize: typography.sizes.sm, color: colors.ink, lineHeight: 19, marginTop: 2 },
    commentMore: { alignItems: 'center', paddingVertical: spacing.xs },
    commentError: { fontFamily: typography.body.fontFamily, fontSize: typography.sizes.xs, color: colors.error },
    commentComposer: { borderWidth: 1, borderColor: colors.hairline, borderRadius: radius.md, padding: spacing.sm },
    commentInput: { minHeight: 42, fontFamily: typography.body.fontFamily, fontSize: typography.sizes.sm, color: colors.ink, outlineStyle: 'none', paddingTop: 4 },
    commentComposerFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
    commentCount: { fontFamily: typography.body.fontFamily, fontSize: 10, color: colors.inkFaint },
    commentSubmit: { minHeight: 32, borderRadius: radius.pill, backgroundColor: colors.sageDeep, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center' },
    commentSubmitText: { fontFamily: typography.body.semibold, fontSize: typography.sizes.xs, color: colors.onAccent },
    stateCard: { backgroundColor: colors.paper, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.hairline, padding: spacing.xxl, alignItems: 'center', gap: spacing.sm, ...shadow.soft },
    stateTitle: { fontFamily: typography.display.fontFamily, fontSize: typography.sizes.md, color: colors.ink },
    stateText: { fontFamily: typography.body.fontFamily, fontSize: typography.sizes.sm, lineHeight: 19, color: colors.inkSoft, textAlign: 'center' },
    retryBtn: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
    retryText: { fontFamily: typography.body.semibold, fontSize: typography.sizes.sm, color: colors.sageDeep },
    loadMoreBtn: { alignItems: 'center', paddingVertical: spacing.md },
    loadMoreText: { fontFamily: typography.body.semibold, fontSize: typography.sizes.sm, color: colors.sageDeep },
  });
}
