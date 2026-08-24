import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS } from '../../theme/brandKit';

export function SectionHeading({ line1, line2 }) {
  return (
    <View style={{ alignItems: 'flex-start', marginBottom: 22 }}>
      <Text style={headingStyles.line}>{line1}</Text>
      <Text style={[headingStyles.line, headingStyles.accent]}>{line2}</Text>
      <View style={headingStyles.underline} />
    </View>
  );
}

export const headingStyles = StyleSheet.create({
  line: { fontSize: 26, fontWeight: '800', color: '#fff', lineHeight: 31 },
  accent: { color: COLORS.greenMid },
  underline: { width: 34, height: 3, borderRadius: 2, backgroundColor: COLORS.greenMid, marginTop: 8 },
});

export function MiniFrame({ children }) {
  return (
    <View style={frameStyles.frame}>
      <View style={frameStyles.notch} />
      <View style={frameStyles.body}>{children}</View>
    </View>
  );
}

export const frameStyles = StyleSheet.create({
  frame: {
    width: '100%',
    backgroundColor: 'rgba(18,18,18,0.9)',
    borderRadius: 26,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingTop: 18,
    paddingBottom: 16,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 8,
  },
  notch: {
    position: 'absolute',
    top: 8,
    alignSelf: 'center',
    width: 46,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  body: { gap: 10 },
});

export function Bar({ width, height = 8, color = 'rgba(255,255,255,0.16)', style }) {
  return <View style={[{ width, height, borderRadius: height / 2, backgroundColor: color }, style]} />;
}

export const previewStyles = StyleSheet.create({
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 30,
  },
  filterDot: {
    marginLeft: 'auto',
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: COLORS.greenMid,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: 12, fontWeight: '700', color: '#fff' },
  link: { fontSize: 10, fontWeight: '600', color: COLORS.greenMid },
  card: { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, padding: 8, gap: 6 },
  cardRow: { flexDirection: 'row', gap: 10 },
  cardHalf: { flex: 1, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, padding: 8, gap: 6 },
  cardImageWrap: { position: 'relative' },
  cardImage: { width: '100%', height: 74, borderRadius: 8 },
  cardImageSmall: { width: '100%', height: 56, borderRadius: 8 },
  heartDot: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { fontSize: 10.5, fontWeight: '700', color: '#fff' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 9, fontWeight: '600', color: 'rgba(255,255,255,0.5)' },
  chipRow: { flexDirection: 'row', gap: 6 },
  chip: { width: 26, height: 20, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.06)' },
  chipActive: { backgroundColor: 'rgba(245,130,31,0.18)', borderWidth: 1, borderColor: COLORS.greenMid },
  tabsRow: { flexDirection: 'row', gap: 16, alignItems: 'center' },
  tabUnderline: { width: 24, height: 2, borderRadius: 1, backgroundColor: COLORS.greenMid, marginTop: 3 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepIndex: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: COLORS.greenMid,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepIndexText: { fontSize: 9, fontWeight: '800', color: '#fff' },
  stepThumb: { width: 30, height: 30, borderRadius: 6 },
  postCard: { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, padding: 8, gap: 6 },
  postHeader: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  postAvatar: { width: 24, height: 24, borderRadius: 12 },
  postImage: { width: '100%', height: 60, borderRadius: 8 },
  postActions: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  postCount: { fontSize: 9, fontWeight: '600', color: 'rgba(255,255,255,0.5)' },
  postName: { fontSize: 10.5, fontWeight: '700', color: '#fff' },
  postTime: { fontSize: 8.5, fontWeight: '500', color: 'rgba(255,255,255,0.4)' },
});

export const pageTextStyles = StyleSheet.create({
  sub: {
    fontSize: 14,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.7)',
    lineHeight: 20,
    marginBottom: 28,
  },
  previewWrap: { alignItems: 'center' },
});
