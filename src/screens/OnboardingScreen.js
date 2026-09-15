import React, { useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Image, Animated, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { typography, spacing, radius } from '../theme/theme';
import { useAuth } from '../context/AuthContext';
import { tapLight, tapMedium } from '../utils/haptics';

// Swipeable carousel. Each slide: a full-bleed food photo, a headline block over
// the scrim, and a floating "preview card" that sketches what that part of the
// app actually looks like — built from WeCooked's own UI, not a screenshot.
const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const SLIDES = [
  {
    image: require('../../assets/recipe-chicken-adobo.jpg'),
    tag: 'Discover',
    title: 'One search,\nevery recipe',
    desc: 'Filters for time, difficulty and diet — tuned to your taste.',
    mock: 'search',
    caption: 'Popular Recipes',
    note: '247 recipes',
  },
  {
    image: require('../../assets/recipe-sisig.jpg'),
    tag: 'Cook Mode',
    title: 'Cook it\nhands-free',
    desc: 'Full-screen guided steps, with a timer built into each one.',
    mock: 'cook',
    caption: 'Chicken Adobo',
    note: 'Step 3 of 7',
  },
  {
    image: require('../../assets/recipe-ginataang-gulay.jpg'),
    tag: 'Ingredient Swaps',
    title: 'Out of something?\nSwap it',
    desc: 'A substitute in the right ratio, with a quick tasting note.',
    mock: 'swap',
    caption: 'Find a swap',
    note: '1 : 1 ratio',
  },
  {
    image: require('../../assets/recipe-kare-kare.jpg'),
    tag: 'Meal Plan',
    title: 'Plan the week,\nshop once',
    desc: 'Add recipes to your week and the grocery list builds itself.',
    mock: 'plan',
    caption: 'This Week',
    note: '3 meals planned',
  },
  {
    image: require('../../assets/recipe-turon.jpg'),
    tag: 'Community',
    title: 'Cook with\neveryone',
    desc: 'Share what you make, get inspired, and ask the Chef anytime.',
    mock: 'community',
    caption: 'Latest Post',
    note: '2h ago',
  },
];

const TOTAL = SLIDES.length;

// Fixed light-on-dark palette — this screen lives on a photo.
const C = {
  ink: '#FAF9F6',
  bodyDim: 'rgba(250,249,246,0.72)',
  faint: 'rgba(250,249,246,0.5)',
  skip: 'rgba(250,249,246,0.82)',
  accent: '#D9A64B',
  dark: '#15180F',
  seg: 'rgba(250,249,246,0.28)',
  btn: '#FAF9F6',
  btnInk: '#26332B',
  panel: 'rgba(18,21,14,0.94)',
  panelLine: 'rgba(250,249,246,0.14)',
  mockFill: 'rgba(250,249,246,0.08)',
  mockLine: 'rgba(250,249,246,0.16)',
  mockText: 'rgba(250,249,246,0.9)',
};

// --- mini feature "mockups" shown inside the preview card ------------------

function SearchMock() {
  return (
    <>
      <View style={mockStyles.searchRow}>
        <Ionicons name="search" size={13} color={C.faint} />
        <Text style={mockStyles.searchText}>Chicken Adobo</Text>
        <View style={mockStyles.filterDot}>
          <Ionicons name="options" size={11} color={C.btnInk} />
        </View>
      </View>
      <View style={mockStyles.chipRow}>
        <View style={mockStyles.chip}>
          <Text style={mockStyles.chipText}>Under 30 min</Text>
        </View>
        <View style={mockStyles.chip}>
          <Text style={mockStyles.chipText}>Easy</Text>
        </View>
      </View>
      {[
        { name: 'Pork Sinigang', meta: '45 min · Easy' },
        { name: 'Pancit Canton', meta: '25 min · Easy' },
      ].map((r) => (
        <View key={r.name} style={mockStyles.listRow}>
          <View style={mockStyles.thumb} />
          <View style={{ flex: 1, gap: 5 }}>
            <Text style={mockStyles.rowTitle}>{r.name}</Text>
            <Text style={mockStyles.rowMeta}>{r.meta}</Text>
          </View>
        </View>
      ))}
    </>
  );
}

function CookMock() {
  return (
    <>
      <View style={mockStyles.stepPhoto}>
        <View style={mockStyles.playDot}>
          <Ionicons name="play" size={11} color={C.btnInk} />
        </View>
      </View>
      <View style={mockStyles.rowBetween}>
        <Text style={mockStyles.rowTitle}>Simmer the sauce</Text>
        <View style={mockStyles.timerChip}>
          <Ionicons name="time-outline" size={11} color={C.accent} />
          <Text style={mockStyles.timerText}>2:45</Text>
        </View>
      </View>
      <View style={mockStyles.dotsRow}>
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <View key={i} style={[mockStyles.stepDot, i < 2 && mockStyles.stepDotDone, i === 2 && mockStyles.stepDotOn]} />
        ))}
      </View>
    </>
  );
}

