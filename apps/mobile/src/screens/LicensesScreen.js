import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import TopBar from '../components/TopBar';
import { licenses } from '../data/licenses';

export default function LicensesScreen({ navigation }) {
  const { colors, isDark } = useTheme();
  const styles = makeStyles(colors, isDark);

  return (
    <View style={styles.root}>
      <TopBar mode="back" title="Open Source Licenses" onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.subtitle}>
          Direct third-party mobile packages in this build, with versions and declared licenses from the lockfile.
        </Text>

        <View style={styles.card}>
          {licenses.map((pkg, i) => (
            <View key={pkg.name} style={[styles.row, i < licenses.length - 1 && styles.rowBorder]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>{pkg.name}</Text>
                <Text style={styles.rowSub}>v{pkg.version}</Text>
              </View>
              <Text style={styles.license}>{pkg.license}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function makeStyles(colors, isDark) {
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
    card: {
      backgroundColor: colors.paper,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.hairline,
      overflow: 'hidden',
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
    rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.hairline },
    rowLabel: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.base,
      color: colors.ink,
    },
    rowSub: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.xs,
      color: colors.inkSoft,
      marginTop: 1,
    },
    license: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.xs,
      color: isDark ? colors.inkSoft : colors.sageDeep,
    },
  });
}
