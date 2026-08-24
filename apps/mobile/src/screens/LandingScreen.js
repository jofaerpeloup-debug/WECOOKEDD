import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Image, Pressable, StyleSheet, ScrollView, Animated, Dimensions } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../theme/brandKit';
import WelcomePage from './onboarding/WelcomePage';
import DiscoverPage from './onboarding/DiscoverPage';
import StepsPage from './onboarding/StepsPage';
import FavoritesPage from './onboarding/FavoritesPage';

const LANDING_BG = require('../assets/landing/landing-bg.jpg');
const { width: SCREEN_W } = Dimensions.get('window');

const PAGES = [WelcomePage, DiscoverPage, StepsPage, FavoritesPage];
const PAGE_COUNT = PAGES.length;

function PageReveal({ active, children }) {
  const opacity = useRef(new Animated.Value(active ? 1 : 0)).current;
  const translateY = useRef(new Animated.Value(active ? 0 : 10)).current;

  useEffect(() => {
    if (!active) return;
    opacity.setValue(0);
    translateY.setValue(10);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 380, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 380, useNativeDriver: true }),
    ]).start();
  }, [active]);

  return <Animated.View style={{ opacity, transform: [{ translateY }] }}>{children}</Animated.View>;
}

export default function LandingScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const scrollRef = useRef(null);
  const [page, setPage] = useState(0);
  const [ctaHeight, setCtaHeight] = useState(0);

  const goLogin = () => navigation.navigate('Login');

  const goToPage = (i) => {
    const next = Math.max(0, Math.min(PAGE_COUNT - 1, i));
    scrollRef.current?.scrollTo({ x: next * SCREEN_W, animated: true });
    setPage(next);
  };

  const onScroll = (e) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
    setPage((prev) => (prev === idx ? prev : idx));
  };

  return (
    <View style={styles.root}>
      <Image
        source={LANDING_BG}
        style={[StyleSheet.absoluteFillObject, { width: '100%', height: '100%' }]}
        resizeMode="cover"
      />
      <View style={styles.scrim} pointerEvents="none" />

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        style={{ flex: 1 }}
      >
        {PAGES.map((Page, i) => (
          <View key={i} style={[styles.page, { paddingTop: insets.top + (i === 0 ? 24 : 40) }]}>
            <PageReveal active={page === i}>
              <Page />
            </PageReveal>
          </View>
        ))}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.dotsRow}>
          {Array.from({ length: PAGE_COUNT }).map((_, i) => (
            <Pressable
              key={i}
              onPress={() => goToPage(i)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Go to page ${i + 1} of ${PAGE_COUNT}`}
            >
              <View style={[styles.dot, i === page && styles.dotActive]} />
            </Pressable>
          ))}
        </View>

        <View
          style={ctaHeight ? { minHeight: ctaHeight } : null}
          onLayout={page === 0 ? (e) => setCtaHeight(e.nativeEvent.layout.height) : undefined}
        >
          {page === 0 && (
            <>
              <Pressable onPress={goLogin} style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}>
                <Text style={styles.ctaText}>Get Started</Text>
                <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                  <Path
                    d="M5 12h14M13 6l6 6-6 6"
                    stroke="#fff"
                    strokeWidth={2.4}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </Svg>
              </Pressable>
              <Pressable
                onPress={goLogin}
                style={({ pressed }) => [styles.secondaryCta, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.secondaryCtaText}>I already have an account</Text>
              </Pressable>
            </>
          )}

          {page === PAGE_COUNT - 1 && (
            <Pressable onPress={goLogin} style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}>
              <Text style={styles.ctaText}>Let's Cook!</Text>
              <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                <Path
                  d="M5 12h14M13 6l6 6-6 6"
                  stroke="#fff"
                  strokeWidth={2.4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.25)' },

  page: { width: SCREEN_W, paddingHorizontal: 28 },

  footer: { paddingHorizontal: 28, paddingTop: 10 },
  dotsRow: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginBottom: 18 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.35)' },
  dotActive: {
    width: 18,
    backgroundColor: COLORS.greenMid,
    shadowColor: COLORS.greenMid,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 4,
  },

  cta: {
    backgroundColor: COLORS.greenMid,
    borderRadius: 28,
    paddingVertical: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 12,
  },
  ctaPressed: { backgroundColor: COLORS.greenChef },
  ctaText: { color: '#fff', fontSize: 15.5, fontWeight: '800' },

  secondaryCta: {
    borderRadius: 28,
    paddingVertical: 15,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryCtaText: { color: '#fff', fontSize: 14.5, fontWeight: '700' },
});
