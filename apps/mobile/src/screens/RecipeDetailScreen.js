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
import SubstitutionsSheet from '../components/SubstitutionsSheet';
import CollectionPickerSheet from '../components/CollectionPickerSheet';
import MealPlanSheet from '../components/MealPlanSheet';
import { useShoppingList } from '../context/ShoppingListContext';
import { getRecipe } from '../api/recipeService';
import { getRecipeErrorMessage } from '../api/recipeErrors';
import { getRecipeReviews, createReview, updateReview } from '../api/reviewService';
import { getReviewErrorMessage } from '../api/reviewErrors';
import { getRecipeStatus } from '../api/cookHistoryService';
import { difficultyLabel, unitLabel } from '../api/recipeOptions';
import useRecipeScreenRefresh from '../hooks/useRecipeScreenRefresh';
import { classifyRecipeDetailFailure } from '../utils/recipeFreshnessState';
import {
  formatMinutes,
  formatQuantity,
  hasRecipeDetailData,
  ingredientDisplayText,
  cookModeSteps,
  recipeBadges,
  scaleQuantity,
  totalTimeMinutes,
} from '../utils/recipe';

const MIN_SERVINGS = 1;
const MAX_SERVINGS = 20;

// -------------------------------------------------------------------------
// Recipe Detail accepts only the real API route contract. Every current caller
// supplies recipeSource + recipeId; unsupported legacy/mock objects are never
// rendered as product data.
// -------------------------------------------------------------------------
export default function RecipeDetailScreen({ navigation, route }) {
  const params = route.params || {};

  if (params.recipeSource === 'api' && params.recipeId) {
    // `key` forces a full remount if the route's recipeId ever changes in place
    // (e.g. a future "related recipe" tap or a deep link while already on a
    // detail screen), so no fetched/notFound/servings state from the previous
    // recipe can leak into the next one.
    return (
      <ApiRecipeDetailContainer
        key={params.recipeId}
        navigation={navigation}
        recipeId={params.recipeId}
        initialRecipe={params.initialRecipe || null}
      />
    );
  }

  return <InvalidRecipeDetail navigation={navigation} />;
}

