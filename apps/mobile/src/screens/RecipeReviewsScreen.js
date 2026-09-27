import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import TopBar from '../components/TopBar';
import { useTheme } from '../theme/ThemeContext';
import { radius, spacing, typography } from '../theme/theme';
import {
  createRecipeReview,
  deleteReview,
  getRecipeReviews,
  updateReview,
} from '../api/reviewService';
import { getReviewErrorMessage } from '../api/reviewErrors';
import { getRecipeStatus } from '../api/cookHistoryService';

const PAGE_LIMIT = 20;
const COMMENT_MAX_LENGTH = 1000;

function appendUniqueReviews(previous, incoming) {
  const ids = new Set(previous.map((review) => review.id));
  const appended = [];
  for (const review of incoming) {
    if (ids.has(review.id)) continue;
    ids.add(review.id);
    appended.push(review);
  }
  return previous.concat(appended);
}

function reviewDate(review) {
  const timestamp = review.updatedAt !== review.createdAt ? review.updatedAt : review.createdAt;
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export default function RecipeReviewsScreen({ navigation, route }) {
  const recipeId = route.params?.recipeId;
  const recipeTitle = route.params?.recipeTitle || 'Recipe';
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [phase, setPhase] = useState('loading');
  const [reviews, setReviews] = useState([]);
  const [summary, setSummary] = useState(null);
  const [currentUserReview, setCurrentUserReview] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(null);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [draftRating, setDraftRating] = useState(0);
  const [draftComment, setDraftComment] = useState('');
  const [cookState, setCookState] = useState({ status: 'loading', hasCooked: false });

  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const firstPageGenerationRef = useRef(null);
  const loadingMoreRef = useRef(false);
  const mutationBusyRef = useRef(false);
  const reviewsRef = useRef([]);
  const paginationRef = useRef(null);
  const cookGenerationRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      cookGenerationRef.current += 1;
    };
  }, []);

  const loadFirstPage = useCallback(async ({ refresh = false } = {}) => {
    const generation = ++generationRef.current;
    firstPageGenerationRef.current = generation;
    loadingMoreRef.current = false;
    setLoadingMore(false);
    setLoadMoreError(null);
    if (refresh) {
      setRefreshing(true);
    } else {
      reviewsRef.current = [];
      setReviews([]);
      setSummary(null);
      paginationRef.current = null;
      setCurrentUserReview(null);
      setPhase('loading');
    }

    try {
      const result = await getRecipeReviews(recipeId, {
        page: 1,
        limit: PAGE_LIMIT,
        sort: 'newest',
      });
      if (!mountedRef.current || generation !== generationRef.current) return false;

      reviewsRef.current = result.reviews;
      setReviews(result.reviews);
      setSummary(result.summary);
      paginationRef.current = result.pagination;
      setCurrentUserReview(result.currentUserReview);
      setDraftRating(result.currentUserReview?.rating || 0);
      setDraftComment(result.currentUserReview?.comment || '');
      setError(null);
      setPhase('ready');
      return true;
    } catch (requestError) {
      if (!mountedRef.current || generation !== generationRef.current) return false;
      setError(getReviewErrorMessage(requestError));
      setPhase(refresh && reviewsRef.current.length > 0 ? 'ready' : 'error');
      return false;
    } finally {
      if (firstPageGenerationRef.current === generation) firstPageGenerationRef.current = null;
      if (mountedRef.current && generation === generationRef.current) setRefreshing(false);
    }
  }, [recipeId]);

  useEffect(() => {
    loadFirstPage();
  }, [loadFirstPage]);

  const loadCookStatus = useCallback(async () => {
    const generation = ++cookGenerationRef.current;
    setCookState({ status: 'loading', hasCooked: false });
    try {
      const { hasCooked } = await getRecipeStatus(recipeId);
      if (!mountedRef.current || generation !== cookGenerationRef.current) return false;
      setCookState({ status: 'ready', hasCooked });
      return true;
    } catch {
      if (!mountedRef.current || generation !== cookGenerationRef.current) return false;
      setCookState({ status: 'error', hasCooked: false });
      return false;
    }
  }, [recipeId]);

  useFocusEffect(
    useCallback(() => {
      loadCookStatus();
      return () => {
        cookGenerationRef.current += 1;
      };
    }, [loadCookStatus])
  );

  const loadMore = useCallback(async () => {
    if (firstPageGenerationRef.current === generationRef.current) return;
    const currentPagination = paginationRef.current;
    if (loadingMoreRef.current || phase !== 'ready' || !currentPagination) return;
    if (currentPagination.page >= currentPagination.totalPages) return;

    const generation = generationRef.current;
    const nextPage = currentPagination.page + 1;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const result = await getRecipeReviews(recipeId, {
        page: nextPage,
        limit: PAGE_LIMIT,
        sort: 'newest',
      });
      if (!mountedRef.current || generation !== generationRef.current) return;
      const merged = appendUniqueReviews(reviewsRef.current, result.reviews);
      reviewsRef.current = merged;
      setReviews(merged);
      paginationRef.current = result.pagination;
    } catch (requestError) {
      if (!mountedRef.current || generation !== generationRef.current) return;
      setLoadMoreError(getReviewErrorMessage(requestError));
    } finally {
      if (mountedRef.current && generation === generationRef.current) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [phase, recipeId]);

  const runMutation = useCallback(async (operation) => {
    if (mutationBusyRef.current || phase !== 'ready') return;
    mutationBusyRef.current = true;
    setMutationBusy(true);
    try {
      await operation();
      await loadFirstPage();
    } catch (mutationError) {
      if (mutationError?.code === 'REVIEW_ALREADY_EXISTS') {
        const refreshed = await loadFirstPage();
        if (mountedRef.current && refreshed) {
          Alert.alert('Review refreshed', 'Your existing review was reloaded. Check it before saving again.');
        }
      } else if (mutationError?.code === 'REVIEW_COOK_REQUIRED') {
        await Promise.all([loadFirstPage(), loadCookStatus()]);
        if (mountedRef.current) {
          Alert.alert('Complete this recipe first', getReviewErrorMessage(mutationError));
        }
      } else if (mountedRef.current) {
        Alert.alert('Couldn’t save your review', getReviewErrorMessage(mutationError));
      }
    } finally {
      mutationBusyRef.current = false;
      if (mountedRef.current) setMutationBusy(false);
    }
  }, [loadCookStatus, loadFirstPage, phase]);

  const canCreateFirstReview = phase === 'ready'
    && !currentUserReview
    && cookState.status === 'ready'
    && cookState.hasCooked;
  const editorDisabled = mutationBusy || (!currentUserReview && !canCreateFirstReview);
  const firstReviewEligibilityText = cookState.status === 'ready'
    ? 'Complete this recipe in WeCooked before rating or reviewing it.'
    : cookState.status === 'loading'
      ? 'Checking your WeCooked cooking status…'
      : 'We couldn’t confirm your WeCooked cooking status. Return to the recipe and try again.';

  const submitReview = () => {
    if (draftRating < 1 || draftRating > 5 || mutationBusyRef.current || phase !== 'ready') return;
    const comment = draftComment.trim();
    if (currentUserReview) {
      runMutation(() => updateReview(currentUserReview.id, { rating: draftRating, comment }));
      return;
    }
    if (!canCreateFirstReview) return;
    runMutation(() => createRecipeReview(recipeId, {
      rating: draftRating,
      ...(comment ? { comment } : {}),
    }));
  };

  const confirmDelete = () => {
    if (!currentUserReview || mutationBusyRef.current) return;
    const reviewId = currentUserReview.id;
    Alert.alert(
      'Delete your review?',
      'This permanently removes both your written comment and your star rating.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete review and rating',
          style: 'destructive',
          onPress: () => runMutation(() => deleteReview(reviewId)),
        },
      ]
    );
  };

  const renderReview = ({ item }) => {
    const authorName = item.author?.name || 'Unknown user';
    const edited = item.updatedAt !== item.createdAt;
    return (
      <View
        style={styles.reviewCard}
        accessible
        accessibilityLabel={`${authorName}, ${item.rating} out of 5 stars${item.comment ? ', written review' : ', rating only'}`}
      >
        <View style={styles.reviewHeading}>
          <Text style={styles.author} numberOfLines={2}>{authorName}</Text>
          <View style={styles.rowStars} accessibilityLabel={`${item.rating} out of 5 stars`}>
            {[1, 2, 3, 4, 5].map((star) => (
              <Ionicons
                key={star}
                name={star <= item.rating ? 'star' : 'star-outline'}
                size={14}
                color={star <= item.rating ? colors.stone : colors.inkFaint}
              />
            ))}
          </View>
        </View>
        {item.comment ? <Text style={styles.comment}>{item.comment}</Text> : null}
        <Text style={styles.timestamp}>{edited ? 'Edited ' : ''}{reviewDate(item)}</Text>
      </View>
    );
  };

  const renderHeader = () => (
    <View>
      <View style={styles.summaryCard}>
        <Text style={styles.recipeTitle} numberOfLines={2}>{recipeTitle}</Text>
        {summary ? (
          <Text style={styles.summaryText}>
            {summary.ratingCount > 0
              ? `${summary.averageRating} out of 5 · ${summary.ratingCount} rating${summary.ratingCount === 1 ? '' : 's'}`
              : 'No ratings yet'}
          </Text>
        ) : null}
      </View>

      {phase === 'ready' ? (
        <View style={styles.editorCard}>
          <Text style={styles.sectionTitle}>{currentUserReview ? 'Edit your review' : 'Write a review'}</Text>
          <Text style={styles.editorHint}>Choose a rating. A written comment is optional.</Text>
          {!currentUserReview && !canCreateFirstReview ? (
            <View style={styles.eligibilityBox}>
              <Text style={styles.eligibilityText}>
                {firstReviewEligibilityText}
              </Text>
              <Pressable
                onPress={() => navigation.goBack()}
                accessibilityRole="button"
                accessibilityLabel="Return to recipe to start cooking"
              >
                <Text style={styles.eligibilityLink}>Go to recipe</Text>
              </Pressable>
            </View>
          ) : null}
          <View style={styles.editorStars} accessibilityRole="radiogroup" accessibilityLabel="Review rating">
            {[1, 2, 3, 4, 5].map((star) => (
              <Pressable
                key={star}
                style={styles.starButton}
                onPress={() => setDraftRating(star)}
                disabled={editorDisabled}
                accessibilityRole="radio"
                accessibilityLabel={`${star} star${star === 1 ? '' : 's'}`}
                accessibilityState={{ checked: draftRating === star, disabled: editorDisabled }}
              >
                <Ionicons
                  name={star <= draftRating ? 'star' : 'star-outline'}
                  size={30}
                  color={star <= draftRating ? colors.stone : colors.inkFaint}
                />
              </Pressable>
            ))}
          </View>
          <TextInput
            style={styles.input}
            value={draftComment}
            onChangeText={setDraftComment}
            placeholder="Share what you thought (optional)"
            placeholderTextColor={colors.inkFaint}
            multiline
            maxLength={COMMENT_MAX_LENGTH}
            editable={!editorDisabled}
            accessibilityLabel="Written review comment, optional"
          />
          <Text style={styles.characterCount}>{draftComment.length}/{COMMENT_MAX_LENGTH}</Text>
          <View style={styles.editorActions}>
            {currentUserReview ? (
              <Pressable
                style={styles.deleteButton}
                onPress={confirmDelete}
                disabled={mutationBusy}
                accessibilityRole="button"
                accessibilityLabel="Delete review, comment, and star rating"
                accessibilityState={{ disabled: mutationBusy, busy: mutationBusy }}
              >
                <Text style={styles.deleteText}>Delete</Text>
              </Pressable>
            ) : null}
            <Pressable
              style={[styles.submitButton, (draftRating === 0 || editorDisabled) && styles.disabledButton]}
              onPress={submitReview}
              disabled={draftRating === 0 || editorDisabled}
              accessibilityRole="button"
              accessibilityLabel={currentUserReview ? 'Update your review' : 'Submit your review'}
              accessibilityState={{ disabled: draftRating === 0 || editorDisabled, busy: mutationBusy }}
            >
              {mutationBusy ? <ActivityIndicator size="small" color={colors.onAccent} /> : null}
              <Text style={styles.submitText}>{currentUserReview ? 'Update review' : 'Submit review'}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {error && phase === 'ready' ? <Text style={styles.inlineError}>{error}</Text> : null}
      {phase === 'ready' && reviews.length > 0 ? <Text style={styles.listTitle}>Newest reviews</Text> : null}
    </View>
  );

  const renderEmpty = () => {
    if (phase === 'loading') {
      return (
        <View style={styles.stateBox} accessibilityState={{ busy: true }}>
          <ActivityIndicator color={colors.sageDeep} accessibilityLabel="Loading reviews" />
          <Text style={styles.stateText}>Loading reviews…</Text>
        </View>
      );
    }
    if (phase === 'error') {
      return (
        <View style={styles.stateBox}>
          <Ionicons name="alert-circle-outline" size={28} color={colors.error} />
          <Text style={styles.stateTitle}>We couldn’t load reviews</Text>
          <Text style={styles.stateText}>{error}</Text>
          <Pressable
            style={styles.retryButton}
            onPress={() => loadFirstPage()}
            accessibilityRole="button"
            accessibilityLabel="Retry loading reviews"
          >
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <View style={styles.stateBox}>
        <Ionicons name="chatbubble-ellipses-outline" size={28} color={colors.sageDeep} />
        <Text style={styles.stateTitle}>No reviews yet</Text>
        <Text style={styles.stateText}>Be the first to leave a rating or written review.</Text>
      </View>
    );
  };

  const renderFooter = () => {
    if (loadingMore) return <ActivityIndicator style={styles.footer} color={colors.sageDeep} accessibilityLabel="Loading more reviews" />;
    if (loadMoreError) {
      return (
        <Pressable style={styles.footer} onPress={loadMore} accessibilityRole="button" accessibilityLabel="Retry loading more reviews">
          <Text style={styles.inlineError}>{loadMoreError} Tap to retry.</Text>
        </Pressable>
      );
    }
    return <View style={styles.footerSpace} />;
  };

  return (
    <View style={styles.root} accessibilityState={{ busy: refreshing || mutationBusy }}>
      <TopBar mode="back" title="Reviews" onBack={() => navigation.goBack()} />
      <FlatList
        data={reviews}
        keyExtractor={(item) => item.id}
        renderItem={renderReview}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={renderEmpty}
        ListFooterComponent={renderFooter}
        contentContainerStyle={styles.content}
        onEndReached={loadMore}
        onEndReachedThreshold={0.35}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadFirstPage({ refresh: true })}
            tintColor={colors.sageDeep}
            colors={[colors.sageDeep]}
            accessibilityLabel="Refresh reviews"
          />
        )}
      />
    </View>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    content: { padding: spacing.lg, paddingBottom: spacing.xxxl, flexGrow: 1 },
    summaryCard: { marginBottom: spacing.md },
    recipeTitle: { fontFamily: typography.display.fontFamily, fontSize: typography.sizes.xl, color: colors.ink },
    summaryText: { marginTop: spacing.xs, fontFamily: typography.body.medium, fontSize: typography.sizes.sm, color: colors.inkSoft },
    editorCard: { backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.hairline, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.lg },
    sectionTitle: { fontFamily: typography.body.bold, fontSize: typography.sizes.md, color: colors.ink },
    editorHint: { fontFamily: typography.body.fontFamily, fontSize: typography.sizes.sm, color: colors.inkSoft, marginTop: spacing.xs },
    eligibilityBox: { marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.sagePale, gap: spacing.sm },
    eligibilityText: { fontFamily: typography.body.fontFamily, fontSize: typography.sizes.sm, color: colors.inkSoft },
    eligibilityLink: { fontFamily: typography.body.semibold, fontSize: typography.sizes.sm, color: colors.sageDeep },
    editorStars: { flexDirection: 'row', marginTop: spacing.md, marginBottom: spacing.md },
    starButton: { paddingVertical: spacing.xs, paddingRight: spacing.sm },
    input: { minHeight: 112, borderWidth: 1, borderColor: colors.hairline, borderRadius: radius.md, backgroundColor: colors.cream, color: colors.ink, fontFamily: typography.body.fontFamily, fontSize: typography.sizes.base, padding: spacing.md, textAlignVertical: 'top' },
    characterCount: { alignSelf: 'flex-end', marginTop: spacing.xs, fontFamily: typography.body.fontFamily, fontSize: typography.sizes.xs, color: colors.inkFaint },
    editorActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
    deleteButton: { paddingHorizontal: spacing.md, paddingVertical: spacing.md },
    deleteText: { fontFamily: typography.body.semibold, color: colors.error },
    submitButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.sageDeep, paddingHorizontal: spacing.lg },
    disabledButton: { opacity: 0.55 },
    submitText: { fontFamily: typography.body.semibold, fontSize: typography.sizes.sm, color: colors.onAccent },
    listTitle: { fontFamily: typography.body.bold, fontSize: typography.sizes.md, color: colors.ink, marginBottom: spacing.sm },
    reviewCard: { backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.hairline, borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.md },
    reviewHeading: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
    author: { flex: 1, fontFamily: typography.body.semibold, fontSize: typography.sizes.base, color: colors.ink },
    rowStars: { flexDirection: 'row', flexShrink: 0 },
    comment: { marginTop: spacing.md, fontFamily: typography.body.fontFamily, fontSize: typography.sizes.base, lineHeight: 21, color: colors.inkSoft },
    timestamp: { marginTop: spacing.md, fontFamily: typography.body.fontFamily, fontSize: typography.sizes.xs, color: colors.inkFaint },
    stateBox: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xxxl, paddingHorizontal: spacing.lg, gap: spacing.sm },
    stateTitle: { fontFamily: typography.body.bold, fontSize: typography.sizes.md, color: colors.ink, textAlign: 'center' },
    stateText: { fontFamily: typography.body.fontFamily, fontSize: typography.sizes.sm, color: colors.inkSoft, textAlign: 'center' },
    retryButton: { marginTop: spacing.sm, minHeight: 44, justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: colors.sageDeep, paddingHorizontal: spacing.lg },
    retryText: { fontFamily: typography.body.semibold, color: colors.sageDeep },
    inlineError: { fontFamily: typography.body.fontFamily, fontSize: typography.sizes.sm, color: colors.error, textAlign: 'center', marginBottom: spacing.md },
    footer: { paddingVertical: spacing.lg },
    footerSpace: { height: spacing.lg },
  });
}
