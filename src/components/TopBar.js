import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, Animated, Dimensions } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { typography, spacing } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../context/AuthContext';

const PANEL_WIDTH = Math.min(300, Dimensions.get('window').width * 0.8);

const MENU_ITEMS = [{ label: 'Settings', icon: 'settings-outline', route: 'Settings' }];

function Wordmark({ style }) {
  const { colors } = useTheme();
  return (
    <Text style={style}>
      <Text style={{ color: colors.sageDeep }}>We</Text>
      <Text style={{ color: colors.ink }}>Cooked</Text>
    </Text>
  );
}

function MenuDrawer({ visible, onClose }) {
  const { colors, shadow } = useTheme();
  const styles = makeDrawerStyles(colors, shadow);
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const slide = useRef(new Animated.Value(0)).current;
  const { logout } = useAuth();

  useEffect(() => {
    Animated.timing(slide, {
      toValue: visible ? 1 : 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [visible]);

  const translateX = slide.interpolate({ inputRange: [0, 1], outputRange: [-PANEL_WIDTH, 0] });

  const go = (route) => {
    onClose();
    navigation.navigate(route);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <Animated.View
        style={[
          styles.panel,
          { width: PANEL_WIDTH, paddingTop: insets.top + spacing.lg, transform: [{ translateX }] },
        ]}
      >
        <View style={styles.panelHeader}>
          <View style={styles.logoMark}>
            <MaterialCommunityIcons name="chef-hat" size={14} color={colors.onAccent} />
          </View>
          <Wordmark style={styles.brand} />
        </View>

        {MENU_ITEMS.map((item) => (
          <Pressable
            key={item.route}
            style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
            onPress={() => go(item.route)}
          >
            <Ionicons name={item.icon} size={19} color={colors.inkSoft} />
            <Text style={styles.menuLabel}>{item.label}</Text>
          </Pressable>
        ))}

        <View style={styles.divider} />

        <Pressable
          style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
          onPress={async () => {
            onClose();
            await logout();
            navigation.reset({ index: 0, routes: [{ name: 'Landing' }] });
          }}
        >
          <Ionicons name="log-out-outline" size={19} color={colors.error} />
          <Text style={[styles.menuLabel, { color: colors.error }]}>Log out</Text>
        </Pressable>
      </Animated.View>
    </Modal>
  );
}

/**
 * mode: 'brand' (menu · wordmark · notification bell) | 'back' (back arrow · title · action)
 */
export default function TopBar({
  mode = 'brand',
  title,
  onBack,
  onMenuPress,
  onBellPress,
  rightIcon,
  onRightPress,
  showBellDot = true,
  transparent = false,
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const insets = useSafeAreaInsets();
  const [menuVisible, setMenuVisible] = useState(false);
  const navigation = useNavigation();

  const openMenu = () => {
    setMenuVisible(true);
    onMenuPress?.();
  };

  const pressBell = () => {
    if (onBellPress) onBellPress();
    else navigation.navigate('Notifications');
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
          <Pressable onPress={openMenu} hitSlop={10} style={styles.side}>
            <Ionicons name="menu-outline" size={24} color={colors.ink} />
          </Pressable>
          <View style={styles.brandRow}>
            <Wordmark style={styles.brand} />
          </View>
          <Pressable onPress={pressBell} hitSlop={10} style={styles.side}>
            <View>
              <Ionicons name="notifications-outline" size={22} color={colors.ink} />
              {showBellDot && <View style={styles.bellDot} />}
            </View>
          </Pressable>

          <MenuDrawer visible={menuVisible} onClose={() => setMenuVisible(false)} />
        </>
      ) : (
        <>
          <Pressable onPress={onBack} hitSlop={10} style={styles.side}>
            <Ionicons name="arrow-back" size={22} color={colors.ink} />
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
    brandRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
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

function makeDrawerStyles(colors, shadow) {
  return StyleSheet.create({
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.overlay },
    panel: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      backgroundColor: colors.cream,
      paddingHorizontal: spacing.lg,
      ...shadow.card,
    },
    panelHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginBottom: spacing.xl,
    },
    logoMark: {
      width: 20,
      height: 20,
      borderRadius: 6,
      backgroundColor: colors.sageDeep,
      alignItems: 'center',
      justifyContent: 'center',
    },
    brand: {
      fontFamily: typography.display.fontFamily,
      fontSize: 17,
      color: colors.ink,
    },
    menuItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing.md,
    },
    menuItemPressed: { opacity: 0.6 },
    menuLabel: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.md,
      color: colors.ink,
    },
    divider: {
      height: 1,
      backgroundColor: colors.hairline,
      marginVertical: spacing.md,
    },
  });
}
