import React, { useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Image,
  Animated,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { typography, spacing, radius } from '../theme/theme';
import { useAuth } from '../context/AuthContext';

// Swipeable carousel. Each slide: a photo up top, a headline block over the
// fade, and a floating "preview card" lower down sketching what that part of
// the app actually looks like — built from WeCooked's own screens, not a
// literal screenshot.
const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const SLIDES = [
  {
    image: require('../../assets/recipe-chicken-adobo.jpg'),
    tag: 'Discover',
    title: 'One search,\nevery recipe',
    desc: 'A feed tuned to your taste, with filters for time, difficulty and diet — so you always know what to cook next.',
    mock: 'search',
    caption: 'Popular Recipes',
    captionNote: 'Matched to your taste',
    panelDesc: 'Search by time, difficulty or diet and see what fits.',
  },
  {
    image: require('../../assets/recipe-sisig.jpg'),
    tag: 'Cook Mode',
    title: 'Cook it\nhands-free',
    desc: 'Full-screen guided steps with built-in timers keep you moving without touching the screen.',
    mock: 'cook',
    caption: 'Now Cooking',
    captionNote: 'Step 3 of 7',
    panelDesc: 'Follow along hands-free, with a timer built into every step.',
  },
  {
    image: require('../../assets/recipe-ginataang-gulay.jpg'),
    tag: 'Ingredient Swaps',
    title: 'Out of something?\nSwap it',
    desc: 'Get a substitute in the right ratio, with quick tasting notes, for any ingredient you’re missing.',
    mock: 'swap',
    caption: 'Suggested Swap',
    captionNote: 'Ratios included',
    panelDesc: "Swap ratios and tasting notes for anything you're missing.",
  },
  {
    image: require('../../assets/recipe-kare-kare.jpg'),
    tag: 'Meal Plan',
    title: 'Plan the week,\nshop once',
    desc: 'Drop recipes onto a weekly plan and auto-build the grocery list from what you picked.',
    mock: 'plan',
    caption: 'This Week',
    captionNote: '3 meals planned',
    panelDesc: 'Drag recipes onto your week — the grocery list builds itself.',
  },
  {
    image: require('../../assets/recipe-turon.jpg'),
    tag: 'Community',
    title: 'Cook with\neveryone',
    desc: "Share what you're making, get inspired by other home cooks, and ask the Chef anytime.",
    mock: 'community',
    caption: 'Latest Post',
    captionNote: 'From the community',
    panelDesc: 'See what other home cooks are making right now.',
  },
];

const TOTAL = SLIDES.length;

// Fixed light-on-dark palette — this screen lives on a photo.
const C = {
  ink: '#FAF9F6',
  bodyDim: 'rgba(250,249,246,0.72)',
  skip: 'rgba(250,249,246,0.78)',
  accent: '#D9A64B',
  dark: '#15180F',
  seg: 'rgba(250,249,246,0.3)',
  btn: '#FAF9F6',
  btnInk: '#26332B',
  panel: 'rgba(19,22,15,0.92)',
  panelLine: 'rgba(250,249,246,0.14)',
  mockFill: 'rgba(250,249,246,0.09)',
  mockLine: 'rgba(250,249,246,0.16)',
};

// --- mini feature "mockups" shown inside the preview card ------------------

function SearchMock() {
  return (
    <>
      <View style={mockStyles.searchRow}>
        <Ionicons name="search" size={13} color={C.bodyDim} />
        <View style={mockStyles.searchBar} />
        <View style={mockStyles.filterDot}>
          <Ionicons name="options" size={11} color={C.btnInk} />
        </View>
      </View>
      {[0.62, 0.44].map((w, i) => (
        <View key={i} style={mockStyles.listRow}>
          <View style={mockStyles.thumb} />
          <View style={{ flex: 1, gap: 6 }}>
            <View style={[mockStyles.textBar, { width: `${w * 100}%` }]} />
            <View style={[mockStyles.textBar, mockStyles.textBarSm, { width: '35%' }]} />
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
        <View style={[mockStyles.textBar, { width: 90 }]} />
        <View style={mockStyles.timerChip}>
          <Ionicons name="time-outline" size={11} color={C.accent} />
          <Text style={mockStyles.timerText}>2:45</Text>
        </View>
      </View>
      <View style={mockStyles.dotsRow}>
        {[0, 1, 2, 3, 4].map((i) => (
          <View key={i} style={[mockStyles.stepDot, i === 2 && mockStyles.stepDotOn]} />
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
          <Text style={mockStyles.swapChipText}>Coconut Oil</Text>
        </View>
      </View>
      <View style={mockStyles.noteRow}>
        <Ionicons name="checkmark-circle" size={13} color={C.accent} />
        <View style={[mockStyles.textBar, mockStyles.textBarSm, { width: '58%' }]} />
      </View>
    </>
  );
}

function PlanMock() {
  return (
    <>
      <View style={mockStyles.weekRow}>
        {DAY_LABELS.map((d, i) => (
          <View key={i} style={mockStyles.dayCol}>
            <Text style={mockStyles.dayLabel}>{d}</Text>
            <View style={[mockStyles.dayDot, (i === 1 || i === 3 || i === 5) && mockStyles.dayDotOn]} />
          </View>
        ))}
      </View>
      <View style={mockStyles.noteRow}>
        <Ionicons name="cart-outline" size={13} color={C.accent} />
        <View style={[mockStyles.textBar, mockStyles.textBarSm, { width: '50%' }]} />
      </View>
    </>
  );
}

function CommunityMock() {
  return (
    <>
      <View style={mockStyles.postHead}>
        <View style={mockStyles.avatar} />
        <View style={{ gap: 6 }}>
          <View style={[mockStyles.textBar, { width: 84 }]} />
          <View style={[mockStyles.textBar, mockStyles.textBarSm, { width: 50 }]} />
        </View>
      </View>
      <View style={mockStyles.postPhoto} />
      <View style={mockStyles.rowBetween}>
        <View style={mockStyles.iconCount}>
          <Ionicons name="heart" size={13} color={C.accent} />
          <Text style={mockStyles.timerText}>128</Text>
        </View>
        <View style={mockStyles.iconCount}>
          <Ionicons name="chatbubble-outline" size={12} color={C.bodyDim} />
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

  const replay = route?.params?.replay;

  const finish = () => {
    if (replay) {
      navigation.goBack();
      return;
    }
    markOnboardingSeen();
    navigation.replace(isLoggedIn ? 'MainTabs' : 'Login');
  };
  const goTo = (i) => {
    const t = Math.max(0, Math.min(TOTAL - 1, i));
    scrollRef.current?.scrollTo({ x: t * width, animated: true });
  };

  const onScroll = useMemo(
    () =>
      Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
        useNativeDriver: true,
        listener: (e) => setStep(Math.round(e.nativeEvent.contentOffset.x / width)),
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
                  outputRange: [16, 0, 16],
                  extrapolate: 'clamp',
                }),
              },
            ],
          };

          // The ScrollView mounts every page up front (it isn't virtualized), so
          // without this every slide's photo would fetch at once on first paint.
          const nearby = Math.abs(i - step) <= 1;
          const Mock = MOCKS[s.mock];

          return (
            <View key={i} style={{ width, height, backgroundColor: C.dark }}>
              {nearby && <Image source={s.image} style={styles.fill} resizeMode="cover" />}

              <LinearGradient
                colors={['rgba(21,24,15,0.75)', 'rgba(21,24,15,0.15)', 'rgba(21,24,15,0.55)', 'rgba(21,24,15,0.97)']}
                locations={[0, 0.28, 0.5, 1]}
                style={styles.fill}
                pointerEvents="none"
              />

              <Animated.View
                style={[styles.topBlock, { top: insets.top + spacing.xxl, width }, anim]}
              >
                <Text style={styles.eyebrow}>{`STEP ${i + 1} — ${s.tag.toUpperCase()}`}</Text>
                <Text style={styles.headline}>{s.title}</Text>
                <View style={styles.rule} />
                <Text style={styles.lead}>{s.desc}</Text>
              </Animated.View>

              <View style={[styles.bottomBlock, { width, paddingBottom: insets.bottom + spacing.lg }]}>
                <View style={styles.panel}>
                  <View style={styles.handle} />
                  <View style={styles.captionRow}>
                    <Text style={styles.caption}>{s.caption}</Text>
                    <Text style={styles.captionNote}>{s.captionNote}</Text>
                  </View>
                  <Text style={styles.panelDesc}>{s.panelDesc}</Text>
                  <Mock />
                </View>

                <View style={styles.footerRow}>
                  <View style={styles.dots}>
                    {SLIDES.map((_, idx) => (
                      <View key={idx} style={[styles.dot, idx === i && styles.dotOn]} />
                    ))}
                  </View>
                  {isLast ? (
                    <Pressable style={styles.cta} onPress={finish}>
                      <Text style={styles.ctaText}>Get Started</Text>
                      <Ionicons name="arrow-forward" size={16} color={C.btnInk} />
                    </Pressable>
                  ) : (
                    <Pressable hitSlop={12} onPress={() => goTo(i + 1)} style={styles.chevronBtn}>
                      <Ionicons name="chevron-forward" size={20} color={C.ink} />
                    </Pressable>
                  )}
                </View>
              </View>
            </View>
          );
        })}
      </Animated.ScrollView>

      <Text style={[styles.wordmark, { top: insets.top + spacing.sm }]}>WeCooked</Text>
      {step < TOTAL - 1 && (
        <Pressable
          style={[styles.skipBtn, { top: insets.top + spacing.sm }]}
          hitSlop={10}
          onPress={finish}
        >
          <Text style={styles.skipText}>Skip</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.dark },
  fill: { ...StyleSheet.absoluteFillObject },
  // Both blocks are absolutely positioned and anchored (top-left / bottom-left)
  // rather than stretched to fill a flex container — sized purely by their own
  // content, the same technique already proven reliable on-device.
  topBlock: { position: 'absolute', left: 0, paddingHorizontal: spacing.xl },
  bottomBlock: { position: 'absolute', left: 0, bottom: 0, paddingHorizontal: spacing.xl },

  eyebrow: {
    fontFamily: typography.body.bold,
    fontSize: 12,
    letterSpacing: 1.6,
    color: C.bodyDim,
  },
  headline: {
    fontFamily: typography.display.fontFamily,
    fontSize: 30,
    lineHeight: 36,
    color: C.accent,
    marginTop: spacing.sm,
  },
  rule: { width: 44, height: 3, borderRadius: 2, backgroundColor: C.accent, marginVertical: spacing.sm },
  lead: { fontFamily: typography.body.fontFamily, fontSize: 13.5, lineHeight: 20, color: C.bodyDim },

  panel: {
    backgroundColor: C.panel,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: C.panelLine,
    padding: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.md,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.panelLine,
    marginBottom: spacing.xs,
  },
  captionRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  caption: { fontFamily: typography.display.fontFamily, fontSize: 15, color: C.ink },
  captionNote: { fontFamily: typography.body.medium, fontSize: 11, color: C.accent },
  panelDesc: {
    fontFamily: typography.body.fontFamily,
    fontSize: 12.5,
    lineHeight: 18,
    color: C.bodyDim,
    marginTop: -4,
  },

  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
  },
  dots: { flexDirection: 'row', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.seg },
  dotOn: { width: 20, backgroundColor: C.accent },
  chevronBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(250,249,246,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 46,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    backgroundColor: C.btn,
  },
  ctaText: { fontFamily: typography.body.semibold, fontSize: 14, letterSpacing: 0.3, color: C.btnInk },

  wordmark: {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
    fontFamily: typography.display.fontFamilyItalic,
    fontSize: 20,
    letterSpacing: 0.5,
    color: C.ink,
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowRadius: 8,
  },
  skipBtn: { position: 'absolute', right: spacing.xl, paddingVertical: 2 },
  skipText: {
    fontFamily: typography.body.semibold,
    fontSize: 13,
    color: C.skip,
    textShadowColor: 'rgba(0,0,0,0.35)',
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
  searchBar: { flex: 1, height: 6, borderRadius: 3, backgroundColor: C.mockLine },
  filterDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  thumb: { width: 40, height: 40, borderRadius: 10, backgroundColor: C.mockFill },
  textBar: { height: 8, borderRadius: 4, backgroundColor: C.mockLine },
  textBarSm: { height: 6, opacity: 0.7 },

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
  stepDotOn: { backgroundColor: C.accent },

  swapRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  swapChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: C.mockFill,
    alignItems: 'center',
  },
  swapChipOn: { backgroundColor: 'rgba(217,166,75,0.18)' },
  swapChipText: { fontFamily: typography.body.semibold, fontSize: 12, color: C.ink },
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },

  weekRow: { flexDirection: 'row', justifyContent: 'space-between' },
  dayCol: { alignItems: 'center', gap: 6 },
  dayLabel: { fontFamily: typography.body.semibold, fontSize: 10.5, color: C.bodyDim },
  dayDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.mockLine },
  dayDotOn: { backgroundColor: C.accent },

  postHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.mockFill },
  postPhoto: { height: 70, borderRadius: 12, backgroundColor: C.mockFill },
  iconCount: { flexDirection: 'row', alignItems: 'center', gap: 5 },
});
