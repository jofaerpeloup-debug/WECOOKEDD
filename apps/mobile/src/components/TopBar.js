import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, Animated, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';

const DROPDOWN_WIDTH = Math.min(280, Dimensions.get('window').width * 0.78);

function Wordmark({ style }) {
  const { colors } = useTheme();
  return (
    <Text style={style}>
      <Text style={{ color: colors.sageDeep }}>We</Text>
      <Text style={{ color: colors.ink }}>Cooked</Text>
    </Text>
  );
}

function NotificationDropdown({ visible, onClose, topOffset }) {
  const { colors, shadow } = useTheme();
  const styles = makeDropdownStyles(colors, shadow);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: visible ? 1 : 0,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [visible]);

  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] });
  const opacity = anim;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <Animated.View
        style={[
          styles.panel,
          { top: topOffset, opacity, transform: [{ scale }] },
        ]}
      >
        <View style={styles.caret} />
        <View style={styles.header}>
          <Text style={styles.headerText}>Notifications</Text>
        </View>
        <View style={styles.emptyRow}>
          <Text style={styles.emptyText}>The notifications feed isn&apos;t available yet.</Text>
        </View>
      </Animated.View>
    </Modal>
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
 */
export default function TopBar({
  mode = 'brand',
  title,
  onBack,
  onBellPress,
  onSavedPress,
  rightIcon,
  onRightPress,
  showBellDot = false,
  transparent = false,
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const insets = useSafeAreaInsets();
  const [notifVisible, setNotifVisible] = useState(false);

  const pressBell = () => {
    if (onBellPress) onBellPress();
    else setNotifVisible(true);
  };

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
            <Pressable
              onPress={pressBell}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Notifications"
            >
              <View>
                <Ionicons name="notifications-outline" size={22} color={colors.ink} />
                {showBellDot && <View style={styles.bellDot} />}
              </View>
            </Pressable>
          </View>

          <NotificationDropdown
            visible={notifVisible}
            onClose={() => setNotifVisible(false)}
            topOffset={insets.top + spacing.sm + 40}
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

function makeDropdownStyles(colors, shadow) {
  return StyleSheet.create({
    backdrop: { ...StyleSheet.absoluteFill, backgroundColor: colors.overlay },
    panel: {
      position: 'absolute',
      right: spacing.lg,
      width: DROPDOWN_WIDTH,
      backgroundColor: colors.paper,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.hairline,
      overflow: 'hidden',
      ...shadow.card,
    },
    caret: {
      position: 'absolute',
      top: -6,
      right: 16,
      width: 12,
      height: 12,
      backgroundColor: colors.paper,
      borderTopWidth: 1,
      borderLeftWidth: 1,
      borderColor: colors.hairline,
      transform: [{ rotate: '45deg' }],
    },
    header: {
      paddingHorizontal: spacing.md,
      paddingTop: spacing.md,
      paddingBottom: spacing.sm,
    },
    headerText: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.md,
      color: colors.ink,
    },
    emptyRow: {
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.md,
    },
    emptyText: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.inkFaint,
    },
  });
}
