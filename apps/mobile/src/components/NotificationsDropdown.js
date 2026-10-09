import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator, Animated, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import { useNotifications } from '../context/NotificationsContext';
import { actionDestination } from '../navigation/notificationAction';

const EMPTY_COPY = "You're all caught up. Real activity — saves, cooked dishes, cook reminders — will show up here.";
const MARK_READ_DELAY_MS = 250;

function relativeTime(value, now = Date.now()) {
  const elapsed = Math.max(0, now - new Date(value).getTime());
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d ago` : new Date(value).toLocaleDateString();
}

export default function NotificationsDropdown({ visible, onClose, topOffset, navigation }) {
  const { colors, shadow } = useTheme();
  const styles = makeStyles(colors, shadow);
  const {
    ownerId,
    generation,
    notifications,
    status,
    error,
    hasMore,
    refreshing,
    loadingMore,
    inboxPending,
    retry,
    reload,
    loadMore,
    markRead,
    markAllRead,
    archiveAll,
  } = useNotifications();
  const anim = useRef(new Animated.Value(0)).current;
  const ownershipRef = useRef({ ownerId, generation });
  ownershipRef.current = { ownerId, generation };

  useEffect(() => {
    Animated.timing(anim, {
      toValue: visible ? 1 : 0,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [anim, visible]);

  useEffect(() => {
    if (!visible || status !== 'ready' || notifications.length === 0) return undefined;
    const capturedOwner = ownerId;
    const capturedGeneration = generation;
    const anchorId = notifications[0].id;
    const timer = setTimeout(() => {
      const current = ownershipRef.current;
      if (capturedOwner === current.ownerId && capturedGeneration === current.generation) {
        void markAllRead(anchorId);
      }
    }, MARK_READ_DELAY_MS);
    return () => clearTimeout(timer);
  }, [visible, status, notifications[0]?.id, ownerId, generation, markAllRead]);

  const openSettings = () => {
    onClose();
    navigation.navigate('Notifications');
  };

  const clear = async () => {
    const anchorId = notifications[0]?.id;
    if (!anchorId) return;
    await archiveAll(anchorId);
  };

  const openAction = (notification) => {
    const destination = actionDestination(notification.action);
    if (!destination) return;
    if (!notification.readAt) void markRead(notification.id);
    onClose();
    navigation.navigate(...destination);
  };

  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] });
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close notifications" />
      <Animated.View style={[styles.panel, { top: topOffset, opacity: anim, transform: [{ scale }] }]}>
        <View style={styles.caret} />
        <View style={styles.header}>
          <Text style={styles.headerText} accessibilityRole="header">Notifications</Text>
          <View style={styles.actions}>
            <Pressable
              onPress={clear}
              disabled={inboxPending || notifications.length === 0}
              accessibilityRole="button"
              accessibilityLabel="Clear notifications"
              accessibilityState={{ disabled: inboxPending || notifications.length === 0, busy: inboxPending }}
              hitSlop={8}
            >
              <Text style={[styles.actionText, (inboxPending || notifications.length === 0) && styles.disabled]}>Clear</Text>
            </Pressable>
            <Pressable onPress={openSettings} accessibilityRole="button" accessibilityLabel="Notification settings" hitSlop={8}>
              <Text style={styles.actionText}>Settings</Text>
            </Pressable>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close notifications" hitSlop={8}>
              <Ionicons name="close" size={20} color={colors.ink} />
            </Pressable>
          </View>
        </View>

        {status === 'loading' ? (
          <View style={styles.state}><ActivityIndicator color={colors.sageDeep} accessibilityLabel="Loading notifications" /></View>
        ) : status === 'error' ? (
          <View style={styles.state}>
            <Text style={styles.stateText}>{error || 'Notifications are unavailable.'}</Text>
            <Pressable onPress={retry} accessibilityRole="button" accessibilityLabel="Retry notifications" style={styles.retry}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : notifications.length === 0 ? (
          <View style={styles.state}><Text style={styles.stateText}>{EMPTY_COPY}</Text></View>
        ) : (
          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            accessibilityLabel="Notifications list"
            refreshControl={(
              <RefreshControl
                refreshing={refreshing}
                onRefresh={reload}
                tintColor={colors.sageDeep}
                accessibilityLabel="Refresh notifications"
              />
            )}
          >
            {notifications.map((notification) => {
              const destination = actionDestination(notification.action);
              const row = (
                <View style={styles.row}>
                  <View style={styles.rowTop}>
                    <Text style={styles.title}>{notification.content.title}</Text>
                    {!notification.readAt ? <View style={styles.unreadDot} accessibilityLabel="Unread" /> : null}
                  </View>
                  <Text style={styles.body}>{notification.content.body}</Text>
                  <Text style={styles.time}>{relativeTime(notification.createdAt)}</Text>
                </View>
              );
              return destination ? (
                <Pressable
                  key={notification.id}
                  onPress={() => openAction(notification)}
                  accessibilityRole="button"
                  accessibilityLabel={`${notification.content.title}. ${notification.content.body}`}
                >
                  {row}
                </Pressable>
              ) : <View key={notification.id}>{row}</View>;
            })}
            {error ? <Text style={styles.inlineError}>{error}</Text> : null}
            {hasMore ? (
              <Pressable
                onPress={loadMore}
                disabled={loadingMore}
                accessibilityRole="button"
                accessibilityLabel="Load more notifications"
                accessibilityState={{ busy: loadingMore }}
                style={styles.more}
              >
                {loadingMore ? <ActivityIndicator color={colors.sageDeep} /> : <Text style={styles.retryText}>Load more</Text>}
              </Pressable>
            ) : null}
          </ScrollView>
        )}
      </Animated.View>
    </Modal>
  );
}

function makeStyles(colors, shadow) {
  return StyleSheet.create({
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.overlay },
    panel: {
      position: 'absolute', right: spacing.lg, width: 330, maxWidth: '90%', maxHeight: 480,
      backgroundColor: colors.paper, borderRadius: radius.lg, borderWidth: 1,
      borderColor: colors.hairline, overflow: 'hidden', ...shadow.card,
    },
    caret: {
      position: 'absolute', top: -6, right: 16, width: 12, height: 12,
      backgroundColor: colors.paper, borderTopWidth: 1, borderLeftWidth: 1,
      borderColor: colors.hairline, transform: [{ rotate: '45deg' }],
    },
    header: {
      minHeight: 52, paddingHorizontal: spacing.md, flexDirection: 'row',
      alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1,
      borderBottomColor: colors.hairline,
    },
    headerText: { fontFamily: typography.body.semibold, fontSize: typography.sizes.md, color: colors.ink },
    actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    actionText: { fontFamily: typography.body.medium, fontSize: typography.sizes.xs, color: colors.sageDeep },
    disabled: { opacity: 0.4 },
    state: { minHeight: 130, padding: spacing.lg, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
    stateText: { fontFamily: typography.body.fontFamily, fontSize: typography.sizes.sm, color: colors.inkFaint, textAlign: 'center', lineHeight: 20 },
    retry: { minHeight: 44, minWidth: 72, alignItems: 'center', justifyContent: 'center' },
    retryText: { fontFamily: typography.body.semibold, fontSize: typography.sizes.sm, color: colors.sageDeep },
    list: { maxHeight: 410 },
    listContent: { paddingBottom: spacing.sm },
    row: { minHeight: 88, padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.hairline },
    rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    title: { flex: 1, fontFamily: typography.body.semibold, fontSize: typography.sizes.sm, color: colors.ink },
    unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.sageDeep },
    body: { marginTop: 3, fontFamily: typography.body.fontFamily, fontSize: typography.sizes.xs, color: colors.inkSoft, lineHeight: 17 },
    time: { marginTop: spacing.xs, fontFamily: typography.body.fontFamily, fontSize: 11, color: colors.inkFaint },
    inlineError: { padding: spacing.sm, textAlign: 'center', color: colors.error, fontFamily: typography.body.fontFamily, fontSize: typography.sizes.xs },
    more: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  });
}

export { EMPTY_COPY, MARK_READ_DELAY_MS, actionDestination, relativeTime };
