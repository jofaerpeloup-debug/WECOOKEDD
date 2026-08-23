import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import TopBar from '../components/TopBar';

const LINKS = [
  { id: 'terms', icon: 'document-text-outline', label: 'Terms of Service', route: 'Terms' },
  { id: 'privacy', icon: 'shield-outline', label: 'Privacy Policy', route: 'Privacy' },
  { id: 'licenses', icon: 'code-slash-outline', label: 'Open Source Licenses', route: 'Licenses' },
];

export default function AboutScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const version = '1.0.0';

  return (
    <View style={styles.root}>
      <TopBar mode="back" title="About" onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.brandSection}>
          <View style={styles.logoMark}>
            <Ionicons name="leaf" size={22} color={colors.onAccent} />
          </View>
          <Text style={styles.appName}>WeCooked</Text>
          <Text style={styles.version}>Version {version}</Text>
        </View>

        <View style={styles.card}>
          {LINKS.map((item, i) => (
            <Pressable
              key={item.id}
              style={[styles.row, i < LINKS.length - 1 && styles.rowBorder]}
              onPress={() => navigation.navigate(item.route)}
            >
              <View style={styles.iconWrap}>
                <Ionicons name={item.icon} size={17} color={colors.sageDeep} />
              </View>
              <Text style={styles.rowLabel}>{item.label}</Text>
              <Ionicons name="chevron-forward" size={17} color={colors.inkFaint} />
            </Pressable>
          ))}
        </View>

        <Text style={styles.credits}>Made with 💚 for home cooks.</Text>
      </ScrollView>
    </View>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
    brandSection: { alignItems: 'center', marginVertical: spacing.xxl, gap: 4 },
    logoMark: {
      width: 48,
      height: 48,
      borderRadius: 14,
      backgroundColor: colors.sageDeep,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.sm,
    },
    appName: {
      fontFamily: typography.display.fontFamily,
      fontSize: 22,
      color: colors.ink,
    },
    version: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.inkFaint,
    },
    card: {
      backgroundColor: colors.paper,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.hairline,
      overflow: 'hidden',
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
    rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.hairline },
    iconWrap: {
      width: 34,
      height: 34,
      borderRadius: 10,
      backgroundColor: colors.sagePale,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowLabel: {
      flex: 1,
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.base,
      color: colors.ink,
    },
    credits: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.inkFaint,
      textAlign: 'center',
      marginTop: spacing.xxl,
    },
  });
}
