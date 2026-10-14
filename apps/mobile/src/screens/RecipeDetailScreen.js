import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Share,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import Badge from '../components/Badge';
import Button from '../components/Button';
import RecipeImage from '../components/RecipeImage';
import FavoriteHeart from '../components/FavoriteHeart';
import CollectionPickerSheet from '../components/CollectionPickerSheet';
import MealPlanSheet from '../components/MealPlanSheet';
import { useShoppingList } from '../context/ShoppingListContext';
import { useAuth } from '../context/AuthContext';
import { getRecipe } from '../api/recipeService';
import { getRecipeErrorMessage } from '../api/recipeErrors';
import { getRecipeReviews, createRecipeReview, updateReview } from '../api/reviewService';
import { getReviewErrorMessage } from '../api/reviewErrors';
import { getRecipeStatus } from '../api/cookHistoryService';
import { difficultyLabel, unitLabel } from '../api/recipeOptions';
import useRecipeScreenRefresh from '../hooks/useRecipeScreenRefresh';
import { classifyRecipeDetailFailure } from '../utils/recipeFreshnessState';
import { authoredSpiceLevels, selectedCookingIngredients } from '../utils/cookingSelection';
import {
  formatMinutes,
  formatQuantity,
  hasRecipeDetailData,
  ingredientDisplayText,
  recipeBadges,
  scaleQuantity,
  totalTimeMinutes,
} from '../utils/recipe';

const MIN_SERVINGS = 1;
const MAX_SERVINGS = 100;
const RECIPE_ID = /^[a-f\d]{24}$/i;
const NUTRITION_ROWS = Object.freeze([
  ['caloriesKcal', 'Calories', 'kcal'],
  ['proteinGrams', 'Protein', 'g'],
  ['carbohydrateGrams', 'Carbohydrate', 'g'],
  ['fatGrams', 'Fat', 'g'],
  ['sugarGrams', 'Sugar', 'g'],
  ['fiberGrams', 'Fiber', 'g'],
]);

// -------------------------------------------------------------------------
// Recipe Detail accepts only the real API route contract. Every current caller
// supplies recipeSource + recipeId; unsupported legacy/mock objects are never
// rendered as product data.
// -------------------------------------------------------------------------
export default function RecipeDetailScreen({ navigation, route }) {
  const { status, user, sessionIdentity } = useAuth();
  const params = route.params || {};
  const sessionValid = status === 'authenticated' && user?.id
    && sessionIdentity?.ownerId === user.id;
  const sessionKey = sessionValid
    ? `${user.id}:${sessionIdentity.generation}:${sessionIdentity.localSessionRevision}` : null;
  const initialSessionKeyRef = useRef(sessionKey);

  if (sessionKey && params.recipeSource === 'api' && typeof params.recipeId === 'string'
    && RECIPE_ID.test(params.recipeId)) {
    // `key` forces a full remount if the route's recipeId ever changes in place
    // (e.g. a future "related recipe" tap or a deep link while already on a
    // detail screen), so no fetched/notFound/servings state from the previous
    // recipe can leak into the next one.
    return (
      <ApiRecipeDetailContainer
        key={`${sessionKey}:${params.recipeId}`}
        navigation={navigation}
        recipeId={params.recipeId}
        initialRecipe={initialSessionKeyRef.current === sessionKey && params.initialRecipe?.id === params.recipeId
          ? params.initialRecipe : null}
      />
    );
  }

  return <InvalidRecipeDetail navigation={navigation} message={sessionKey ? undefined : 'Please log in to view recipes.'} />;
}

function InvalidRecipeDetail({ navigation, message = "This recipe isn't available." }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const insets = useSafeAreaInsets();

  return (
    <RecipeDetailNotice
      navigation={navigation}
      styles={styles}
      colors={colors}
      insets={insets}
      icon="alert-circle-outline"
      message={message}
    />
  );
}

// ---------------------------- API mode ----------------------------------

