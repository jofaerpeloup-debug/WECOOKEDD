import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { typography, spacing } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import { useNotifications } from '../context/NotificationsContext';
import NotificationsDropdown from './NotificationsDropdown';

function Wordmark({ style }) {
  const { colors } = useTheme();
  return (
    <Text style={style}>
      <Text style={{ color: colors.sageDeep }}>We</Text>
      <Text style={{ color: colors.ink }}>Cooked</Text>
    </Text>
  );
}

/**
 * mode: 'brand' (wordmark · [saved] · notification bell)
 *     | 'title' (centered title for a tab screen)
 *     | 'back' (back arrow · title · action)
 *
 * `onSavedPress` is opt-in: only screens that pass it get the bookmark
 * affordance (teammate `c1c86ed` Dashboard header). Every other `mode="brand"`
 * caller renders the wordmark and notification bell without a Saved action.
 * `onShoppingPress` is likewise opt-in. `shoppingCount` is presentation-only;
 * the caller remains responsible for supplying an authoritative count.
 */
export default function TopBar({
  mode = 'brand',
  title,
  onBack,
  onBellPress,
  onSavedPress,
  onShoppingPress,
  shoppingCount,
  rightIcon,
  onRightPress,
  transparent = false,
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { unreadCount } = useNotifications();
  const [notifVisible, setNotifVisible] = useState(false);

  const pressBell = () => {
    if (onBellPress) onBellPress();
    else setNotifVisible(true);
  };

  const hasShoppingCount = Number.isInteger(shoppingCount) && shoppingCount > 0;
  const shoppingLabel = hasShoppingCount
    ? `Shopping list, ${shoppingCount} unchecked ${shoppingCount === 1 ? 'item' : 'items'}`
    : 'Shopping list';

  return (
    <View
      style={[
        styles.wrap,
        { paddingTop: insets.top + spacing.sm },
        transparent && { backgroundColor: 'transparent', borderBottomWidth: 0 },
      ]}
    >
      {mode === 'brand' ? (
        <>
          <View style={styles.edgeSpacer} />
          <View style={styles.brandRow}>
            <Wordmark style={styles.brand} />
          </View>
          <View style={styles.bellCluster}>
            {onSavedPress && (
              <Pressable
                onPress={onSavedPress}
                hitSlop={10}
                style={styles.savedBtn}
                accessibilityRole="button"
                accessibilityLabel="Saved recipes"
              >
                <Ionicons name="bookmark-outline" size={16} color={colors.ink} />
              </Pressable>
            )}
            {onShoppingPress && (
              <Pressable
                onPress={onShoppingPress}
                hitSlop={10}
                style={styles.shoppingBtn}
                accessibilityRole="button"
                accessibilityLabel={shoppingLabel}
              >
                <Ionicons name="cart-outline" size={18} color={colors.ink} />
                {hasShoppingCount && (
                  <View
                    testID="shopping-count-badge"
                    style={styles.shoppingBadge}
                    accessible={false}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                  >
                    <Text style={styles.shoppingBadgeText}>
                      {shoppingCount >= 100 ? '99+' : shoppingCount}
                    </Text>
                  </View>
                )}
              </Pressable>
            )}
            <Pressable
              onPress={pressBell}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={`Notifications, ${unreadCount} unread`}
            >
              <View>
                <Ionicons name="notifications-outline" size={22} color={colors.ink} />
                {unreadCount > 0 && <View style={styles.bellDot} />}
              </View>
            </Pressable>
          </View>

          <NotificationsDropdown
            visible={notifVisible}
            onClose={() => setNotifVisible(false)}
            topOffset={insets.top + spacing.sm + 40}
            navigation={navigation}
          />
        </>
      ) : (
        <>
          <Pressable
            onPress={onBack}
            hitSlop={10}
            style={styles.side}
            disabled={mode !== 'back' || !onBack}
            accessibilityRole={mode === 'back' ? 'button' : undefined}
            accessibilityLabel={mode === 'back' ? 'Back' : undefined}
          >
            {mode === 'back' && <Ionicons name="arrow-back" size={22} color={colors.ink} />}
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <Pressable
            onPress={onRightPress}
            hitSlop={10}
            style={styles.side}
            disabled={!rightIcon}
          >
            {rightIcon && <Ionicons name={rightIcon} size={20} color={colors.ink} />}
          </Pressable>
        </>
      )}
    </View>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    wrap: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.cream,
      paddingBottom: spacing.md,
      paddingHorizontal: spacing.lg,
      borderBottomWidth: 1,
      borderBottomColor: colors.hairline,
    },
    side: { width: 34, alignItems: 'center' },
    edgeSpacer: { width: 60 },
    bellCluster: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    savedBtn: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: colors.sagePale,
      alignItems: 'center',
      justifyContent: 'center',
    },
    shoppingBtn: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: colors.sagePale,
      alignItems: 'center',
      justifyContent: 'center',
    },
    shoppingBadge: {
      position: 'absolute',
      top: -7,
      right: -9,
      minWidth: 17,
      height: 17,
      paddingHorizontal: 4,
      borderRadius: 9,
      backgroundColor: colors.sageDeep,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1.5,
      borderColor: colors.cream,
    },
    shoppingBadgeText: {
      fontFamily: typography.body.semibold,
      fontSize: 9,
      lineHeight: 12,
      color: colors.onAccent,
    },
    brandRow: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
    brand: {
      fontFamily: typography.display.fontFamily,
      fontSize: 19,
      color: colors.ink,
    },
    bellDot: {
      position: 'absolute',
      top: -1,
      right: -2,
      width: 7,
      height: 7,
      borderRadius: 4,
      backgroundColor: colors.sageDeep,
      borderWidth: 1.5,
      borderColor: colors.cream,
    },
    title: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.lg,
      color: colors.ink,
      flex: 1,
      textAlign: 'center',
    },
  });
}
