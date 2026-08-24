import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { typography, spacing } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import TopBar from '../components/TopBar';

const SECTIONS = [
  {
    heading: '1. Acceptance of Terms',
    body: 'By creating an account or using WeCooked, you agree to these Terms of Service. If you do not agree, please do not use the app.',
  },
  {
    heading: '2. What WeCooked Provides',
    body: 'WeCooked helps you discover recipes, find ingredient substitutions, and organize a shopping list. Chef AI’s suggestions — including substitution ratios and nutritional notes — are generated automatically and are not a substitute for professional dietary or medical advice, especially where allergies are involved.',
  },
  {
    heading: '3. Your Account',
    body: 'You’re responsible for keeping your login credentials secure and for all activity under your account. Let us know right away if you suspect unauthorized access.',
  },
  {
    heading: '4. Acceptable Use',
    body: 'Please don’t use WeCooked to submit false or harmful content, attempt to disrupt the service, or misuse Chef AI to generate content unrelated to cooking or in violation of applicable law.',
  },
  {
    heading: '5. Content You Submit',
    body: 'Recipes, notes, and shopping lists you create remain yours. By using the app you grant us a limited license to store and display that content back to you as part of the service.',
  },
  {
    heading: '6. Changes to the Service',
    body: 'We may update, suspend, or discontinue parts of WeCooked at any time. We’ll try to give notice of significant changes where practical.',
  },
  {
    heading: '7. Termination',
    body: 'You may stop using WeCooked and delete your account at any time from Settings. We may suspend accounts that violate these terms.',
  },
  {
    heading: '8. Disclaimer',
    body: 'WeCooked is provided “as is” without warranties of any kind. We do our best to keep substitution data accurate, but always use your own judgment — especially around allergens.',
  },
];

export default function TermsScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  return (
    <View style={styles.root}>
      <TopBar mode="back" title="Terms of Service" onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.updated}>Last updated: January 2026</Text>
        <Text style={styles.intro}>
          These are placeholder Terms of Service for the WeCooked demo app. Replace this text with
          terms reviewed by legal counsel before shipping to real users.
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