function ApiRecipeDetailContainer({ navigation, recipeId, initialRecipe }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const insets = useSafeAreaInsets();

  const [fetched, setFetched] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [requiresRefresh, setRequiresRefresh] = useState(false);
  const [nonce, setNonce] = useState(0);
  const genRef = useRef(0);

  useRecipeScreenRefresh(() => {
    // Invalidate synchronously so the old request cannot commit while React is
    // scheduling the nonce-driven replacement request.
    genRef.current += 1;
    setNonce((value) => value + 1);
  });

  // Fetch the authoritative recipe. Guarded against unmount, a stale response,
  // and a recipe-id change (each firing bumps the generation).
  useEffect(() => {
    let cancelled = false;
    const gen = ++genRef.current;
    (async () => {
      try {
        const fresh = await getRecipe(recipeId);
        if (cancelled || gen !== genRef.current) return;
        if (fresh?.id !== recipeId || !hasRecipeDetailData(fresh)) {
          setFetchError('Could not load recipe. Please try again.');
          return;
        }
        setFetched(fresh);
        setNotFound(false);
        setFetchError(null);
        setRequiresRefresh(false);
      } catch (err) {
        if (cancelled || gen !== genRef.current) return;
        const failure = classifyRecipeDetailFailure(err, Boolean(fetched || hasRecipeDetailData(initialRecipe)));
        if (failure === 'unavailable') {
          setNotFound(true);
        } else {
          setFetchError(getRecipeErrorMessage(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [recipeId, nonce]);

  const retry = () => {
    genRef.current += 1;
    setNonce((n) => n + 1);
  };
  const recipeStale = () => {
    genRef.current += 1;
    setRequiresRefresh(true);
    setNonce((n) => n + 1);
  };
  const recipeUnavailable = () => {
    genRef.current += 1;
    setNotFound(true);
  };
  // Favorites provide only a recipe summary. Render an initial list payload
  // immediately only when it is a complete PublicRecipe; otherwise wait for
  // the authoritative detail GET so servings/ingredients/steps cannot seed
  // this component from incomplete data.
  const recipe = fetched || (hasRecipeDetailData(initialRecipe) ? initialRecipe : null);

  if (notFound) {
    return (
      <RecipeDetailNotice
        navigation={navigation}
        styles={styles}
        colors={colors}
        insets={insets}
        icon="sad-outline"
        message="This recipe isn't available anymore."
      />
    );
  }

  if (!recipe) {
    // Cold entry (no list object to paint) — still loading, or the fetch
    // failed with nothing to fall back to.
    if (fetchError) {
      return (
        <RecipeDetailNotice
          navigation={navigation}
          styles={styles}
          colors={colors}
          insets={insets}
          icon="cloud-offline-outline"
          message={fetchError}
          onRetry={retry}
        />
      );
    }
    return (
      <View style={[styles.root, styles.centerScreen]}>
        <ActivityIndicator color={colors.sageDeep} />
      </View>
    );
  }

  return (
    <ApiRecipeDetail
      key={`${recipe.id}:${recipe.updatedAt || ''}`}
      navigation={navigation}
      recipe={recipe}
      canPassRecipeContext={Boolean(fetched)}
      canImportSelection={Boolean(fetched) && !requiresRefresh}
      recipeBlocked={requiresRefresh}
      onRecipeStale={recipeStale}
      onRecipeUnavailable={recipeUnavailable}
      // A transient refresh failure never discards the last valid detail. Keep
      // it visible and report the refresh problem inline until a later success.
      refreshError={fetchError}
      onRetryRefresh={retry}
    />
  );
}

// RecipeDetail-local presentation row for one ingredient usage: name/note/
// optional on the LEFT, the scaled quantity+unit on the RIGHT — the teammate
// two-column layout, built directly off the real structured ingredient
// fields (never off the merged `ingredientDisplayText` line CookMode uses).
// Kept local to this screen so CookMode's existing contract is untouched.
function ingredientDisplayRow(entry, opts) {
  if (!entry || !entry.ingredient || !entry.ingredient.name) return null;
  const id = entry.ingredient.id && String(entry.ingredient.id).trim() || null;
  const name = entry.ingredient.name;

  let qtyText = null;
  if (entry.unit === 'toTaste') {
    qtyText = 'To taste';
  } else {
    const quantity = scaleQuantity(entry.quantity, opts.selectedServings, opts.baseServings);
    const qty = formatQuantity(quantity);
    const unit = entry.unit ? unitLabel(entry.unit) : '';
    qtyText = [qty, unit].filter(Boolean).join(' ') || null;
  }

  return { id, name, note: entry.note || null, optional: !!entry.optional, qtyText };
}

function ApiRecipeDetail({ navigation, recipe, canPassRecipeContext, canImportSelection, recipeBlocked, onRecipeStale, onRecipeUnavailable, refreshError, onRetryRefresh }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const insets = useSafeAreaInsets();
  const { addRecipe, isMutating, pendingAction } = useShoppingList();

  const hasBaseServings = Number.isSafeInteger(recipe.servings) && recipe.servings > 0 && recipe.servings <= 100;
  const baseServings = hasBaseServings ? recipe.servings : null;
  const maxServings = Math.max(MAX_SERVINGS, baseServings || 0);
  const [servings, setServings] = useState(baseServings);
  useEffect(() => setServings(baseServings), [baseServings]);
  const spiceLevels = authoredSpiceLevels(recipe);
  const [spiceSelection, setSpiceLevel] = useState(null);
  const spiceLevel = spiceSelection === null ? spiceLevels[0] || null : spiceSelection;
  const selectedIngredients = selectedCookingIngredients(recipe, spiceLevel);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const [nutritionOpen, setNutritionOpen] = useState(false);
  const [collectionsOpen, setCollectionsOpen] = useState(false);
  const [mealPlanOpen, setMealPlanOpen] = useState(false);

  // M5B: real server-backed rating for this recipe. Kept local to this
  // screen rather than a global provider — RecipeDetail is the only surface
  // that reads or writes reviews (teammate's final UI exposes a star rating
  // only, never a review list — see final report), so a FavoritesContext-style
  // provider would be unjustified complexity here.
  const [reviewState, setReviewState] = useState({ status: 'loading', summary: null, myReview: null });
  const [ratingPending, setRatingPending] = useState(false);
  const ratingMutationBusyRef = useRef(false);
  const reviewMountedRef = useRef(true);
  const reviewGenerationRef = useRef(0);

  useEffect(() => {
    reviewMountedRef.current = true;
    return () => {
      reviewMountedRef.current = false;
      reviewGenerationRef.current += 1;
    };
  }, []);

  // limit: 1 — this screen only ever needs the aggregate summary + the
  // caller's own review, never the review list itself (teammate has no
  // review-list UI), so there is no reason to download many review rows.
  const loadReviewState = useCallback(async () => {
    const generation = ++reviewGenerationRef.current;
    setReviewState({ status: 'loading', summary: null, myReview: null });
    try {
      const { summary, currentUserReview } = await getRecipeReviews(recipe.id, { limit: 1 });
      if (!reviewMountedRef.current || generation !== reviewGenerationRef.current) return false;
      setReviewState({ status: 'ready', summary, myReview: currentUserReview });
      return true;
    } catch {
      if (!reviewMountedRef.current || generation !== reviewGenerationRef.current) return false;
      setReviewState({ status: 'error', summary: null, myReview: null });
      return false;
    }
  }, [recipe.id]);

  useFocusEffect(
    useCallback(() => {
      loadReviewState();
      return () => {
        reviewGenerationRef.current += 1;
      };
    }, [loadReviewState])
  );

  const myRating = reviewState.myReview ? reviewState.myReview.rating : 0;

  // M5C: real server-backed "has the current user ever cooked this recipe"
  // status for the teammate "Cooked" pill (boolean existence only — never a
  // count, never local/fake state). Kept as a small screen-local fetch, NOT
  // folded into CookHistoryContext: that context exists to sync the Profile
  // aggregate stat, and turning it into an unbounded per-recipe cooked-id
  // cache just to render one pill on one screen is unjustified complexity —
  // a focused request scoped to this recipe is the smaller architecture.
  //
  // Refetched on every screen FOCUS (not just on recipe.id change) so
  // finishing CookMode and tapping back onto this screen picks up the new
  // status immediately — CookMode's Finish -> navigation.goBack() lands
  // right back here and refires this effect.
  const [cookedState, setCookedState] = useState({ status: 'loading', hasCooked: false });
  const cookedMountedRef = useRef(true);
  const cookedGenerationRef = useRef(0);

  useEffect(() => {
    cookedMountedRef.current = true;
    return () => {
      cookedMountedRef.current = false;
      cookedGenerationRef.current += 1;
    };
  }, []);

  const loadCookedStatus = useCallback(async () => {
    const generation = ++cookedGenerationRef.current;
    setCookedState((s) => ({ ...s, status: 'loading' }));
    try {
      const { hasCooked } = await getRecipeStatus(recipe.id);
      if (!cookedMountedRef.current || generation !== cookedGenerationRef.current) return false;
      setCookedState({ status: 'ready', hasCooked });
      return true;
    } catch {
      if (!cookedMountedRef.current || generation !== cookedGenerationRef.current) return false;
      // A failed refresh means UNKNOWN, not "not cooked" — never overwrite a
      // previously confirmed hasCooked with a fabricated false. Preserving
      // `s.hasCooked` can't fabricate true either: it only ever became true
      // via a prior successful response for this exact recipe.id (a
      // recipe/account change always remounts this component — see
      // `key={params.recipeId}` and RootNavigator's auth-gated stack swap —
      // so there is no stale value to leak from a different recipe or user).
      setCookedState((s) => ({ status: 'error', hasCooked: s.hasCooked }));
      return false;
    }
  }, [recipe.id]);

  useFocusEffect(
    useCallback(() => {
      loadCookedStatus();
      return () => {
        cookedGenerationRef.current += 1;
      };
    }, [loadCookedStatus])
  );

  // Deliberately not gated on `status === 'ready'` — a failed refresh
  // (status 'error') must not hide a previously confirmed hasCooked:true.
  const cooked = cookedState.hasCooked;

  // Tap-to-rate, matching teammate's direct tap-to-submit interaction (no
  // confirm step, no comment UI — teammate exposes star rating only). POST
  // creates the caller's first review; PATCH updates the existing one, so a
  // user can never end up with two reviews for the same recipe. The visible
  // state is reloaded from the server after success rather than fabricated.
  const submitRating = async (n) => {
    if (ratingMutationBusyRef.current) return;
    if (ratingPending || reviewState.status !== 'ready') return;
    const previousReview = reviewState.myReview;
    if (!previousReview && !(cookedState.status === 'ready' && cookedState.hasCooked)) return;
    ratingMutationBusyRef.current = true;
    setRatingPending(true);
    try {
      if (previousReview && previousReview.id) {
        await updateReview(previousReview.id, { rating: n });
      } else {
        await createRecipeReview(recipe.id, { rating: n });
      }
      // Refresh from the server rather than computing the new average
      // locally — the aggregate is always authoritative/server-computed.
      await loadReviewState();
    } catch (err) {
      if (reviewMountedRef.current) {
        if (err?.code === 'REVIEW_ALREADY_EXISTS') {
          const refreshed = await loadReviewState();
          if (reviewMountedRef.current && refreshed) {
            Alert.alert('Rating refreshed', 'Your existing review was reloaded. Check it before rating again.');
          }
          return;
        }
        if (err?.code === 'REVIEW_COOK_REQUIRED') {
          await Promise.all([loadReviewState(), loadCookedStatus()]);
        }
        if (reviewMountedRef.current) {
          Alert.alert('Couldn’t save your rating', getReviewErrorMessage(err));
        }
      }
    } finally {
      ratingMutationBusyRef.current = false;
      if (reviewMountedRef.current) setRatingPending(false);
    }
  };

  const ratingSummaryText = (() => {
    if (reviewState.status === 'loading') return 'Loading ratings…';
    if (reviewState.status === 'error') return 'Ratings unavailable';
    const { averageRating, ratingCount } = reviewState.summary;
    if (!ratingCount) return 'No ratings yet';
    return `${averageRating} (${ratingCount} reviews)`;
  })();
  const hasRatings = reviewState.status === 'ready' && reviewState.summary.ratingCount > 0;
  const canCreateFirstReview = reviewState.status === 'ready'
    && !reviewState.myReview
    && cookedState.status === 'ready'
    && cookedState.hasCooked;
  const canUpdateExistingReview = reviewState.status === 'ready' && !!reviewState.myReview;
  const ratingMutationDisabled = ratingPending || !(canCreateFirstReview || canUpdateExistingReview);
  const firstReviewEligibilityText = cookedState.status === 'ready'
    ? 'Complete this recipe in WeCooked before rating or reviewing it.'
    : cookedState.status === 'loading'
      ? 'Checking your WeCooked cooking status…'
      : 'We couldn’t confirm your WeCooked cooking status. Try again from this recipe.';

  const badges = recipeBadges(recipe);
  const totalMins = totalTimeMinutes(recipe);

  // The complete authored selection travels with the Cook Mode handoff.
  const ingredientLines = useMemo(
    () =>
      (selectedIngredients || [])
        .map((entry) => ingredientDisplayText(entry, { selectedServings: servings, baseServings }))
        .filter(Boolean),
    [selectedIngredients, servings, baseServings]
  );

  // Teammate-shape two-column rows for this screen's own display only.
  const ingredientRows = useMemo(
    () =>
      (selectedIngredients || [])
        .map((entry) => ingredientDisplayRow(entry, { selectedServings: servings, baseServings }))
        .filter(Boolean),
    [selectedIngredients, servings, baseServings]
  );
  const recipeContext = useMemo(() => {
    const seen = new Set();
    return {
      recipeId: recipe.id,
      ingredients: (selectedIngredients || []).reduce((rows, entry) => {
        const name = typeof entry?.ingredient?.name === 'string' ? entry.ingredient.name.trim() : '';
        if (!name) return rows;
        const candidateId = typeof entry?.ingredient?.id === 'string' ? entry.ingredient.id.trim() : '';
        const id = /^[a-f\d]{24}$/i.test(candidateId) ? candidateId : null;
        if (id && seen.has(id)) return rows;
        if (id) seen.add(id);
        rows.push({ id: id || null, name });
        return rows;
      }, []),
    };
  }, [recipe.id, selectedIngredients]);

  const hasPrep = recipe.prepTimeMinutes != null;
  const hasCook = recipe.cookTimeMinutes != null;
  const meta = [
    { value: hasPrep || hasCook ? formatMinutes(totalMins) : '—', label: 'Time' },
    { value: recipe.difficulty ? difficultyLabel(recipe.difficulty) : '—', label: 'Difficulty' },
    { value: hasBaseServings ? String(servings) : '—', label: 'Servings' },
  ];
  const timeParts = [
    hasPrep ? `Prep ${formatMinutes(recipe.prepTimeMinutes)}` : null,
    hasCook ? `Cook ${formatMinutes(recipe.cookTimeMinutes)}` : null,
  ].filter(Boolean);

  const share = () => {
    Share.share({
      title: recipe.title,
      message: `${recipe.title} — ${recipe.description}`,
    }).catch(() => {});
  };

  const startCooking = () => {
    if (recipeBlocked || selectedIngredients === null) return;
    navigation.navigate('CookMode', {
      recipeSource: 'api',
      recipe,
      ingredients: ingredientLines,
      servings,
      spiceLevel,
    });
  };

  // Send the selected list identity to the v2 import; the backend resolves it.
  const addingToShoppingList = pendingAction?.type === 'addRecipe';
  const importReady = canImportSelection && hasBaseServings && selectedIngredients !== null
    && typeof recipe.updatedAt === 'string' && Number.isFinite(Date.parse(recipe.updatedAt));
  const addToShoppingList = async () => {
    if (!importReady) return;
    const selection = { servings, expectedRecipeUpdatedAt: recipe.updatedAt };
    if (spiceLevels.length > 0) selection.spiceLevel = spiceLevel;
    const result = await addRecipe(recipe.id, selection);
    if (!mountedRef.current) return;
    if (result.ok) {
      navigation.navigate('List');
    } else if (result.error) {
      if (result.err?.code === 'RECIPE_STALE'
        || result.err?.code === 'RECIPE_SPICE_LEVEL_UNAVAILABLE'
        || result.err?.code === 'RECIPE_SPICE_LEVEL_NOT_OFFERED') onRecipeStale();
      if (result.err?.code === 'RECIPE_NOT_FOUND') onRecipeUnavailable();
      Alert.alert('Couldn’t add to shopping list', result.error);
    }
    // result.busy (another shopping-list mutation in flight) / result.superseded
    // (session changed): silently ignored.
  };

  // Collections is real as of M5A (real CollectionPickerSheet, real API).
  // Ratings is real as of M5B (see submitRating above).
  const openCollections = () => setCollectionsOpen(true);
  const decrementServings = () => {
    if (hasBaseServings) setServings((s) => Math.max(MIN_SERVINGS, s - 1));
  };
  const incrementServings = () => {
    if (hasBaseServings) setServings((s) => Math.min(maxServings, s + 1));
  };

  return (
    <View style={styles.root}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 + insets.bottom }}>
        <View style={styles.ddHero}>
          <RecipeImage source={recipe.imageUrl} style={styles.ddHeroImage} />
          <View style={[styles.ddTopRow, { top: insets.top + spacing.sm }]}>
            <Pressable
              style={styles.ddCircleBtn}
              onPress={() => navigation.goBack()}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Ionicons name="chevron-back" size={18} color="#FAF9F6" />
            </Pressable>
            <View style={styles.ddRightIcons}>
              {/* Real Favorites API control via the shared FavoritesProvider. */}
              <FavoriteHeart recipe={recipe} size={16} variant="overlay" style={styles.ddCircleBtn} hitSlop={0} />
              <Pressable
                style={styles.ddCircleBtn}
                onPress={openCollections}
                accessibilityRole="button"
                accessibilityLabel="Add to a collection"
              >
                <Ionicons name="albums-outline" size={15} color="#FAF9F6" />
              </Pressable>
              <Pressable
                style={styles.ddCircleBtn}
                onPress={addToShoppingList}
                disabled={isMutating || !importReady}
                accessibilityRole="button"
                accessibilityLabel="Add ingredients to grocery list"
                accessibilityState={{ disabled: isMutating || !importReady }}
              >
                {addingToShoppingList ? (
                  <ActivityIndicator size="small" color="#FAF9F6" />
                ) : (
                  <Ionicons name="cart-outline" size={16} color="#FAF9F6" />
                )}
              </Pressable>
              <Pressable
                style={styles.ddCircleBtn}
                onPress={share}
                accessibilityRole="button"
                accessibilityLabel="Share recipe"
              >
                <Ionicons name="share-social-outline" size={16} color="#FAF9F6" />
              </Pressable>
            </View>
          </View>
        </View>

        <View style={styles.ddBody}>
          {refreshError ? (
            <Pressable style={styles.inlineBanner} onPress={onRetryRefresh}>
              <Ionicons name="refresh" size={14} color={colors.error} />
              <Text style={styles.inlineBannerText}>{refreshError} Tap to retry.</Text>
            </Pressable>
          ) : null}

          <Text style={styles.ddTitle}>{recipe.title}</Text>

          {/* M5B: real server-backed rating summary. The average/count come
              straight from the backend aggregate — never fabricated — and
              read as "No ratings yet" (a real, confirmed zero) rather than
              an "unavailable" placeholder.
              M5C: teammate-authoritative "Cooked" pill (c1c86ed), now real —
              rendered only once the server confirms this user has completed
              this recipe at least once; hidden while loading/unknown/false,
              exactly like the teammate's `{cooked && <View>...}` guard. */}
          <View style={styles.ddRatingRow}>
            <Ionicons name={hasRatings ? 'star' : 'star-outline'} size={13} color={hasRatings ? colors.stone : colors.inkFaint} />
            <Text style={styles.ddRatingText}>{ratingSummaryText}</Text>
            {cooked && (
              <View style={styles.ddCookedPill}>
                <Ionicons name="checkmark" size={11} color={colors.success} />
                <Text style={styles.ddCookedPillText}>Cooked</Text>
              </View>
            )}
          </View>

          {/* M5B: tapping a star submits a real rating immediately — POST for
              a first-time rating, PATCH once the caller already has one
              (myRating > 0) — matching teammate's direct tap-to-rate
              interaction exactly (no confirm step, no comment UI). */}
          <Pressable
            style={styles.ddReviewsLink}
            onPress={() => navigation.navigate('RecipeReviews', {
              recipeId: recipe.id,
              recipeTitle: recipe.title,
            })}
            accessibilityRole="button"
            accessibilityLabel={`Read and write reviews for ${recipe.title}`}
          >
            <Text style={styles.ddReviewsLinkText}>Read &amp; write reviews</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.inkSoft} />
          </Pressable>

          <View style={styles.ddRateRow}>
            <Text style={styles.ddRateLabel}>{myRating ? 'Your rating' : 'Rate this recipe'}</Text>
            <View style={styles.ddStarRow}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Pressable
                  key={n}
                  style={styles.ddStarBtn}
                  onPress={() => submitRating(n)}
                  disabled={ratingMutationDisabled}
                  accessibilityRole="button"
                  accessibilityLabel={`Rate ${n} star${n === 1 ? '' : 's'}`}
                  accessibilityState={{ selected: n <= myRating, disabled: ratingMutationDisabled, busy: ratingPending }}
                >
                  <Ionicons
                    name={n <= myRating ? 'star' : 'star-outline'}
                    size={20}
                    color={n <= myRating ? colors.stone : colors.inkFaint}
                  />
                </Pressable>
              ))}
            </View>
          </View>
          {reviewState.status === 'ready' && !reviewState.myReview && !canCreateFirstReview ? (
            <Text style={styles.ddReviewEligibilityText}>
              {firstReviewEligibilityText}
            </Text>
          ) : null}

          <View style={styles.ddMetaRow}>
            {meta.map((m) => (
              <View key={m.label} style={styles.ddMetaItem}>
                <Text style={styles.ddMetaValue}>{m.value}</Text>
                <Text style={styles.ddMetaLabel}>{m.label}</Text>
              </View>
            ))}
          </View>
          {timeParts.length > 0 ? <Text style={styles.ddSubStat}>{timeParts.join(' · ')}</Text> : null}

          {/* APPROVED WeCooked extension (not in teammate source): real M3
              category/region + dietary badges. Kept — see final report. */}
          {badges.length > 0 && (
            <View style={styles.tagRow}>
              {badges.map((label) => (
                <Badge key={label} label={label} tone="sage" />
              ))}
            </View>
          )}

          {recipe.description ? <Text style={styles.ddDescription}>{recipe.description}</Text> : null}

          <View style={styles.ddSectionHeader}>
            <Text style={styles.ddEyebrow}>Ingredients</Text>
            <View style={styles.ddStepper}>
              <Pressable
                onPress={decrementServings}
                style={styles.ddStepperBtn}
                disabled={!hasBaseServings || servings <= MIN_SERVINGS}
                accessibilityRole="button"
                accessibilityLabel="Decrease servings"
                accessibilityState={{ disabled: !hasBaseServings || servings <= MIN_SERVINGS }}
              >
                <Ionicons
                  name="remove"
                  size={15}
                  color={!hasBaseServings || servings <= MIN_SERVINGS ? colors.inkFaint : colors.inkSoft}
                />
              </Pressable>
              <Text style={styles.ddStepperValue}>{hasBaseServings ? servings : '—'}</Text>
              <Pressable
                onPress={incrementServings}
                style={styles.ddStepperBtn}
                disabled={!hasBaseServings || servings >= maxServings}
                accessibilityRole="button"
                accessibilityLabel="Increase servings"
                accessibilityState={{ disabled: !hasBaseServings || servings >= maxServings }}
              >
                <Ionicons
                  name="add"
                  size={15}
                  color={!hasBaseServings || servings >= maxServings ? colors.inkFaint : colors.inkSoft}
                />
              </Pressable>
            </View>
          </View>

          {spiceLevels.length > 0 && (
            <View style={styles.spiceSection}>
              <Text style={styles.ddEyebrow}>Spice level</Text>
              <View style={styles.spiceChoices}>
                {spiceLevels.map((level) => (
                  <Pressable
                    key={level}
                    style={[styles.spiceChoice, spiceLevel === level && styles.spiceChoiceSelected]}
                    onPress={() => setSpiceLevel(level)}
                    accessibilityRole="button"
                    accessibilityLabel={`Spice level ${level.replace('_', ' ')}`}
                    accessibilityState={{ selected: spiceLevel === level }}
                  >
                    <Text style={[styles.spiceChoiceText, spiceLevel === level && styles.spiceChoiceTextSelected]}>
                      {level.replace('_', ' ')}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}
          {selectedIngredients === null && (
            <Text style={styles.ddNutritionUnavailable}>That spice level is no longer available. Choose an available level.</Text>
          )}

          {ingredientRows.length === 0 ? (
            <Text style={styles.mutedText}>No ingredients listed.</Text>
          ) : (
            <View>
              {ingredientRows.map((row, i) => (
                <View key={`${row.id || 'unlinked'}-${i}`} style={styles.ddIngredientRow}>
                  <View style={styles.ddIngredientLeft}>
                    <Text style={styles.ddPlus}>−</Text>
                    <View style={styles.ddIngredientContent}>
                      <Text style={styles.ddIngredientName}>{row.name}</Text>
                      {row.note || row.optional ? (
                        <Text style={styles.ddIngredientNote}>
                          {[row.note, row.optional ? 'optional' : null].filter(Boolean).join(' · ')}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                  {row.qtyText ? <Text style={styles.ddIngredientQty}>{row.qtyText}</Text> : null}
                </View>
              ))}
            </View>
          )}

          <Pressable
            style={styles.ddNutritionCard}
            onPress={() => setNutritionOpen((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel="Nutrition information, per serving"
            accessibilityState={{ expanded: nutritionOpen }}
          >
            <View style={styles.ddNutritionHead}>
              <Text style={styles.ddNutritionTitle}>Nutrition Info</Text>
              <Text style={styles.ddNutritionToggle}>
                {nutritionOpen ? 'Hide Info −' : 'Show Info +'}
              </Text>
            </View>
            {nutritionOpen && (
              <View style={styles.ddNutritionBody}>
                {spiceLevels.length > 0 && spiceLevel !== spiceLevels[0] ? (
                  <Text style={styles.ddNutritionUnavailable}>
                    Nutrition is available for the default spice level only.
                  </Text>
                ) : recipe.nutrition === null ? (
                  <Text style={styles.ddNutritionUnavailable}>
                    Nutrition information isn't available for this recipe yet.
                  </Text>
                ) : (
                  <>
                    <Text style={styles.ddNutritionBasis}>Per serving</Text>
                    <View style={styles.ddNutritionGrid}>
                      {NUTRITION_ROWS.map(([field, label, unit]) => (
                        <View key={field} style={styles.ddNutritionRow}>
                          <Text style={styles.ddNutritionLabel}>{label}</Text>
                          <Text style={styles.ddNutritionValue}>{recipe.nutrition[field]} {unit}</Text>
                        </View>
                      ))}
                    </View>
                  </>
                )}
              </View>
            )}
          </Pressable>

          <Pressable
            style={styles.ddActionRow}
            onPress={() => setMealPlanOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Add to meal plan"
          >
            <View style={styles.ddActionIcon}>
              <Ionicons name="calendar-outline" size={16} color={colors.stone} />
            </View>
            <Text style={styles.ddActionText}>Add to meal plan</Text>
            <Ionicons name="chevron-forward" size={15} color={colors.inkSoft} />
          </Pressable>

          <Pressable
            style={styles.ddActionRow}
            onPress={() => navigation.navigate('IngredientStudio', { recipeContext: canPassRecipeContext ? recipeContext : null })}
            accessibilityRole="button"
            accessibilityLabel="Find swaps in Ingredient Studio"
          >
            <View style={styles.ddActionIcon}>
              <Ionicons name="swap-horizontal" size={16} color={colors.stone} />
            </View>
            <Text style={styles.ddActionText}>Need a substitute? Find swaps</Text>
            <Ionicons name="chevron-forward" size={15} color={colors.inkSoft} />
          </Pressable>
        </View>
      </ScrollView>

      <View style={[styles.ddCtaWrap, { paddingBottom: insets.bottom + spacing.lg }]}>
        <Button
          title="Start Cooking"
          variant="primary"
          onPress={startCooking}
          disabled={recipeBlocked || selectedIngredients === null}
          icon={<Ionicons name="play" size={15} color={colors.onAccent} />}
        />
      </View>

      <CollectionPickerSheet
        visible={collectionsOpen}
        onClose={() => setCollectionsOpen(false)}
        recipeId={recipe.id}
      />

      <MealPlanSheet
        visible={mealPlanOpen}
        onClose={() => setMealPlanOpen(false)}
        recipeId={recipe.id}
      />
    </View>
  );
}

function RecipeDetailNotice({ navigation, styles, colors, insets, icon, message, onRetry }) {
  return (
    <View style={[styles.root, styles.centerScreen]}>
      <Pressable
        style={[styles.iconBtn, styles.noticeBackBtn, { top: insets.top + spacing.sm }]}
        onPress={() => navigation.goBack()}
      >
        <Ionicons name="arrow-back" size={20} color={colors.ink} />
      </Pressable>
      <Ionicons name={icon} size={40} color={colors.inkFaint} />
      <Text style={styles.noticeText}>{message}</Text>
      <View style={styles.noticeActions}>
        {onRetry ? (
          <Button title="Try Again" variant="primary" onPress={onRetry} fullWidth={false} />
        ) : null}
        <Button title="Go Back" variant="outline" onPress={() => navigation.goBack()} fullWidth={false} />
      </View>
    </View>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    centerScreen: { alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
    noticeBackBtn: { position: 'absolute', left: spacing.lg, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.hairline },
    noticeText: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.md,
      color: colors.inkSoft,
      textAlign: 'center',
      marginTop: spacing.sm,
    },
    noticeActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
    iconBtn: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: 'rgba(0,0,0,0.45)',
      alignItems: 'center',
      justifyContent: 'center',
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
    tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
    mutedText: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.inkFaint,
    },
    // ---- RecipeDetail — teammate visual shell over real data/actions. ----
    ddHero: { position: 'relative', height: 280, backgroundColor: colors.creamDeep },
    ddHeroImage: { width: '100%', height: '100%' },
    ddTopRow: {
      position: 'absolute',
      left: spacing.lg,
      right: spacing.lg,
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    ddCircleBtn: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: 'rgba(18,22,14,0.55)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    ddRightIcons: { flexDirection: 'row', gap: spacing.sm },
    ddBody: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.xl },
    ddTitle: {
      fontFamily: typography.display.fontFamily,
      fontSize: 24,
      lineHeight: 29,
      color: colors.ink,
    },
    ddRatingRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 5, marginTop: spacing.sm },
    ddRatingText: {
      fontFamily: typography.body.fontFamily,
      fontSize: 12.5,
      color: colors.inkSoft,
    },
    ddReviewsLink: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: spacing.xs,
      minHeight: 44,
      marginTop: spacing.xs,
      paddingVertical: spacing.xs,
    },
    ddReviewsLinkText: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.sm,
      color: colors.inkSoft,
    },
    ddReviewEligibilityText: {
      marginTop: spacing.xs,
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.xs,
      color: colors.inkSoft,
    },
    // Teammate's exact filled/affirmative "Cooked" treatment (c1c86ed's
    // cookedPill/cookedPillText) — now backed by the real M5C Cook History
    // status, rendered only when the server confirms `hasCooked`.
    ddCookedPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      marginLeft: 6,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: radius.pill,
      backgroundColor: colors.successBg,
    },
    ddCookedPillText: { fontFamily: typography.body.bold, fontSize: 10.5, color: colors.success },
    ddRateRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.xs,
      marginTop: spacing.xs,
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.sageLight,
    },
    ddRateLabel: { fontFamily: typography.body.semibold, fontSize: 12.5, color: colors.inkSoft, flexShrink: 1 },
    ddStarRow: { flexDirection: 'row', flexWrap: 'wrap' },
    ddStarBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    ddMetaRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
    ddMetaItem: { flex: 1, minWidth: 0 },
    ddMetaValue: {
      fontFamily: typography.body.semibold,
      fontSize: 13.5,
      color: colors.ink,
    },
    ddMetaLabel: {
      fontFamily: typography.body.fontFamily,
      fontSize: 11,
      color: colors.inkSoft,
      marginTop: 1,
    },
    ddSubStat: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.xs,
      color: colors.inkSoft,
      marginTop: spacing.xs,
    },
    ddDescription: {
      fontFamily: typography.body.fontFamily,
      fontSize: 13.5,
      lineHeight: 21,
      color: colors.inkSoft,
      marginTop: spacing.sm,
    },
    ddSectionHeader: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
      marginTop: spacing.lg,
      marginBottom: spacing.xs,
    },
    ddEyebrow: {
      fontFamily: typography.body.bold,
      fontSize: 11.5,
      letterSpacing: 1.1,
      textTransform: 'uppercase',
      color: colors.inkSoft,
    },
    ddStepper: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      backgroundColor: colors.creamDeep,
      borderRadius: radius.pill,
      paddingHorizontal: 6,
      paddingVertical: 5,
    },
    ddStepperBtn: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.sagePale,
      alignItems: 'center',
      justifyContent: 'center',
    },
    ddStepperValue: {
      fontFamily: typography.body.bold,
      fontSize: 13,
      color: colors.ink,
      minWidth: 14,
      textAlign: 'center',
    },
    spiceSection: { marginTop: spacing.md, gap: spacing.xs },
    spiceChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    spiceChoice: {
      minHeight: 44, paddingHorizontal: spacing.md, justifyContent: 'center',
      borderRadius: radius.pill, backgroundColor: colors.creamDeep,
      borderWidth: 1, borderColor: colors.hairline,
    },
    spiceChoiceSelected: { backgroundColor: colors.sageDeep, borderColor: colors.sageDeep },
    spiceChoiceText: { fontFamily: typography.body.semibold, fontSize: 13, color: colors.ink },
    spiceChoiceTextSelected: { color: colors.onAccent },
    ddIngredientRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: spacing.sm,
      paddingVertical: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.hairline,
    },
    ddIngredientLeft: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, flex: 1, minWidth: 0 },
    ddIngredientContent: { flex: 1, minWidth: 0 },
    ddPlus: { fontFamily: typography.body.semibold, fontSize: 15, color: colors.inkSoft },
    ddIngredientName: {
      fontFamily: typography.body.fontFamily,
      fontSize: 14,
      color: colors.ink,
      flexShrink: 1,
    },
    ddIngredientNote: {
      fontFamily: typography.body.fontFamily,
      fontSize: 11.5,
      color: colors.inkSoft,
      marginTop: 1,
    },
    ddIngredientQty: {
      fontFamily: typography.body.fontFamily,
      fontSize: 13,
      color: colors.inkSoft,
      maxWidth: '35%',
      flexShrink: 1,
      textAlign: 'right',
    },
    ddNutritionCard: {
      marginTop: spacing.xl,
      borderWidth: 1,
      borderColor: colors.hairline,
      borderRadius: radius.md,
      padding: spacing.lg,
    },
    ddNutritionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    ddNutritionTitle: { fontFamily: typography.display.fontFamily, fontSize: 16, color: colors.ink },
    ddNutritionToggle: { fontFamily: typography.body.bold, fontSize: 12.5, color: colors.sageDeep },
    ddNutritionBody: { marginTop: spacing.md },
    ddNutritionBasis: {
      fontFamily: typography.body.semibold,
      fontSize: 12.5,
      color: colors.inkSoft,
      marginBottom: spacing.sm,
    },
    ddNutritionGrid: { gap: spacing.xs },
    ddNutritionRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: spacing.md,
      paddingVertical: spacing.xs,
      borderBottomWidth: 1,
      borderBottomColor: colors.hairline,
    },
    ddNutritionLabel: { fontFamily: typography.body.fontFamily, fontSize: 12.5, color: colors.inkSoft },
    ddNutritionValue: { fontFamily: typography.body.semibold, fontSize: 12.5, color: colors.ink },
    ddNutritionUnavailable: {
      fontFamily: typography.body.fontFamily,
      fontSize: 12.5,
      color: colors.inkFaint,
    },
    ddActionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 44,
      gap: 12,
      marginTop: spacing.lg,
      padding: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.sageLight,
    },
    ddActionIcon: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: colors.stoneLight,
      alignItems: 'center',
      justifyContent: 'center',
    },
    ddActionText: { flex: 1, fontFamily: typography.body.semibold, fontSize: 13.5, color: colors.ink },
    ddCtaWrap: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.md,
      backgroundColor: colors.cream,
    },
  });
}
