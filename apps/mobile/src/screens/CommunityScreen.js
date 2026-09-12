import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import TopBar from '../components/TopBar';

// The teammate-final Community shell stays visible while its backend is
// deferred. Composer state is transient and the feed contains no invented
// people, posts, likes, comments, images, or local persistence.
export default function CommunityScreen() {
  const { colors, shadow } = useTheme();
  const styles = makeStyles(colors, shadow);
  const [caption, setCaption] = useState('');

  const submitPost = () => {
    if (!caption.trim()) return;
    Alert.alert(
      'Community unavailable',
      'Posting is not connected yet. Your draft was not published or saved.'
    );
  };

  return (
    <View style={styles.root}>
      <TopBar mode="title" title="Community" />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.subtitle}>See what other home cooks are making.</Text>

        <View style={styles.composeCard}>
          <View style={styles.composeHeader}>
            <View style={styles.avatar}>
              <Ionicons name="person-outline" size={18} color={colors.sageDeep} />
            </View>
            <TextInput
              style={styles.composeInput}
              placeholder="Share what you're cooking..."
              placeholderTextColor={colors.inkFaint}
              value={caption}
              onChangeText={setCaption}
              multiline
            />
          </View>

          <Text style={styles.composeLabel}>Tag a recipe (optional)</Text>
          <View style={styles.recipeTagUnavailable}>
            <Ionicons name="restaurant-outline" size={15} color={colors.inkFaint} />
            <Text style={styles.recipeTagUnavailableText}>
              Recipe tagging will be available with Community.
            </Text>
          </View>

          <View style={styles.composeFooter}>
            <Text style={styles.composeTagText}>Draft stays on this screen only</Text>
            <Pressable
              style={[styles.postBtn, !caption.trim() && styles.postBtnDisabled]}
              onPress={submitPost}
              disabled={!caption.trim()}
            >
              <Text style={styles.postBtnText}>Post</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.emptyFeed}>
            <View style={styles.emptyIcon}>
              <Ionicons name="people-outline" size={24} color={colors.sageDeep} />
            </View>
            <Text style={styles.emptyTitle}>Community feed unavailable</Text>
            <Text style={styles.emptyText}>
              Live posts, likes, and comments aren&apos;t connected yet. No sample activity is
              shown.
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function makeStyles(colors, shadow) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
    subtitle: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.inkSoft,
      marginBottom: spacing.lg,
      lineHeight: 19,
    },
    composeCard: {
      backgroundColor: colors.paper,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.hairline,
      padding: spacing.md,
      marginBottom: spacing.xl,
      ...shadow.soft,
    },
    composeHeader: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
    avatar: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.sagePale,
      alignItems: 'center',
      justifyContent: 'center',
    },
    composeInput: {
      flex: 1,
      minHeight: 40,
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.ink,
      paddingTop: 8,
      outlineStyle: 'none',
    },
    composeLabel: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.xs,
      color: colors.inkFaint,
      marginBottom: spacing.sm,
    },
    recipeTagUnavailable: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      minHeight: 52,
      borderRadius: radius.md,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: colors.hairline,
      paddingHorizontal: spacing.md,
      marginBottom: spacing.sm,
    },
    recipeTagUnavailableText: {
      flex: 1,
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.xs,
      color: colors.inkFaint,
    },
    composeFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
      marginTop: spacing.xs,
    },
    composeTagText: {
      flex: 1,
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.xs,
      color: colors.inkFaint,
    },
    postBtn: {
      backgroundColor: colors.sageDeep,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.lg,
      paddingVertical: 8,
    },
    postBtnDisabled: { backgroundColor: colors.hairline },
    postBtnText: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.sm,
      color: colors.onAccent,
    },
    card: {
      backgroundColor: colors.paper,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.hairline,
      overflow: 'hidden',
      ...shadow.soft,
    },
    emptyFeed: {
      alignItems: 'center',
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.xxl,
      gap: spacing.sm,
    },
    emptyIcon: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: colors.sagePale,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.xs,
    },
    emptyTitle: {
      fontFamily: typography.display.fontFamily,
      fontSize: typography.sizes.md,
      color: colors.ink,
    },
    emptyText: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      lineHeight: 19,
      color: colors.inkSoft,
      textAlign: 'center',
    },
  });
}
