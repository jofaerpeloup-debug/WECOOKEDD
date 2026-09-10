import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { lightColors, darkColors, typography, spacing, radius } from '../../theme/theme';

// Shared presentation kit for the Landing carousel slides.
//
// Onboarding sits on full-bleed photography in BOTH appearance modes, so this
// layer is deliberately fixed light-on-dark rather than theme-reactive: the
// contrast has to come from the photo scrim, not from the OS setting. That is
// not a second palette — every value below is a Sage & Stone token from
// src/theme/theme.js, picked for the variant that reads on a dark photo (the
// light palette's cream for text, the night palette's saffron for the accent).
export const ONBOARD_C = {
  ink: lightColors.cream, // #FAF9F6 — headline / panel text
  inkDim: 'rgba(250,249,246,0.72)', // body copy
  inkFaint: 'rgba(250,249,246,0.55)', // meta
  accent: darkColors.stone, // #D9A64B — saffron, the one accent on photography
  ground: darkColors.cream, // #1E211D — ground behind a not-yet-loaded photo
  panel: 'rgba(30,33,29,0.92)', // `ground` at 92% — the floating feature panel
  panelLine: 'rgba(250,249,246,0.14)',
  fill: 'rgba(250,249,246,0.09)', // sketch surfaces inside the panel
  line: 'rgba(250,249,246,0.16)', // sketch bars inside the panel
  ctaBg: lightColors.cream,
  ctaInk: darkColors.cream, // dark ink on the cream pill
};

// The four-stop scrim every slide lays over its photo: dark at the top so the
// headline block reads, clear through the middle so the photo is actually
// visible, and near-solid at the bottom so the panel and footer sit on ground.
export const SLIDE_SCRIM = ['rgba(30,33,29,0.78)', 'rgba(30,33,29,0.18)', 'rgba(30,33,29,0.58)', 'rgba(30,33,29,0.97)'];
export const SLIDE_SCRIM_LOCATIONS = [0, 0.28, 0.5, 1];

/**
 * The top block of a slide: eyebrow, Playfair headline, accent rule, lead copy.
 */
export function SlideHeading({ eyebrow, title, lead }) {
  return (
    <View style={headingStyles.wrap}>
      <Text style={headingStyles.eyebrow}>{eyebrow}</Text>
      <Text style={headingStyles.headline} accessibilityRole="header">
        {title}
      </Text>
      <View style={headingStyles.rule} />
      <Text style={headingStyles.lead}>{lead}</Text>
    </View>
  );
}

export const headingStyles = StyleSheet.create({
  wrap: { alignItems: 'flex-start' },
  eyebrow: {
    fontFamily: typography.body.bold,
    fontSize: typography.sizes.sm,
    letterSpacing: 1.6,
    color: ONBOARD_C.inkDim,
  },
  headline: {
    fontFamily: typography.display.fontFamily,
    fontSize: 30,
    lineHeight: 36,
    color: ONBOARD_C.accent,
    marginTop: spacing.sm,
  },
  rule: {
    width: 44,
    height: 3,
    borderRadius: 2,
    backgroundColor: ONBOARD_C.accent,
    marginVertical: spacing.sm,
  },
  lead: {
    fontFamily: typography.body.fontFamily,
    fontSize: 13.5,
    lineHeight: 20,
    color: ONBOARD_C.inkDim,
  },
});

/**
 * The floating panel at the bottom of a slide — a sketch of the real screen
 * that part of the app opens onto.
 */
export function FeaturePanel({ caption, note, description, children }) {
  return (
    <View style={panelStyles.panel}>
      <View style={panelStyles.handle} />
      <View style={panelStyles.captionRow}>
        <Text style={panelStyles.caption}>{caption}</Text>
        {note ? <Text style={panelStyles.note}>{note}</Text> : null}
      </View>
      {description ? <Text style={panelStyles.description}>{description}</Text> : null}
      {children}
    </View>
  );
}

/**
 * Wraps the sketch-only parts of a panel. The bars, chips and thumbnails stand
 * in for a screen we are describing in words right above them, so spoken they
 * would be noise — this hides them from screen readers (and from touch, since
 * nothing in a preview is interactive).
 */
export function Decorative({ children, style }) {
  return (
    <View
      style={style}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
    >
      {children}
    </View>
  );
}

export const panelStyles = StyleSheet.create({
  panel: {
    backgroundColor: ONBOARD_C.panel,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: ONBOARD_C.panelLine,
    padding: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.md,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: ONBOARD_C.panelLine,
    marginBottom: spacing.xs,
  },
  captionRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  caption: {
    fontFamily: typography.display.fontFamily,
    fontSize: typography.sizes.md,
    color: ONBOARD_C.ink,
  },
  note: {
    fontFamily: typography.body.medium,
    fontSize: typography.sizes.xs,
    color: ONBOARD_C.accent,
  },
  description: {
    fontFamily: typography.body.fontFamily,
    fontSize: 12.5,
    lineHeight: 18,
    color: ONBOARD_C.inkDim,
    marginTop: -4,
  },
});

/** A placeholder text run inside a preview sketch. */
export function Bar({ width, height = 8, color = ONBOARD_C.line, style }) {
  return <View style={[{ width, height, borderRadius: height / 2, backgroundColor: color }, style]} />;
}

export const previewStyles = StyleSheet.create({
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: ONBOARD_C.fill,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 38,
  },
  filterDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: ONBOARD_C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  thumb: { width: 42, height: 42, borderRadius: 10, backgroundColor: ONBOARD_C.fill },
  title: { fontFamily: typography.body.semibold, fontSize: 12.5, color: ONBOARD_C.ink },
  meta: { fontFamily: typography.body.fontFamily, fontSize: 11, color: ONBOARD_C.inkFaint },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  chipRow: { flexDirection: 'row', gap: spacing.sm },
  chip: { width: 30, height: 20, borderRadius: 6, backgroundColor: ONBOARD_C.fill },
  chipOn: { backgroundColor: 'rgba(217,166,75,0.20)', borderWidth: 1, borderColor: ONBOARD_C.accent },

  stepRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stepIndex: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: ONBOARD_C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepIndexText: { fontFamily: typography.body.bold, fontSize: 10, color: ONBOARD_C.ctaInk },
  stepThumb: { width: 34, height: 34, borderRadius: 8, backgroundColor: ONBOARD_C.fill },

  heroImage: { width: '100%', height: 92, borderRadius: 14, backgroundColor: ONBOARD_C.fill },
  heartBadge: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(30,33,29,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  featureRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  featureDot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: ONBOARD_C.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureText: { fontFamily: typography.body.medium, fontSize: 12.5, color: ONBOARD_C.inkDim, flex: 1 },
});
