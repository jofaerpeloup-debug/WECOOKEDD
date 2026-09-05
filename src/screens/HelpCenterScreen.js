import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import TopBar from '../components/TopBar';
import Button from '../components/Button';
import { faqs } from '../data/mockData';
import { notify } from '../utils/alert';

export default function HelpCenterScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [openId, setOpenId] = useState(null);

  const contactSupport = () =>
    Linking.openURL('mailto:support@wecooked.app?subject=Help%20request').catch(() =>
      notify('Contact Support', 'Reach us at support@wecooked.app')
    );

  return (
    <View style={styles.root}>
      <TopBar mode="back" title="Help Center" onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Pressable
          style={styles.tourRow}
          onPress={() => navigation.navigate('Onboarding', { replay: true })}
        >
          <View style={styles.tourIcon}>
            <Ionicons name="sparkles-outline" size={18} color={colors.sageDeep} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.tourTitle}>Take the app tour</Text>
            <Text style={styles.tourSub}>A quick walkthrough of everything WeCooked can do.</Text>
          </View>
          <Ionicons name="chevron-forward" size={17} color={colors.inkFaint} />
        </Pressable>

        <Text style={styles.groupTitle}>FREQUENTLY ASKED QUESTIONS</Text>
        <View style={styles.card}>
          {faqs.map((item, i) => {
            const open = openId === item.id;
            return (
              <View key={item.id} style={i < faqs.length - 1 && styles.rowBorder}>
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
    tourRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      backgroundColor: colors.paper,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.hairline,
      padding: spacing.md,
      marginBottom: spacing.xl,
    },
    tourIcon: {
      width: 34,
      height: 34,
      borderRadius: 10,
      backgroundColor: colors.sagePale,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tourTitle: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.base,
      color: colors.ink,
    },
    tourSub: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.xs,
      color: colors.inkFaint,
      marginTop: 1,
      lineHeight: 15,
    },
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
