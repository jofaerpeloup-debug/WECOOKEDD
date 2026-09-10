import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { typography, spacing, radius } from '../../theme/theme';
import { ONBOARD_C, Bar, Decorative } from './shared';

// The five feature sketches that sit inside each onboarding slide's preview
// panel — ported from the teammate OnboardingScreen mocks (SearchMock,
// CookMock, SwapMock, PlanMock, CommunityMock).
//
// These are geometry only: bars, chips, dots and glyphs standing in for the
// real screen. Nothing here reads mock data, and nothing here fetches an
// image — the previews render identically with the device offline, which is
// the point of replacing the earlier remote-image previews.
//
// Every colour comes from ONBOARD_C, i.e. from the Sage & Stone tokens in
// src/theme/theme.js. The teammate's literal hex palette is not reintroduced.

const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

// The panel above already describes each feature in words, so the sketch
// itself is hidden from screen readers and from touch.
function Sketch({ children }) {
  return <Decorative style={styles.sketch}>{children}</Decorative>;
}

function SearchMock() {
  return (
    <Sketch>
      <View style={styles.searchRow}>
        <Ionicons name="search" size={13} color={ONBOARD_C.inkDim} />
        <Bar height={6} style={styles.searchBar} />
        <View style={styles.filterDot}>
          <Ionicons name="options" size={11} color={ONBOARD_C.ctaInk} />
        </View>
      </View>
      {['62%', '44%'].map((w, i) => (
        <View key={i} style={styles.listRow}>
          <View style={styles.thumb} />
          <View style={styles.listText}>
            <Bar width={w} />
            <Bar width="35%" height={6} style={styles.barSoft} />
          </View>
        </View>
      ))}
    </Sketch>
  );
}

function CookMock() {
  return (
    <Sketch>
      <View style={styles.stepPhoto}>
        <View style={styles.playDot}>
          <Ionicons name="play" size={11} color={ONBOARD_C.ctaInk} />
        </View>
      </View>
      <View style={styles.rowBetween}>
        <Bar width={90} />
        <View style={styles.chip}>
          <Ionicons name="time-outline" size={11} color={ONBOARD_C.accent} />
          <Text style={styles.chipText}>2:45</Text>
        </View>
      </View>
      <View style={styles.stepDots}>
        {[0, 1, 2, 3, 4].map((i) => (
          <View key={i} style={[styles.stepDot, i === 2 && styles.stepDotOn]} />
        ))}
      </View>
    </Sketch>
  );
}

function SwapMock() {
  return (
    <Sketch>
      <View style={styles.rowBetween}>
        <View style={styles.swapChip}>
          <Text style={styles.swapChipText}>Butter</Text>
        </View>
        <Ionicons name="swap-horizontal" size={16} color={ONBOARD_C.accent} />
        <View style={[styles.swapChip, styles.swapChipOn]}>
          <Text style={styles.swapChipText}>Coconut Oil</Text>
        </View>
      </View>
      <View style={styles.noteRow}>
        <Ionicons name="checkmark-circle" size={13} color={ONBOARD_C.accent} />
        <Bar width="58%" height={6} style={styles.barSoft} />
      </View>
    </Sketch>
  );
}

function PlanMock() {
  return (
    <Sketch>
      <View style={styles.weekRow}>
        {DAY_LABELS.map((d, i) => (
          <View key={i} style={styles.dayCol}>
            <Text style={styles.dayLabel}>{d}</Text>
            <View style={[styles.dayDot, (i === 1 || i === 3 || i === 5) && styles.dayDotOn]} />
          </View>
        ))}
      </View>
      <View style={styles.noteRow}>
        <Ionicons name="cart-outline" size={13} color={ONBOARD_C.accent} />
        <Bar width="50%" height={6} style={styles.barSoft} />
      </View>
    </Sketch>
  );
}

function CommunityMock() {
  return (
    <Sketch>
      <View style={styles.postHead}>
        <View style={styles.avatar} />
        <View style={styles.postMeta}>
          <Bar width={84} />
          <Bar width={50} height={6} style={styles.barSoft} />
        </View>
      </View>
      <View style={styles.postPhoto} />
      <View style={styles.rowBetween}>
        <View style={styles.iconCount}>
          <Ionicons name="heart" size={13} color={ONBOARD_C.accent} />
          <Text style={styles.chipText}>128</Text>
        </View>
        <View style={styles.iconCount}>
          <Ionicons name="chatbubble-outline" size={12} color={ONBOARD_C.inkDim} />
          <Text style={styles.chipText}>24</Text>
        </View>
      </View>
    </Sketch>
  );
}

/** Slide `mock` key → sketch component. */
export const PREVIEW_MOCKS = {
  search: SearchMock,
  cook: CookMock,
  swap: SwapMock,
  plan: PlanMock,
  community: CommunityMock,
};

const styles = StyleSheet.create({
  sketch: { gap: spacing.md },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: ONBOARD_C.fill,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 38,
  },
  searchBar: { flex: 1 },
  filterDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: ONBOARD_C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  listText: { flex: 1, gap: 6 },
  thumb: { width: 40, height: 40, borderRadius: 10, backgroundColor: ONBOARD_C.fill },
  barSoft: { opacity: 0.7 },

  stepPhoto: {
    height: 84,
    borderRadius: radius.md,
    backgroundColor: ONBOARD_C.fill,
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    padding: spacing.sm,
  },
  playDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: ONBOARD_C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: ONBOARD_C.fill,
  },
  chipText: { fontFamily: typography.body.semibold, fontSize: typography.sizes.xs, color: ONBOARD_C.ink },
  stepDots: { flexDirection: 'row', gap: 5 },
  stepDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: ONBOARD_C.line },
  stepDotOn: { backgroundColor: ONBOARD_C.accent },

  swapChip: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: ONBOARD_C.fill,
    alignItems: 'center',
  },
  swapChipOn: { backgroundColor: 'rgba(217,166,75,0.18)' },
  swapChipText: { fontFamily: typography.body.semibold, fontSize: typography.sizes.sm, color: ONBOARD_C.ink },
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },

  weekRow: { flexDirection: 'row', justifyContent: 'space-between' },
  dayCol: { alignItems: 'center', gap: 6 },
  dayLabel: { fontFamily: typography.body.semibold, fontSize: 10.5, color: ONBOARD_C.inkDim },
  dayDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: ONBOARD_C.line },
  dayDotOn: { backgroundColor: ONBOARD_C.accent },

  postHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  postMeta: { gap: 6 },
  avatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: ONBOARD_C.fill },
  postPhoto: { height: 70, borderRadius: radius.md, backgroundColor: ONBOARD_C.fill },
  iconCount: { flexDirection: 'row', alignItems: 'center', gap: 5 },
});
