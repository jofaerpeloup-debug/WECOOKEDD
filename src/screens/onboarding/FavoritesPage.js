import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../theme/brandKit';
import { recipes } from '../../data/mockData';
import { SectionHeading, previewStyles as p, pageTextStyles as pt } from './shared';

const hero = recipes[7];
const rows = recipes.slice(1, 4);

export default function FavoritesPage() {
  return (
    <>
      <SectionHeading line1="Step 3 — Save" line2="Synced, Wherever You Go" />
      <Text style={pt.sub}>
        Everything you love stays connected across the system — save once, access it anywhere, anytime.
      </Text>
      <View style={pt.previewWrap}>
        <View style={{ width: '100%' }}>
          <View style={styles.heroWrap}>
            <Image source={{ uri: hero.image }} style={styles.heroImage} />
            <View style={styles.heartBadge}>
              <Ionicons name="heart" size={16} color={COLORS.greenMid} />
            </View>
          </View>
          <View style={styles.listCard}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
              <Text style={p.label}>My Favorites</Text>
              <Text style={p.link}>See all</Text>
            </View>
            <Text style={styles.savedCount}>{recipes.length} recipes saved</Text>
            {rows.map((r) => (
              <View key={r.id} style={styles.row}>
                <Image source={{ uri: r.image }} style={styles.rowThumb} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {r.title}
                  </Text>
                  <Text style={styles.rowMeta}>{r.time}</Text>
                </View>
                <Ionicons name="heart" size={14} color={COLORS.greenMid} />
              </View>
            ))}
          </View>
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  savedCount: { fontSize: 10, fontWeight: '600', color: 'rgba(255,255,255,0.5)', marginBottom: 8 },
  heroWrap: {
    position: 'relative',
    marginBottom: 16,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 14,
    elevation: 6,
  },
  heroImage: { width: '100%', height: 160, borderRadius: 20 },
  heartBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderWidth: 1.5,
    borderColor: COLORS.greenMid,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listCard: {
    backgroundColor: 'rgba(18,18,18,0.85)',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 8,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7 },
  rowThumb: { width: 40, height: 40, borderRadius: 8 },
  rowTitle: { fontSize: 12.5, fontWeight: '700', color: '#fff' },
  rowMeta: { fontSize: 10.5, color: 'rgba(255,255,255,0.5)', marginTop: 2 },
});