function InvalidRecipeDetail({ navigation }) {
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
      message="This recipe isn't available."
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
    setNotFound(false);
    (async () => {
      try {
        const fresh = await getRecipe(recipeId);
        if (cancelled || gen !== genRef.current) return;
        setFetched(fresh);
        setFetchError(null);
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

  const retry = () => setNonce((n) => n + 1);
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
      navigation={navigation}
      recipe={recipe}
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
  const id = entry.ingredient.id ? String(entry.ingredient.id) : null;
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

function ApiRecipeDetail({ navigation, recipe, refreshError, onRetryRefresh }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const insets = useSafeAreaInsets();
  const { addRecipe, isMutating, pendingAction } = useShoppingList();

  const baseServings = recipe.servings > 0 ? recipe.servings : 1;
  const maxServings = Math.max(MAX_SERVINGS, baseServings);
  const [servings, setServings] = useState(baseServings);
  const [nutritionOpen, setNutritionOpen] = useState(false);
  const substitutesCacheRef = useRef(new Map());
  const [swapIngredient, setSwapIngredient] = useState(null);
  const [collectionsOpen, setCollectionsOpen] = useState(false);
  const [mealPlanOpen, setMealPlanOpen] = useState(false);

  // M5B: real server-backed rating for this recipe. Kept local to this
  // screen rather than a global provider — RecipeDetail is the only surface
  // that reads or writes reviews (teammate's final UI exposes a star rating
  // only, never a review list — see final report), so a FavoritesContext-style
  // provider would be unjustified complexity here.
  const [reviewState, setReviewState] = useState({ status: 'loading', summary: null, myReview: null });
  const [ratingPending, setRatingPending] = useState(false);
  const reviewMountedRef = useRef(true);

  useEffect(() => {
    reviewMountedRef.current = true;
    return () => {
      reviewMountedRef.current = false;
    };
  }, []);

  // limit: 1 — this screen only ever needs the aggregate summary + the
  // caller's own review, never the review list itself (teammate has no
  // review-list UI), so there is no reason to download many review rows.
  useEffect(() => {
    let cancelled = false;
    setReviewState({ status: 'loading', summary: null, myReview: null });
    (async () => {
      try {
        const { summary, currentUserReview } = await getRecipeReviews(recipe.id, { limit: 1 });
        if (cancelled) return;
        setReviewState({ status: 'ready', summary, myReview: currentUserReview });
      } catch {
        if (cancelled) return;
        // Honest fallback, never a fabricated summary: reserved for a genuine
        // request failure now, rather than "the backend doesn't exist yet".
        setReviewState({ status: 'error', summary: null, myReview: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [recipe.id]);

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

  useEffect(() => {
    cookedMountedRef.current = true;
    return () => {
      cookedMountedRef.current = false;
    };
  }, []);

  const loadCookedStatus = useCallback(async () => {
    setCookedState((s) => ({ ...s, status: 'loading' }));
    try {
      const { hasCooked } = await getRecipeStatus(recipe.id);
      if (!cookedMountedRef.current) return;
      setCookedState({ status: 'ready', hasCooked });
    } catch {
      if (!cookedMountedRef.current) return;
      // A failed refresh means UNKNOWN, not "not cooked" — never overwrite a
      // previously confirmed hasCooked with a fabricated false. Preserving
      // `s.hasCooked` can't fabricate true either: it only ever became true
      // via a prior successful response for this exact recipe.id (a
      // recipe/account change always remounts this component — see
      // `key={params.recipeId}` and RootNavigator's auth-gated stack swap —
      // so there is no stale value to leak from a different recipe or user).
      setCookedState((s) => ({ status: 'error', hasCooked: s.hasCooked }));
    }
  }, [recipe.id]);

  useFocusEffect(
    useCallback(() => {
      loadCookedStatus();
    }, [loadCookedStatus])
  );

  // Deliberately not gated on `status === 'ready'` — a failed refresh
  // (status 'error') must not hide a previously confirmed hasCooked:true.
  const cooked = cookedState.hasCooked;

  // Tap-to-rate, matching teammate's direct tap-to-submit interaction (no
  // confirm step, no comment UI — teammate exposes star rating only). POST
  // creates the caller's first review; PATCH updates the existing one, so a
  // user can never end up with two reviews for the same recipe. Optimistic
  // star fill is rolled back on failure — never a faked success.
  const submitRating = async (n) => {
    if (ratingPending || reviewState.status === 'loading') return;
    const previousReview = reviewState.myReview;
    setRatingPending(true);
    setReviewState((s) => ({
      ...s,
      myReview: previousReview ? { ...previousReview, rating: n } : { id: null, rating: n, comment: null },
    }));

    try {
      if (previousReview && previousReview.id) {
        await updateReview(previousReview.id, { rating: n });
      } else {
        await createReview(recipe.id, { rating: n });
      }
      // Refresh from the server rather than computing the new average
      // locally — the aggregate is always authoritative/server-computed.
      const refreshed = await getRecipeReviews(recipe.id, { limit: 1 });
      if (reviewMountedRef.current) {
        setReviewState({ status: 'ready', summary: refreshed.summary, myReview: refreshed.currentUserReview });
      }
    } catch (err) {
      if (reviewMountedRef.current) {
        setReviewState((s) => ({ ...s, myReview: previousReview }));
        Alert.alert('Couldn’t save your rating', getReviewErrorMessage(err));
      }
    } finally {
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

  const badges = recipeBadges(recipe);
  const totalMins = totalTimeMinutes(recipe);

  // Unchanged contract for Cook Mode: the same ordered, filtered array of
  // merged display strings this screen has always handed to CookMode (via
  // the full `recipe` object CookMode also receives, instructions/steps
  // included — this slice only changes what RecipeDetail itself renders).
  const ingredientLines = useMemo(
    () =>
      (recipe.ingredients || [])
        .map((entry) => ingredientDisplayText(entry, { selectedServings: servings, baseServings }))
        .filter(Boolean),
    [recipe.ingredients, servings, baseServings]
  );

  // Teammate-shape two-column rows for this screen's own display only.
  const ingredientRows = useMemo(
    () =>
      (recipe.ingredients || [])
        .map((entry) => ingredientDisplayRow(entry, { selectedServings: servings, baseServings }))
        .filter(Boolean),
    [recipe.ingredients, servings, baseServings]
  );
  const instructionSteps = useMemo(() => cookModeSteps(recipe), [recipe]);

  const meta = [
    { value: formatMinutes(totalMins), label: 'Time' },
    { value: difficultyLabel(recipe.difficulty), label: 'Difficulty' },
    { value: String(servings), label: 'Servings' },
  ];

  const share = () => {
    Share.share({
      title: recipe.title,
      message: `${recipe.title} — ${recipe.description}`,
    }).catch(() => {});
  };

  const startCooking = () => {
    navigation.navigate('CookMode', {
      recipeSource: 'api',
      recipe,
      ingredients: ingredientLines,
      servings,
    });
  };

  // Backed by the Shopping List REST API. Sends ONLY the recipe id — no body,
  // no multiplier, no servings. The backend imports the recipe's base-serving
  // quantities and merges them into the user's one list (see the note under the
  // button and docs/architecture/mobile-shopping-list-integration.md). Never
  // dual-writes to any local state.
  const addingToShoppingList = pendingAction?.type === 'addRecipe';
  const addToShoppingList = async () => {
    const result = await addRecipe(recipe.id);
    if (result.ok) {
      navigation.navigate('List');
    } else if (result.error) {
      Alert.alert('Couldn’t add to shopping list', result.error);
    }
    // result.busy (another shopping-list mutation in flight) / result.superseded
    // (session changed): silently ignored.
  };

  // Collections is real as of M5A (real CollectionPickerSheet, real API).
  // Ratings is real as of M5B (see submitRating above).
  const openCollections = () => setCollectionsOpen(true);
  const openSubstitutes = (row) => {
    if (!row?.id || !row?.name) return;
    setSwapIngredient({ id: row.id, name: row.name });
  };
  const closeSubstitutes = () => setSwapIngredient(null);

  const decrementServings = () => setServings((s) => Math.max(MIN_SERVINGS, s - 1));
  const incrementServings = () => setServings((s) => Math.min(maxServings, s + 1));

  return (
    <View style={styles.root}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
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
              <FavoriteHeart recipe={recipe} size={16} variant="overlay" style={styles.ddCircleBtn} />
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
                disabled={isMutating}
                accessibilityRole="button"
                accessibilityLabel="Add ingredients to grocery list"
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
          <View style={styles.ddRateRow}>
            <Text style={styles.ddRateLabel}>{myRating ? 'Your rating' : 'Rate this recipe'}</Text>
            <View style={styles.ddStarRow}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Pressable
                  key={n}
                  hitSlop={4}
                  onPress={() => submitRating(n)}
                  disabled={ratingPending || reviewState.status === 'loading'}
                  accessibilityRole="button"
                  accessibilityLabel={`Rate ${n} star${n === 1 ? '' : 's'}`}
                  accessibilityState={{ selected: n <= myRating, disabled: ratingPending || reviewState.status === 'loading' }}
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

          <View style={styles.ddMetaRow}>
            {meta.map((m) => (
              <View key={m.label}>
                <Text style={styles.ddMetaValue}>{m.value}</Text>
                <Text style={styles.ddMetaLabel}>{m.label}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.ddSubStat}>
            Prep {formatMinutes(recipe.prepTimeMinutes)} · Cook {formatMinutes(recipe.cookTimeMinutes)}
          </Text>

          {/* APPROVED WeCooked extension (not in teammate source): real M3
              category/region + dietary badges. Kept — see final report. */}
          {badges.length > 0 && (
            <View style={styles.tagRow}>
              {badges.map((label) => (
                <Badge key={label} label={label} tone="sage" />
              ))}
            </View>
          )}

          <Text style={styles.ddDescription}>{recipe.description}</Text>

          <View style={styles.ddSectionHeader}>
            <Text style={styles.ddEyebrow}>Ingredients</Text>
            <View style={styles.ddStepper}>
              <Pressable
                onPress={decrementServings}
                hitSlop={8}
                style={styles.ddStepperBtn}
                disabled={servings <= MIN_SERVINGS}
                accessibilityRole="button"
                accessibilityLabel="Decrease servings"
              >
                <Ionicons
                  name="remove"
                  size={15}
                  color={servings <= MIN_SERVINGS ? colors.inkFaint : colors.sageDeep}
                />
              </Pressable>
              <Text style={styles.ddStepperValue}>{servings}</Text>
              <Pressable
                onPress={incrementServings}
                hitSlop={8}
                style={styles.ddStepperBtn}
                disabled={servings >= maxServings}
                accessibilityRole="button"
                accessibilityLabel="Increase servings"
              >
                <Ionicons
                  name="add"
                  size={15}
                  color={servings >= maxServings ? colors.inkFaint : colors.sageDeep}
                />
              </Pressable>
            </View>
          </View>

          {ingredientRows.length === 0 ? (
            <Text style={styles.mutedText}>No ingredients listed.</Text>
          ) : (
            <View>
              {ingredientRows.map((row, i) => (
                <View key={row.id || i} style={styles.ddIngredientRow}>
                  <View style={styles.ddIngredientLeft}>
                    <Text style={styles.ddPlus}>+</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.ddIngredientName}>{row.name}</Text>
                      {row.note || row.optional ? (
                        <Text style={styles.ddIngredientNote}>
                          {[row.note, row.optional ? 'optional' : null].filter(Boolean).join(' · ')}
                        </Text>
                      ) : null}
                      {row.id ? (
                        <Pressable
                          style={styles.ddSubstituteBtn}
                          onPress={() => openSubstitutes(row)}
                          hitSlop={6}
                        >
                          <Ionicons name="swap-horizontal" size={12} color={colors.sageDeep} />
                          <Text style={styles.ddSubstituteText}>Substitutes</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  </View>
                  {row.qtyText ? <Text style={styles.ddIngredientQty}>{row.qtyText}</Text> : null}
                </View>
              ))}
            </View>
          )}

          <View style={styles.ddInstructionsSection}>
            <Text style={styles.ddEyebrow}>Instructions</Text>
            {instructionSteps.length === 0 ? (
              <Text style={styles.mutedText}>No instructions listed.</Text>
            ) : (
              instructionSteps.map((step) => (
                <View key={step.order} style={styles.ddInstructionRow}>
                  <View style={styles.ddInstructionIndex}>
                    <Text style={styles.ddInstructionIndexText}>{step.order}</Text>
                  </View>
                  <Text style={styles.ddInstructionText}>{step.text}</Text>
                </View>
              ))
            )}
          </View>

          <Pressable style={styles.ddNutritionCard} onPress={() => setNutritionOpen((v) => !v)}>
            <View style={styles.ddNutritionHead}>
              <Text style={styles.ddNutritionTitle}>Nutrition Info</Text>
              <Text style={styles.ddNutritionToggle}>
                {nutritionOpen ? 'Hide Info −' : 'Show Info +'}
              </Text>
            </View>
            {nutritionOpen && (
              <View style={styles.ddNutritionBody}>
                <Text style={styles.ddNutritionUnavailable}>
                  Nutrition information isn't available for this recipe yet.
                </Text>
              </View>
            )}
          </Pressable>

          <Pressable
            style={styles.ddActionRow}
            onPress={() => setMealPlanOpen(true)}
          >
            <View style={styles.ddActionIcon}>
              <Ionicons name="calendar-outline" size={16} color={colors.stone} />
            </View>
            <Text style={styles.ddActionText}>Add to meal plan</Text>
            <Ionicons name="chevron-forward" size={15} color={colors.inkFaint} />
          </Pressable>

          <Pressable
            style={styles.ddActionRow}
            onPress={() =>
              Alert.alert(
                'Choose an ingredient',
                'Tap Substitutes beside an ingredient above to view live catalog suggestions.'
              )
            }
          >
            <View style={styles.ddActionIcon}>
              <Ionicons name="swap-horizontal" size={16} color={colors.stone} />
            </View>
            <Text style={styles.ddActionText}>Need a substitute? Find swaps</Text>
            <Ionicons name="chevron-forward" size={15} color={colors.inkFaint} />
          </Pressable>
        </View>
      </ScrollView>

      <View style={[styles.ddCtaWrap, { paddingBottom: insets.bottom + spacing.lg }]}>
        <Button
          title="Start Cooking"
          variant="primary"
          onPress={startCooking}
          icon={<Ionicons name="play" size={15} color={colors.onAccent} />}
        />
      </View>

      <SubstitutionsSheet
        visible={!!swapIngredient}
        ingredient={swapIngredient}
        cacheRef={substitutesCacheRef}
        onClose={closeSubstitutes}
      />

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
    tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
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
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: 'rgba(18,22,14,0.55)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    ddRightIcons: { flexDirection: 'row', gap: spacing.sm },
    ddBody: { padding: spacing.xl },
    ddTitle: {
      fontFamily: typography.display.fontFamily,
      fontSize: 24,
      lineHeight: 29,
      color: colors.ink,
    },
    ddRatingRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 10 },
    ddRatingText: {
      fontFamily: typography.body.fontFamily,
      fontSize: 12.5,
      color: colors.inkFaint,
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
    ddSubstituteBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: 4,
      marginTop: 5,
      paddingVertical: 3,
    },
    ddSubstituteText: {
      fontFamily: typography.body.semibold,
      fontSize: 11.5,
      color: colors.sageDeep,
    },
    ddRateRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: spacing.md,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.sageLight,
    },
    ddRateLabel: { fontFamily: typography.body.semibold, fontSize: 12.5, color: colors.inkSoft },
    ddStarRow: { flexDirection: 'row', gap: 4 },
    ddMetaRow: { flexDirection: 'row', gap: 20, marginTop: 16 },
    ddMetaValue: {
      fontFamily: typography.body.semibold,
      fontSize: 13.5,
      color: colors.ink,
    },
    ddMetaLabel: {
      fontFamily: typography.body.fontFamily,
      fontSize: 11,
      color: colors.inkFaint,
      marginTop: 1,
    },
    ddSubStat: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.xs,
      color: colors.inkFaint,
      marginTop: spacing.xs,
    },
    ddDescription: {
      fontFamily: typography.body.fontFamily,
      fontSize: 13.5,
      lineHeight: 21,
      color: colors.inkSoft,
      marginTop: 16,
    },
    ddSectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 24,
      marginBottom: spacing.md,
    },
    ddEyebrow: {
      fontFamily: typography.body.bold,
      fontSize: 11.5,
      letterSpacing: 1.1,
      textTransform: 'uppercase',
      color: colors.inkFaint,
    },
    ddStepper: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      backgroundColor: colors.creamDeep,
      borderRadius: radius.pill,
      paddingHorizontal: 6,
      paddingVertical: 5,
    },
    ddStepperBtn: {
      width: 24,
      height: 24,
      borderRadius: 12,
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
    ddIngredientRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
      paddingVertical: 11,
      borderBottomWidth: 1,
      borderBottomColor: colors.hairline,
    },
    ddIngredientLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
    ddPlus: { fontFamily: typography.body.semibold, fontSize: 15, color: colors.sageDeep },
    ddIngredientName: {
      fontFamily: typography.body.fontFamily,
      fontSize: 14,
      color: colors.ink,
    },
    ddIngredientNote: {
      fontFamily: typography.body.fontFamily,
      fontSize: 11.5,
      color: colors.inkFaint,
      marginTop: 1,
    },
    ddIngredientQty: {
      fontFamily: typography.body.fontFamily,
      fontSize: 13,
      color: colors.inkFaint,
    },
    ddInstructionsSection: { marginTop: spacing.xl, gap: spacing.md },
    ddInstructionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
    ddInstructionIndex: {
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: colors.sageDeep,
      alignItems: 'center',
      justifyContent: 'center',
    },
    ddInstructionIndexText: {
      fontFamily: typography.body.bold,
      fontSize: typography.sizes.xs,
      color: colors.onAccent,
    },
    ddInstructionText: {
      flex: 1,
      fontFamily: typography.body.fontFamily,
      fontSize: 13.5,
      lineHeight: 21,
      color: colors.ink,
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
    ddNutritionUnavailable: {
      fontFamily: typography.body.fontFamily,
      fontSize: 12.5,
      color: colors.inkFaint,
    },
    ddActionRow: {
      flexDirection: 'row',
      alignItems: 'center',
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