function SwapMock() {
  return (
    <>
      <View style={mockStyles.swapRow}>
        <View style={mockStyles.swapChip}>
          <Text style={mockStyles.swapChipText}>Butter</Text>
        </View>
        <Ionicons name="swap-horizontal" size={16} color={C.accent} />
        <View style={[mockStyles.swapChip, mockStyles.swapChipOn]}>
          <Text style={mockStyles.swapChipText}>Coconut oil</Text>
        </View>
      </View>
      <Text style={mockStyles.ratioText}>1 tbsp → 1 tbsp</Text>
      <View style={mockStyles.noteRow}>
        <Ionicons name="checkmark-circle" size={13} color={C.accent} />
        <Text style={mockStyles.noteText}>Adds a light coconut note</Text>
      </View>
    </>
  );
}

function PlanMock() {
  const planned = new Set([1, 3, 5]);
  return (
    <>
      <View style={mockStyles.weekRow}>
        {DAY_LABELS.map((d, i) => (
          <View key={i} style={mockStyles.dayCol}>
            <Text style={mockStyles.dayLabel}>{d}</Text>
            <View style={[mockStyles.dayDot, planned.has(i) && mockStyles.dayDotOn]} />
          </View>
        ))}
      </View>
      <View style={mockStyles.mealChip}>
        <View style={mockStyles.mealThumb} />
        <Text style={mockStyles.rowTitle}>Kare-Kare</Text>
        <Text style={mockStyles.rowMeta}>Wed</Text>
      </View>
      <View style={mockStyles.noteRow}>
        <Ionicons name="cart-outline" size={13} color={C.accent} />
        <Text style={mockStyles.noteText}>18 items on your list</Text>
      </View>
    </>
  );
}

function CommunityMock() {
  return (
    <>
      <View style={mockStyles.postHead}>
        <View style={mockStyles.avatar} />
        <View style={{ gap: 3 }}>
          <Text style={mockStyles.rowTitle}>Maria Santos</Text>
          <Text style={mockStyles.rowMeta}>2 hours ago</Text>
        </View>
      </View>
      <View style={mockStyles.postPhoto} />
      <Text style={mockStyles.noteText}>First try at sisig — nailed it.</Text>
      <View style={mockStyles.rowBetween}>
        <View style={mockStyles.iconCount}>
          <Ionicons name="heart" size={13} color={C.accent} />
          <Text style={mockStyles.timerText}>128</Text>
        </View>
        <View style={mockStyles.iconCount}>
          <Ionicons name="chatbubble-outline" size={12} color={C.faint} />
          <Text style={mockStyles.timerText}>24</Text>
        </View>
      </View>
    </>
  );
}

const MOCKS = { search: SearchMock, cook: CookMock, swap: SwapMock, plan: PlanMock, community: CommunityMock };

