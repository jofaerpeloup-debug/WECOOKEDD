import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import TopBar from '../components/TopBar';
import Button from '../components/Button';

const FAQS = [
  {
    id: 'substitutions',
    q: 'How do ingredient substitutions work?',
    a: 'Open a recipe and tap Substitutes beside an ingredient. Suggestions come from the WeCooked catalog and are guidance only, not exact quantity conversions.',
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
    id: 'pending',
    q: 'Which features are still in development?',
    a: 'Assistant, Community, Meal Planning, Reviews, Collections, Cook History, notification feeds, and 2FA are not available yet.',
  },
];

export default function HelpCenterScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [openId, setOpenId] = useState(null);

  const contactSupport = () =>
    Alert.alert('Support unavailable', 'A support contact has not been configured for this demo yet.');

  return (
    <View style={styles.root}>
      <TopBar mode="back" title="Help Center" onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.groupTitle}>FREQUENTLY ASKED QUESTIONS</Text>
        <View style={styles.card}>
          {FAQS.map((item, i) => {
            const open = openId === item.id;
            return (
              <View key={item.id} style={i < FAQS.length - 1 && styles.rowBorder}>
                <Pressable
                  style={styles.faqRow}
                  onPress={() => setOpenId(open ? null : item.id)}
                >
                  <Text style={styles.faqQuestion}>{item.q}</Text>
                  <Ionicons
                    name={open ? 'chevron-up' : 'chevron-down'}
                    size={17}
                    color={colors.inkFaint}
                  />
                </Pressable>
                {open && <Text style={styles.faqAnswer}>{item.a}</Text>}
              </View>
            );
          })}
        </View>

        <Text style={styles.contactPrompt}>Still need help?</Text>
        <Button title="Contact Support" variant="outline" onPress={contactSupport} />
      </ScrollView>
    </View>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
    groupTitle: {
      fontFamily: typography.body.semibold,
      fontSize: 10,
      color: colors.inkFaint,
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
  });
}
