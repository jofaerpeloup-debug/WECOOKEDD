import React, { useEffect, useRef } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, Animated, Dimensions, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import { useNotifications } from '../context/NotificationsContext';

const WIDTH = Math.min(320, Dimensions.get('window').width * 0.86);

export default function NotificationsDropdown({ visible, onClose, topOffset }) {
  const { colors, shadow } = useTheme();
  const navigation = useNavigation();
  const styles = makeStyles(colors, shadow);
  const { feed, markAllRead } = useNotifications();
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, { toValue: visible ? 1 : 0, duration: 160, useNativeDriver: true }).start();
    if (visible) {
      const t = setTimeout(markAllRead, 400);
      return () => clearTimeout(t);
    }
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <Animated.View
        style={[
          styles.panel,
          {
            top: topOffset,
            opacity: anim,
            transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }],
          },
        ]}
      >
        <View style={styles.caret} />
        <View style={styles.headerRow}>
          <Text style={styles.header}>Notifications</Text>
          <Pressable
            hitSlop={8}
            onPress={() => {
              onClose();
              navigation.navigate('Notifications');
            }}
          >
            <Text style={styles.manage}>Settings</Text>
          </Pressable>
        </View>
        <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
          {feed.length === 0 ? (
            <Text style={styles.empty}>You're all caught up.</Text>
          ) : (
            feed.map((n, i) => (
              <View key={n.id} style={[styles.item, i < feed.length - 1 && styles.itemBorder]}>
                <View style={[styles.dot, !n.read && styles.dotUnread]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemTitle}>{n.title}</Text>
                  <Text style={styles.itemBody}>{n.body}</Text>
                  <Text style={styles.itemTime}>{n.time}</Text>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

function makeStyles(colors, shadow) {
  return StyleSheet.create({
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.overlay },
    panel: {
      position: 'absolute',
      right: spacing.xl,
      width: WIDTH,
      backgroundColor: colors.paper,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.hairline,
      paddingTop: spacing.md,
      paddingBottom: spacing.xs,
      ...shadow.card,
    },
    caret: {
      position: 'absolute',
      top: -6,
      right: 14,
      width: 12,
      height: 12,
      backgroundColor: colors.paper,
      borderTopWidth: 1,
      borderLeftWidth: 1,
      borderColor: colors.hairline,
      transform: [{ rotate: '45deg' }],
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.sm,
    },
    header: { fontFamily: typography.display.fontFamily, fontSize: typography.sizes.md, color: colors.ink },
    manage: { fontFamily: typography.body.semibold, fontSize: 12, color: colors.sageDeep },
    list: { maxHeight: 300 },
    empty: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.inkFaint,
      textAlign: 'center',
      paddingVertical: spacing.lg,
    },
    item: { flexDirection: 'row', gap: 10, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
    itemBorder: { borderTopWidth: 1, borderTopColor: colors.hairline },
    dot: { width: 7, height: 7, borderRadius: 4, marginTop: 5, backgroundColor: 'transparent' },
    dotUnread: { backgroundColor: colors.stone },
    itemTitle: { fontFamily: typography.body.semibold, fontSize: 13, color: colors.ink },
    itemBody: { fontFamily: typography.body.fontFamily, fontSize: 12, color: colors.inkSoft, marginTop: 2, lineHeight: 16 },
    itemTime: { fontFamily: typography.body.fontFamily, fontSize: 10.5, color: colors.inkFaint, marginTop: 3 },
  });
}