export default function OnboardingScreen({ navigation, route }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { isLoggedIn, markOnboardingSeen } = useAuth();

  const scrollRef = useRef(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  const [step, setStep] = useState(0);
  const stepRef = useRef(0);

  const replay = route?.params?.replay;

  const leave = (dest) => {
    if (replay) {
      navigation.goBack();
      return;
    }
    markOnboardingSeen();
    navigation.replace(dest);
  };
  const finish = () => leave(isLoggedIn ? 'MainTabs' : 'Login');

  const goTo = (i) => {
    const t = Math.max(0, Math.min(TOTAL - 1, i));
    scrollRef.current?.scrollTo({ x: t * width, animated: true });
  };
  const next = () => {
    tapLight();
    goTo(stepRef.current + 1);
  };

  const onScroll = useMemo(
    () =>
      Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
        useNativeDriver: true,
        listener: (e) => {
          const s = Math.round(e.nativeEvent.contentOffset.x / width);
          if (s !== stepRef.current) {
            stepRef.current = s;
            setStep(s);
            tapLight();
          }
        },
      }),
    [width, scrollX]
  );

  return (
    <View style={styles.root}>
      <Animated.ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        bounces={false}
        overScrollMode="never"
        decelerationRate="fast"
        directionalLockEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={onScroll}
      >
        {SLIDES.map((s, i) => {
          const isLast = i === TOTAL - 1;
          const inputRange = [(i - 1) * width, i * width, (i + 1) * width];
          const anim = {
            opacity: scrollX.interpolate({ inputRange, outputRange: [0, 1, 0], extrapolate: 'clamp' }),
            transform: [
              {
                translateY: scrollX.interpolate({
                  inputRange,
                  outputRange: [14, 0, 14],
                  extrapolate: 'clamp',
                }),
              },
            ],
          };

          // The ScrollView mounts every page up front (it isn't virtualized), so
          // this keeps only the visible photo + its neighbours loaded.
          const nearby = Math.abs(i - step) <= 1;
          const Mock = MOCKS[s.mock];

          return (
            <View key={i} style={{ width, height, backgroundColor: C.dark }}>
              {nearby && <Image source={s.image} style={styles.fill} resizeMode="cover" />}

              <LinearGradient
                colors={[
                  'rgba(18,21,14,0.82)',
                  'rgba(18,21,14,0.04)',
                  'rgba(18,21,14,0.5)',
                  'rgba(18,21,14,0.98)',
                ]}
                locations={[0, 0.3, 0.56, 1]}
                style={styles.fill}
                pointerEvents="none"
              />

              <Animated.View style={[styles.topBlock, { top: insets.top + spacing.xxl, width }, anim]}>
                <Text style={styles.eyebrow}>{s.tag.toUpperCase()}</Text>
                <Text style={styles.headline}>{s.title}</Text>
                <View style={styles.rule} />
                <Text style={styles.lead} numberOfLines={2}>
                  {s.desc}
                </Text>
              </Animated.View>

              <Animated.View
                style={[styles.bottomBlock, { width, paddingBottom: insets.bottom + spacing.lg }, anim]}
              >
                <View style={styles.panel}>
                  <View style={styles.notch} />
                  <View style={styles.captionRow}>
                    <Text style={styles.caption}>{s.caption}</Text>
                    <View style={styles.notePill}>
                      <Text style={styles.noteText}>{s.note}</Text>
                    </View>
                  </View>
                  <Mock />
                </View>

                <View style={styles.footerRow}>
                  <View style={styles.dots}>
                    {SLIDES.map((_, idx) => (
                      <View key={idx} style={[styles.dot, idx === i && styles.dotOn]} />
                    ))}
                  </View>
                  {isLast ? (
                    <Pressable
                      style={styles.cta}
                      onPress={() => {
                        tapMedium();
                        finish();
                      }}
                      accessibilityRole="button"
                      accessibilityLabel="Get started"
                    >
                      <Text style={styles.ctaText}>Get Started</Text>
                      <Ionicons name="arrow-forward" size={16} color={C.btnInk} />
                    </Pressable>
                  ) : (
                    <Pressable
                      hitSlop={12}
                      onPress={next}
                      style={styles.chevronBtn}
                      accessibilityRole="button"
                      accessibilityLabel="Next"
                    >
                      <Ionicons name="chevron-forward" size={20} color={C.ink} />
                    </Pressable>
                  )}
                </View>

                {isLast && !replay && (
                  <Pressable
                    style={styles.loginLink}
                    hitSlop={8}
                    onPress={() => leave('Login')}
                    accessibilityRole="button"
                    accessibilityLabel="I already have an account"
                  >
                    <Text style={styles.loginLinkText}>I already have an account</Text>
                  </Pressable>
                )}
              </Animated.View>
            </View>
          );
        })}
      </Animated.ScrollView>

      <Text style={[styles.wordmark, { top: insets.top + spacing.sm }]}>WeCooked</Text>
      {step < TOTAL - 1 && (
        <Pressable
          style={[styles.skipBtn, { top: insets.top + spacing.sm }]}
          hitSlop={10}
          onPress={() => {
            tapLight();
            finish();
          }}
          accessibilityRole="button"
          accessibilityLabel={replay ? 'Close the tour' : 'Skip onboarding'}
        >
          <Text style={styles.skipText}>{replay ? 'Done' : 'Skip'}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.dark },
  fill: { ...StyleSheet.absoluteFillObject },
  // Both blocks are absolutely positioned and anchored (top-left / bottom-left)
  // rather than stretched inside a flex container — sized purely by their own
  // content, the technique proven reliable on-device for this screen.
  topBlock: { position: 'absolute', left: 0, paddingHorizontal: spacing.xl },
  bottomBlock: { position: 'absolute', left: 0, bottom: 0, paddingHorizontal: spacing.xl },

  eyebrow: {
    fontFamily: typography.body.bold,
    fontSize: 12,
    letterSpacing: 1.8,
    color: C.bodyDim,
  },
  headline: {
    fontFamily: typography.display.fontFamilyBold,
    fontSize: 33,
    lineHeight: 39,
    color: C.accent,
    marginTop: spacing.sm,
  },
  rule: { width: 44, height: 3, borderRadius: 2, backgroundColor: C.accent, marginVertical: spacing.md },
  lead: { fontFamily: typography.body.fontFamily, fontSize: 14, lineHeight: 21, color: C.bodyDim },

  panel: {
    backgroundColor: C.panel,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: C.panelLine,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  notch: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(250,249,246,0.2)',
    marginBottom: spacing.xs,
  },
  captionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  caption: { fontFamily: typography.display.fontFamily, fontSize: 16, color: C.ink },
  notePill: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(217,166,75,0.16)',
  },
  noteText: { fontFamily: typography.body.semibold, fontSize: 10.5, color: C.accent, letterSpacing: 0.2 },

  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
  },
  dots: { flexDirection: 'row', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.seg },
  dotOn: { width: 22, backgroundColor: C.accent },
  chevronBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(250,249,246,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    backgroundColor: C.btn,
  },
  ctaText: { fontFamily: typography.body.semibold, fontSize: 14, letterSpacing: 0.3, color: C.btnInk },
  loginLink: { alignSelf: 'center', marginTop: spacing.md, paddingVertical: 4 },
  loginLinkText: {
    fontFamily: typography.body.semibold,
    fontSize: 12.5,
    color: C.bodyDim,
    textDecorationLine: 'underline',
  },

  wordmark: {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
    fontFamily: typography.display.fontFamilyItalic,
    fontSize: 20,
    letterSpacing: 0.5,
    color: C.ink,
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowRadius: 8,
  },
  skipBtn: { position: 'absolute', right: spacing.xl, paddingVertical: 2 },
  skipText: {
    fontFamily: typography.body.semibold,
    fontSize: 13,
    color: C.skip,
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowRadius: 8,
  },
});

