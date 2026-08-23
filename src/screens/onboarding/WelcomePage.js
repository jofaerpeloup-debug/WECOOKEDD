import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS } from '../../theme/brandKit';

export default function WelcomePage() {
  return (
    <>
      <View style={styles.hero}>
        <View style={styles.logoMark}>
          <MaterialCommunityIcons name="chef-hat" size={54} color="#fff" />
          <Ionicons name="heart" size={15} color={COLORS.greenMid} style={styles.heartBadgeSmall} />
        </View>
        <Text style={styles.wordmark}>
          <Text style={{ color: COLORS.greenMid }}>We</Text>
          <Text style={{ color: '#fff' }}>Cooked</Text>
        </Text>
        <Text style={styles.tagline}>Inspire. Cook. Savor.</Text>
      </View>

      <View style={styles.welcomeBlock}>
        <Text style={styles.welcomeTitle}>
          Welcome to <Text style={{ color: COLORS.greenMid }}>WeCooked</Text>!
        </Text>
        <Text style={styles.welcomeSub}>
          One connected system for finding, learning, and saving every recipe you cook.
        </Text>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', marginTop: 8 },
  logoMark: { alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  heartBadgeSmall: { position: 'absolute', top: -2, right: 4 },
  wordmark: { fontSize: 30, fontWeight: '800', letterSpacing: 0.2 },
  tagline: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.75)',
    letterSpacing: 1.5,
    marginTop: 6,
    textTransform: 'uppercase',
  },
  welcomeBlock: { marginTop: 40, alignItems: 'flex-start' },
  welcomeTitle: { fontSize: 24, fontWeight: '800', color: '#fff', marginBottom: 8 },
  welcomeSub: { fontSize: 14, fontWeight: '500', color: 'rgba(255,255,255,0.7)', lineHeight: 20 },
});
