import React from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import Badge from '../components/Badge';
import Button from '../components/Button';

function MetricRow({ label, value }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <View style={styles.metricRow}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

// Preserves the teammate-final detail composition while rendering only fields
// that exist in the real substitution contract. Scientific metrics, match
// confidence, images, and apply-to-recipe persistence are explicitly absent.
export default function SwapDetailScreen({ navigation, route }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const insets = useSafeAreaInsets();
  const sourceIngredient = route?.params?.sourceIngredient || null;
  const substitution = route?.params?.substitution || null;
  const substitute = substitution?.substitute || null;
  const hasCatalogResult = !!sourceIngredient?.name && !!substitute?.name;

  const applySubstitute = () =>
    Alert.alert(
      'Recipe editing unavailable',
      'This catalog suggestion cannot be applied automatically yet. No recipe was changed.'
    );

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backRow} hitSlop={10}>
          <Ionicons name="arrow-back" size={16} color={colors.sageDeep} />
          <Text style={styles.backText}>Return to Swaps</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.pageTitle}>
          Molecular{'\n'}
          <Text style={styles.pageTitleItalic}>Precision.</Text>
        </Text>

        <View style={styles.matchPill}>
          <Ionicons
            name={hasCatalogResult ? 'server-outline' : 'information-circle-outline'}
            size={13}
            color={colors.sageDeep}
          />
          <Text style={styles.matchText}>
            {hasCatalogResult ? 'LIVE CATALOG RESULT' : 'RESULT UNAVAILABLE'}
          </Text>
        </View>

        <Text style={styles.blockLabel}>ORIGINAL INGREDIENT</Text>
        <Text style={styles.itemName}>{sourceIngredient?.name || 'No ingredient selected'}</Text>

        <View style={styles.imageCard}>
          <Ionicons name="leaf-outline" size={44} color={colors.sageDeep} />
          <View style={styles.idBadge}>
            <Text style={styles.idBadgeText}>
              {sourceIngredient?.id ? 'CATALOG INGREDIENT' : 'NO CATALOG DATA'}
            </Text>
          </View>
        </View>

        <View style={styles.dataCard}>
          <View style={styles.dataCardHeader}>
            <Text style={styles.dataCardTitle}>COOKING SCIENCE</Text>
            <Ionicons name="flask-outline" size={14} color={colors.inkFaint} />
          </View>
          <MetricRow label="pH Level" value="Not provided" />
          <MetricRow label="Moisture" value="Not provided" />
          <MetricRow label="Coagulation Temp" value="Not provided" />
          <MetricRow label="Function" value="Not provided" />
          <Text style={styles.disclosure}>
            The substitution API does not currently provide scientific measurements.
          </Text>
        </View>

        <View style={styles.optimizedHeader}>
          <View style={styles.optimizedLeft}>
            <View style={styles.dotSage} />
            <Text style={styles.optimizedLabel}>CATALOG SUBSTITUTE</Text>
          </View>
          <Text style={styles.guidanceOnly}>GUIDANCE ONLY</Text>
        </View>
        <Text style={styles.itemName}>{substitute?.name || 'No substitute selected'}</Text>

        <View style={styles.imageCard}>
          <Ionicons name="swap-horizontal" size={44} color={colors.sageDeep} />
        </View>

        {substitution?.contexts?.length ? (
          <View style={styles.statsRow}>
            {substitution.contexts.map((context) => (
              <Badge key={context} label={context} tone="sage" style={styles.statBadge} />
            ))}
          </View>
        ) : null}

        <View style={[styles.dataCard, styles.dataCardHighlight]}>
          <View style={styles.dataCardHeader}>
            <Text style={styles.dataCardTitle}>CATALOG GUIDANCE</Text>
            <Ionicons
              name={hasCatalogResult ? 'checkmark-circle' : 'information-circle-outline'}
              size={15}
              color={colors.sageDeep}
            />
          </View>
          <Text style={styles.notesText}>
            {substitution?.notes ||
              'No additional notes are available for this catalog substitution.'}
          </Text>
          <Text style={styles.disclosure}>
            No replacement ratio, confidence score, or automatic recipe conversion is assumed.
          </Text>
        </View>

        <Button
          title="Apply Substitute to Formula"
          variant="primary"
          onPress={applySubstitute}
          disabled={!hasCatalogResult}
          style={{ marginTop: spacing.lg }}
        />
      </ScrollView>
    </View>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    header: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.md,
    },
    backRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    backText: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.sm,
      color: colors.sageDeep,
    },
    scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
    pageTitle: {
      fontFamily: typography.display.fontFamily,
      fontSize: 34,
      lineHeight: 38,
      color: colors.ink,
      marginBottom: spacing.md,
    },
    pageTitleItalic: {
      fontFamily: typography.display.fontFamilyItalic,
    },
    matchPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      alignSelf: 'flex-start',
      backgroundColor: colors.sagePale,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.md,
      paddingVertical: 7,
      marginBottom: spacing.xxl,
    },
    matchText: {
      fontFamily: typography.body.semibold,
      fontSize: 10,
      color: colors.sageDeep,
      letterSpacing: 0.4,
    },
    blockLabel: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.xs,
      color: colors.inkFaint,
      letterSpacing: 1,
      marginBottom: spacing.xs,
    },
    itemName: {
      fontFamily: typography.display.fontFamily,
      fontSize: 21,
      color: colors.ink,
      marginBottom: spacing.md,
    },
    imageCard: {
      height: 150,
      borderRadius: radius.lg,
      overflow: 'hidden',
      marginBottom: spacing.md,
      position: 'relative',
      backgroundColor: colors.sagePale,
      alignItems: 'center',
      justifyContent: 'center',
    },
    idBadge: {
      position: 'absolute',
      top: spacing.sm,
      right: spacing.sm,
      backgroundColor: 'rgba(20,16,10,0.68)',
      borderRadius: radius.pill,
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
    },
    idBadgeText: { color: '#FFFFFF', fontFamily: typography.body.medium, fontSize: 10 },
    dataCard: {
      backgroundColor: colors.paper,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.hairline,
      padding: spacing.lg,
      marginBottom: spacing.xxl,
    },
    dataCardHighlight: {
      borderColor: colors.sage,
      marginBottom: 0,
    },
    dataCardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.md,
      paddingBottom: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.hairline,
    },
    dataCardTitle: {
      fontFamily: typography.body.semibold,
      fontSize: 10,
      color: colors.inkFaint,
      letterSpacing: 1,
    },
    metricRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 7,
      gap: spacing.md,
    },
    metricLabel: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.inkSoft,
    },
    metricValue: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.sm,
      color: colors.inkFaint,
    },
    disclosure: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.xs,
      lineHeight: 17,
      color: colors.inkFaint,
      marginTop: spacing.md,
    },
    optimizedHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.xs,
    },
    optimizedLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    dotSage: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.sageDeep },
    optimizedLabel: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.xs,
      color: colors.sageDeep,
      letterSpacing: 0.6,
    },
    guidanceOnly: {
      fontFamily: typography.body.bold,
      fontSize: 10,
      color: colors.inkFaint,
    },
    statsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
      marginBottom: spacing.md,
    },
    statBadge: { paddingHorizontal: spacing.sm },
    notesText: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      lineHeight: 19,
      color: colors.ink,
    },
  });
}
