import React, { useState } from 'react';
import { Pressable, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { useFavorites } from '../context/FavoritesContext';

// Shared favorite (heart) control for API-backed recipe surfaces
// (Dashboard / Discover / API Recipe Detail / Saved).
//
// It consumes FavoritesProvider — the single source of favorite truth — so
// every instance for the same recipe stays in sync across screens.
//
// `recipe` MUST be a backend recipe (a real Mongo `id`). Legacy / mock recipes
// must never be passed here — those keep using SavedRecipesContext, and their
// ids would be rejected by the Favorites API.
//
// States:
//   - initializing / load-error  -> dimmed neutral outline, not interactive
//     (a tap while the initial load errored retries it); the heart never
//     claims "unsaved" before favorites have actually loaded.
//   - mutation pending           -> small spinner, taps ignored
//   - saved / unsaved            -> filled / outline heart
export default function FavoriteHeart({
  recipe,
  size = 18,
  variant = 'overlay', // 'overlay' = sits on a photo (white idle) | 'plain'
  style,
  hitSlop = 8,
}) {
  const { colors } = useTheme();
  const { isFavorite, isPending, isInitializing, status, toggleFavorite, reload } = useFavorites();
  const [busy, setBusy] = useState(false);

  const recipeId = recipe && recipe.id;
  const saved = isFavorite(recipeId);
  const pending = busy || isPending(recipeId);
  const unknown = isInitializing || status === 'error';
  const disabled = !recipeId || pending || unknown;

  const onPress = async () => {
    if (!recipeId) return;
    if (status === 'error') {
      reload();
      return;
    }
    if (disabled) return;
    setBusy(true);
    try {
      const res = await toggleFavorite(recipe);
      if (res && res.ok === false && res.error && !res.pendingIgnored && !res.noop) {
        Alert.alert('', res.error);
      }
    } finally {
      setBusy(false);
    }
  };

  const onOverlay = variant === 'overlay';
  const spinnerColor = onOverlay ? '#fff' : colors.sageDeep;
  const idleColor = onOverlay ? '#fff' : colors.inkFaint;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled && status !== 'error'}
      hitSlop={hitSlop}
      style={[styles.base, style]}
      accessibilityRole="button"
      accessibilityLabel={saved ? 'Remove from favorites' : 'Save to favorites'}
      accessibilityState={{ selected: saved, disabled, busy: pending }}
    >
      {pending ? (
        <ActivityIndicator size="small" color={spinnerColor} />
      ) : (
        <Ionicons
          name={saved && !unknown ? 'heart' : 'heart-outline'}
          size={size}
          color={saved && !unknown ? colors.sageDeep : idleColor}
          style={unknown ? styles.unknown : null}
        />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
  unknown: { opacity: 0.35 },
});
