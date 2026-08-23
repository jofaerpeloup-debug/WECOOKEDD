import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { typography, spacing } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import TopBar from '../components/TopBar';

const SECTIONS = [
  {
    heading: 'Information We Collect',
    body: 'Account details you provide (name, email, password), dietary preferences and allergies you set in your profile, and the recipes, swaps, and shopping lists you save. Messages you send Chef AI are processed to generate responses.',
  },
  {
    heading: 'How We Use It',
    body: 'To run the core features of the app — showing your saved recipes, personalizing swap suggestions to your dietary profile, and syncing your shopping list. We don’t sell your personal information.',
  },
  {
    heading: 'Dietary & Allergy Data',
    body: 'Because allergy information affects the substitutions Chef AI suggests, we treat it as sensitive. It’s used only to tailor suggestions within the app and is never shared with third parties for advertising.',
  },
  {
    heading: 'Third-Party Services',
    body: 'Signing in with Google uses Google’s own sign-in flow — we receive only the basic profile info needed to create your account. See the open source licenses page for the libraries this app is built on.',
  },
  {
    heading: 'Data Retention',
    body: 'Your data is kept while your account is active. Deleting your account (Settings → Log Out, then contact support) removes your saved content within a reasonable time.',
  },
  {
    heading: 'Your Choices',
    body: 'You can edit or remove your dietary preferences anytime from Profile, control what notifications you receive from Settings → Notifications, and request account deletion via Help Center.',
  },
  {
    heading: 'Children’s Privacy',
    body: 'WeCooked is not directed at children under 13, and we don’t knowingly collect their information.',
  },
  {
    heading: 'Contact Us',
    body: 'Questions about this policy can be sent to support@wecooked.app.',
  },
];

export default function PrivacyScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  return (
    <View style={styles.root}>
      <TopBar mode="back" title="Privacy Policy" onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.updated}>Last updated: January 2026</Text>
        <Text style={styles.intro}>
          These are placeholder privacy terms for the WeCooked demo app. Replace this text with a
          policy reviewed by legal counsel — especially around allergy data — before shipping to
          real users.
        </Text>

        {SECTIONS.map((s) => (
          <View key={s.heading} style={styles.section}>
            <Text style={styles.heading}>{s.heading}</Text>
            <Text style={styles.body}>{s.body}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
    updated: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.xs,
      color: colors.inkFaint,
      marginBottom: spacing.sm,
    },
    intro: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.inkSoft,
      lineHeight: 19,
      marginBottom: spacing.xl,
      fontStyle: 'italic',
    },
    section: { marginBottom: spacing.lg },
    heading: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.base,
      color: colors.ink,
      marginBottom: spacing.xs,
    },
    body: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.inkSoft,
      lineHeight: 20,
    },
  });
}
