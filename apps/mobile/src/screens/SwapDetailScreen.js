import React from 'react';
import { View, Text, StyleSheet, ScrollView, Image, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import Badge from '../components/Badge';
import Button from '../components/Button';
import { molecularSwap } from '../data/mockData';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function MetricRow({ label, value, note, noteTone }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <View style={styles.metricRow}>
      <Text style={styles.metricLabel}>{label}</Text>
      <View style={styles.metricValueRow}>
        <Text style={styles.metricValue}>{value}</Text>
        {note && <Badge label={note} tone={noteTone || 'neutral'} style={{ marginLeft: spacing.sm }} />}
      </View>
    </View>
  );
}

export default function SwapDetailScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const data = molecularSwap;
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backRow} hitSlop={10}>
          <Ionicons name="arrow-back" size={16} color={colors.sageDeep} />
          <Text style={styles.backText}>Return to Formula</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.pageTitle}>
          Molecular{'\n'}
          <Text style={styles.pageTitleItalic}>Precision.</Text>
        </Text>

        <View style={styles.matchPill}>
          <Ionicons name="analytics-outline" size={13} color={colors.sageDeep} />
          <Text style={styles.matchText}>SYSTEM MATCH: {data.systemMatch}</Text>
        </View>

        {/* Target */}
        <Text style={styles.blockLabel}>TARGET METRIC</Text>
        <Text style={styles.itemName}>{data.targetName}</Text>

        <View style={styles.imageCard}>
          <Image source={{ uri: data.targetImage }} style={styles.image} />
          <View style={styles.idBadge}>
            <Text style={styles.idBadgeText}>ID: {data.targetId}</Text>
          </View>
        </View>

        <View style={styles.dataCard}>
          <View style={styles.dataCardHeader}>
            <Text style={styles.dataCardTitle}>COOKING SCIENCE</Text>
            <Ionicons name="flask-outline" size={14} color={colors.inkFaint} />
          </View>
          <MetricRow label="pH Level" value={data.targetMetrics.pHLevel} />
          <MetricRow label="Moisture" value={data.targetMetrics.moisture} />
          <MetricRow label="Coagulation Temp" value={data.targetMetrics.coagulationTemp} />
          <MetricRow label="Function" value={data.targetMetrics.function} />
        </View>

        {/* Substitute */}
        <View style={styles.optimizedHeader}>
          <View style={styles.optimizedLeft}>
            <View style={styles.dotSage} />
            <Text style={styles.optimizedLabel}>OPTIMIZED SUBSTITUTE</Text>
          </View>
          <Text style={styles.confidenceText}>{data.substitute.confidence}</Text>
        </View>
        <Text style={styles.itemName}>{data.substitute.name}</Text>

        <View style={styles.imageCard}>
          <Image source={{ uri: data.substitute.image }} style={styles.image} />
        </View>

        <View style={styles.statsRow}>
          {data.substitute.stats.map((stat, i) => (
            <Badge key={i} label={stat.label} tone={stat.tone} style={styles.statBadge} />
          ))}
        </View>

        <View style={[styles.dataCard, styles.dataCardHighlight]}>
          <View style={styles.dataCardHeader}>
            <Text style={styles.dataCardTitle}>COOKING SCIENCE</Text>
            <Ionicons name="checkmark-circle" size={15} color={colors.sageDeep} />
          </View>
          <MetricRow
            label="pH Level"
            value={data.substitute.metrics.pHLevel.value}
            note={data.substitute.metrics.pHLevel.note}
            noteTone={data.substitute.metrics.pHLevel.noteTone}
          />
          <MetricRow
            label="Moisture"
            value={data.substitute.metrics.moisture.value}
            note={data.substitute.metrics.moisture.note}
            noteTone={data.substitute.metrics.moisture.noteTone}
          />
          <MetricRow
            label="Coagulation Temp"
            value={data.substitute.metrics.coagulationTemp.value}
          />
          <MetricRow label="Function" value={data.substitute.metrics.function.value} />
        </View>

        <Button
          title="Apply Substitute to Formula"
          variant="primary"
          onPress={() => navigation.goBack()}
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
      borderRadius: radius.lg,
      overflow: 'hidden',
      marginBottom: spacing.md,
      position: 'relative',
    },
    image: { width: '100%', height: 150, backgroundColor: colors.creamDeep },
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
    },
    metricLabel: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.inkSoft,
    },
    metricValueRow: { flexDirection: 'row', alignItems: 'center' },
    metricValue: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.sm,
      color: colors.ink,
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
    confidenceText: {
      fontFamily: typography.body.bold,
      fontSize: 10,
      color: colors.error,
    },
    statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
    statBadge: { paddingHorizontal: spacing.sm },
  });
}