const mockStyles = StyleSheet.create({
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.mockFill,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    height: 38,
  },
  searchText: { flex: 1, fontFamily: typography.body.fontFamily, fontSize: 12, color: C.mockText },
  filterDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipRow: { flexDirection: 'row', gap: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: C.mockFill,
  },
  chipText: { fontFamily: typography.body.medium, fontSize: 10.5, color: C.bodyDim },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  thumb: { width: 40, height: 40, borderRadius: 10, backgroundColor: C.mockFill },
  rowTitle: { fontFamily: typography.body.semibold, fontSize: 12.5, color: C.mockText },
  rowMeta: { fontFamily: typography.body.fontFamily, fontSize: 10.5, color: C.faint },

  stepPhoto: {
    height: 84,
    borderRadius: 14,
    backgroundColor: C.mockFill,
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    padding: 8,
  },
  playDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  timerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: C.mockFill,
  },
  timerText: { fontFamily: typography.body.semibold, fontSize: 11, color: C.ink },
  dotsRow: { flexDirection: 'row', gap: 5 },
  stepDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.mockLine },
  stepDotDone: { backgroundColor: 'rgba(217,166,75,0.5)' },
  stepDotOn: { backgroundColor: C.accent, width: 16 },

  swapRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  swapChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: C.mockFill,
    alignItems: 'center',
  },
  swapChipOn: { backgroundColor: 'rgba(217,166,75,0.18)' },
  swapChipText: { fontFamily: typography.body.semibold, fontSize: 12, color: C.ink },
  ratioText: {
    fontFamily: typography.body.medium,
    fontSize: 11,
    color: C.faint,
    textAlign: 'center',
    marginTop: -2,
  },
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  noteText: {
    fontFamily: typography.body.fontFamily,
    fontSize: 11,
    lineHeight: 15,
    color: C.bodyDim,
    flexShrink: 1,
  },

  weekRow: { flexDirection: 'row', justifyContent: 'space-between' },
  dayCol: { alignItems: 'center', gap: 6 },
  dayLabel: { fontFamily: typography.body.semibold, fontSize: 10.5, color: C.bodyDim },
  dayDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.mockLine },
  dayDotOn: { backgroundColor: C.accent },
  mealChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.mockFill,
    borderRadius: radius.md,
    padding: 7,
  },
  mealThumb: { width: 26, height: 26, borderRadius: 7, backgroundColor: C.mockLine },

  postHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.mockFill },
  postPhoto: { height: 70, borderRadius: 12, backgroundColor: C.mockFill },
  iconCount: { flexDirection: 'row', alignItems: 'center', gap: 5 },
});
