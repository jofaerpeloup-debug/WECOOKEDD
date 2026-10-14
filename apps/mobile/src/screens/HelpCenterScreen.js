import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import TopBar from '../components/TopBar';

const FAQS = [
  {
    id: 'substitutions',
    q: 'How do ingredient substitutions work?',
    a: 'On Recipe Detail, tap Need a substitute? Find swaps below Nutrition. In Ingredient Studio, search the catalog and select an ingredient to see available substitutions. Suggestions are guidance only, not exact quantity conversions.',
  },
  {
    id: 'offline',
    q: 'Can I use WeCooked offline?',
    a: 'Synced recipes, favorites, substitutions, and shopping lists require a connection to the WeCooked service.',
  },
  {
    id: 'preferences',
    q: 'How do I change my dietary preferences?',
    a: 'Open Profile, choose Edit profile, then update Dietary Preferences or Allergies & Ingredients to Avoid and save your changes. These notes do not automatically filter recipes or guarantee allergy safety.',
  },
  {
    id: 'account',
    q: 'Where can I manage my account security?',
    a: 'Open Settings, then Security to change your password or email, link Google when available, resend verification, sign out of all devices, or deactivate your account. Two-factor authentication is not available yet.',
  },
];

export default function HelpCenterScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [openId, setOpenId] = useState(null);

  return (
    <View style={styles.root}>
      <TopBar mode="back" title="Help Center" onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Pressable
          style={styles.tourRow}
          onPress={() => navigation.navigate('Security')}
          accessibilityRole="button"
          accessibilityLabel="Account and security"
        >
          <View style={styles.tourIcon}>
            <Ionicons name="shield-checkmark-outline" size={18} color={colors.sageDeep} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.tourTitle}>Account and security</Text>
            <Text style={styles.tourSub}>Manage your sign-in and account access.</Text>
          </View>
          <Ionicons name="chevron-forward" size={17} color={colors.inkSoft} />
        </Pressable>
        <Text style={styles.groupTitle}>FREQUENTLY ASKED QUESTIONS</Text>
        <View style={styles.card}>
          {FAQS.map((item, i) => {
            const open = openId === item.id;
            return (
              <View key={item.id} style={i < FAQS.length - 1 && styles.rowBorder}>
                <Pressable
                  style={styles.faqRow}
                  onPress={() => setOpenId(open ? null : item.id)}
                  accessibilityRole="button"
                  accessibilityLabel={item.q}
                  accessibilityState={{ expanded: open }}
                >
                  <Text style={styles.faqQuestion}>{item.q}</Text>
                  <Ionicons
                    name={open ? 'chevron-up' : 'chevron-down'}
                    size={17}
                    color={colors.inkSoft}
                  />
                </Pressable>
                {open && <Text style={styles.faqAnswer}>{item.a}</Text>}
              </View>
            );
          })}
        </View>

        <Text style={styles.contactPrompt}>Still need help?</Text>
        <Text style={styles.contactStatus}>Support unavailable: direct contact is not configured in this app.</Text>
      </ScrollView>
    </View>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
    tourRow: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md,
      backgroundColor: colors.paper, borderRadius: radius.lg,
      borderWidth: 1, borderColor: colors.hairline,
      padding: spacing.md, marginBottom: spacing.xl,
    },
    tourIcon: {
      width: 34, height: 34, borderRadius: 10, backgroundColor: colors.sagePale,
      alignItems: 'center', justifyContent: 'center',
    },
    tourTitle: { fontFamily: typography.body.medium, fontSize: typography.sizes.base, color: colors.ink },
    tourSub: { fontFamily: typography.body.fontFamily, fontSize: typography.sizes.xs, color: colors.inkSoft, marginTop: 1, lineHeight: 16 },
    groupTitle: {
      fontFamily: typography.body.semibold,
      fontSize: 10,
      color: colors.inkSoft,
      letterSpacing: 1,
      marginBottom: spacing.sm,
    },
    card: {
      backgroundColor: colors.paper,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.hairline,
      overflow: 'hidden',
      marginBottom: spacing.xl,
    },
    rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.hairline },
    faqRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      padding: spacing.md,
    },
    faqQuestion: {
      flex: 1,
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.base,
      color: colors.ink,
    },
    faqAnswer: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.inkSoft,
      lineHeight: 19,
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.md,
    },
    contactPrompt: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.sm,
      color: colors.inkSoft,
      textAlign: 'center',
      marginBottom: spacing.md,
    },
    contactStatus: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.inkSoft,
      textAlign: 'center',
      lineHeight: 19,
    },
  });
}
