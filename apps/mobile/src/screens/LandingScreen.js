import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ImageBackground,
  ScrollView,
  StyleSheet,
  Animated,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { typography, spacing, radius } from '../theme/theme';
import { ONBOARD_C, SlideHeading, FeaturePanel } from './onboarding/shared';
import { PREVIEW_MOCKS } from './onboarding/previewMocks';

// Onboarding carousel, ported from the teammate OnboardingScreen.
//
// Presentation only. This screen holds no authentication state, no session,
// and no "onboarding seen" flag: it is a five-slide pitch whose last slide
// hands off to the two real WeCooked destinations, Register and Login. The
// teammate's finish() — markOnboardingSeen() plus replace('MainTabs') off an
// isLoggedIn flag — is deliberately NOT ported; RootNavigator owns which stack
// is mounted, off real AuthContext state.
//
// Each page is one ImageBackground carrying that slide's own photo, with the
// scrim and the whole foreground as its CHILDREN. That is a deliberate
// Android adaptation of the teammate structure, which used a standalone
// absolutely-filled <Image> as a sibling of the foreground: on the physical
// Samsung (Fabric) that sibling could paint over the foreground composed
// after it. Making the photo the parent's background instead removes the
// ordering question entirely, with no zIndex or elevation hacks.
//
// The scrim itself (SlideScrim, below) is built from ordinary stacked <View>
// bands rather than expo-linear-gradient — physical-device testing showed
// LinearGradient does not paint at all in this composition on the Samsung/
// Fabric runtime it was tested on, while plain Views do.

const SLIDES = [
  {
    key: 'discover',
    image: require('../assets/onboarding/discover.jpg'),
    tag: 'Discover',
    title: 'One search,\nevery recipe',
    lead:
      'A feed tuned to your taste, with filters for time, difficulty and diet — so you always know what to cook next.',
    mock: 'search',
    caption: 'Popular Recipes',
    note: 'Matched to your taste',
    panelDesc: 'Search by time, difficulty or diet and see what fits.',
  },
  {
    key: 'cook-mode',
    image: require('../assets/onboarding/cook-mode.jpg'),
    tag: 'Cook Mode',
    title: 'Cook it\nhands-free',
    lead:
      'Full-screen guided steps with built-in timers keep you moving without touching the screen.',
    mock: 'cook',
    caption: 'Now Cooking',
    note: 'Step 3 of 7',
    panelDesc: 'Follow along hands-free, with a timer built into every step.',
  },
  {
    key: 'swaps',
    image: require('../assets/onboarding/swaps.jpg'),
    tag: 'Ingredient Swaps',
    title: 'Out of something?\nSwap it',
    lead:
      'Get a substitute in the right ratio, with quick tasting notes, for any ingredient you’re missing.',
    mock: 'swap',
    caption: 'Suggested Swap',
    note: 'Ratios included',
    panelDesc: "Swap ratios and tasting notes for anything you're missing.",
  },
  {
    key: 'meal-plan',
    image: require('../assets/onboarding/meal-plan.jpg'),
    tag: 'Meal Plan',
    title: 'Plan the week,\nshop once',
    lead:
      'Drop recipes onto a weekly plan and auto-build the grocery list from what you picked.',
    mock: 'plan',
    caption: 'This Week',
    note: '3 meals planned',
    panelDesc: 'Drag recipes onto your week — the grocery list builds itself.',
  },
  {
    key: 'community',
    image: require('../assets/onboarding/community.jpg'),
    tag: 'Community',
    title: 'Cook with\neveryone',
    lead:
      "Share what you're making, get inspired by other home cooks, and ask the Chef anytime.",
    mock: 'community',
    caption: 'Latest Post',
    note: 'From the community',
    panelDesc: 'See what other home cooks are making right now.',
  },
];

const TOTAL = SLIDES.length;

// Clearance under the wordmark row for the first line of slide copy.
const HEADER_RESERVE = 44;

// --- View-based scrim (no LinearGradient) -----------------------------
//
// expo-linear-gradient proved incompatible with this screen on the physical
// Samsung/Fabric runtime: an opaque-red LinearGradient canary painted
// nothing, while an ordinary View/Text style change in the same file, same
// reload, did render. So the scrim every slide lays over its photo is built
// entirely from stacked, ordinary <View> bands — the one primitive already
// proven to render correctly in this composition.
//
// SCRIM_BASE is the teammate's dark tone (ground/#1E211D, i.e. rgb(30,33,29))
// — the same color the old LinearGradient used, just applied as flat,
// non-overlapping bands instead of an interpolated gradient. Each band's
// opacity is the teammate's original 4-stop curve (locations [0, .28, .5, 1],
// alphas [.78, .18, .58, .97]) sampled at that band's own vertical center, so
// stacking introduces no compositing surprises — what you see per band is
// exactly that band's opacity, nothing multiplies.
//
// 12 bands, not 4-6: with only 4-6 *non-overlapping* Views the opacity jump
// at each band edge came out 0.27-0.36 (modeled before touching the device),
// which reads as a hard line on a flat sky or wall photo. Halving the band
// height twice — 6 → 12 — nearly halves that same worst-case step to ~0.18,
// which is the more important requirement here. All 12 are still broad
// bands (~1/12 of the slide's height each), not a fine gradient mesh.
const SCRIM_BASE = '30,33,29';
const SCRIM_BANDS = [
  { top: 0, height: 8.33, opacity: 0.691 },
  { top: 8.33, height: 8.33, opacity: 0.512 },
  { top: 16.67, height: 8.33, opacity: 0.334 },
  { top: 25, height: 8.33, opacity: 0.201 },
  { top: 33.33, height: 8.33, opacity: 0.353 },
  { top: 41.67, height: 8.33, opacity: 0.504 },
  { top: 50, height: 8.33, opacity: 0.612 },
  { top: 58.33, height: 8.33, opacity: 0.677 },
  { top: 66.67, height: 8.33, opacity: 0.743 },
  { top: 75, height: 8.33, opacity: 0.807 },
  { top: 83.33, height: 8.33, opacity: 0.873 },
  { top: 91.67, height: 8.33, opacity: 0.938 },
];

/** The photo scrim: ordinary, non-overlapping View bands — no gradient. */
function SlideScrim() {
  return (
    <View style={styles.scrim} pointerEvents="none">
      {SCRIM_BANDS.map((band, idx) => (
        <View
          key={idx}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: `${band.top}%`,
            height: `${band.height}%`,
            backgroundColor: `rgba(${SCRIM_BASE},${band.opacity})`,
          }}
        />
      ))}
    </View>
  );
}

/** Progress dots for slide `index`. Announced once, as a single position. */
function Dots({ index }) {
  return (
    <View style={styles.dots} accessible accessibilityLabel={`Step ${index + 1} of ${TOTAL}`}>
      {SLIDES.map((s, idx) => (
        <View key={s.key} style={[styles.dot, idx === index && styles.dotOn]} />
      ))}
    </View>
  );
}

export default function LandingScreen({ navigation }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const scrollRef = useRef(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  const [step, setStep] = useState(0);
  const stepRef = useRef(0);

  const goRegister = () => navigation.navigate('Register');
  const goLogin = () => navigation.navigate('Login');

  const goToSlide = (i) => {
    const next = Math.max(0, Math.min(TOTAL - 1, i));
    scrollRef.current?.scrollTo({ x: next * width, animated: true });
  };

  // Skip is a carousel control, not an exit. It jumps to the final slide —
  // where the two real destinations live — and never authenticates, replaces
  // a route, or records anything.
  const skipToEnd = () => goToSlide(TOTAL - 1);

  // Width can change without the pager emitting a useful final scroll event
  // (rotation, foldable unfold). Keep the logical slide and re-snap onto the
  // new page width once the resized children have committed.
  useLayoutEffect(() => {
    const x = stepRef.current * width;
    scrollRef.current?.scrollTo({ x, animated: false });
    scrollX.setValue(x);
  }, [width, scrollX]);

  const onScroll = useMemo(
    () =>
      Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
        useNativeDriver: true,
        listener: (e) => {
          const idx = Math.max(
            0,
            Math.min(TOTAL - 1, Math.round(e.nativeEvent.contentOffset.x / width))
          );
          stepRef.current = idx;
          setStep((prev) => (prev === idx ? prev : idx));
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
        {SLIDES.map((slide, i) => {
          const isLast = i === TOTAL - 1;
          const Mock = PREVIEW_MOCKS[slide.mock];

          const inputRange = [(i - 1) * width, i * width, (i + 1) * width];
          const reveal = {
            opacity: scrollX.interpolate({
              inputRange,
              outputRange: [0, 1, 0],
              extrapolate: 'clamp',
            }),
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

          return (
            <View key={slide.key} style={{ width, height, backgroundColor: ONBOARD_C.ground }}>
              <ImageBackground
                source={slide.image}
                resizeMode="cover"
                style={styles.page}
                accessible={false}
                importantForAccessibility="no"
              >
                <SlideScrim />

                {/* Safe-area foreground. It fills the page's explicit height, so
                    the body region below always has a real bounded box to work
                    in — no measured pager height and no window-metric maths. */}
                <View
                  style={[
                    styles.foreground,
                    {
                      paddingTop: insets.top + HEADER_RESERVE,
                      paddingBottom: insets.bottom + spacing.lg,
                    },
                  ]}
                >
                  {/* Headline at the top, preview panel at the bottom, flexible
                      space between. On a short screen or a large font scale the
                      pair scrolls vertically instead of clipping; the footer
                      below is outside this region and stays put. */}
                  <ScrollView
                    style={styles.body}
                    contentContainerStyle={styles.bodyContent}
                    showsVerticalScrollIndicator={false}
                    directionalLockEnabled
                    nestedScrollEnabled
                  >
                    <View style={styles.bodyInner}>
                      {/* Only the headline block carries the swipe reveal, as
                          in the teammate screen — the preview panel stays
                          fully opaque so it is never mid-fade on arrival. */}
                      <Animated.View style={reveal}>
                        <SlideHeading
                          eyebrow={`STEP ${i + 1} — ${slide.tag.toUpperCase()}`}
                          title={slide.title}
                          lead={slide.lead}
                        />
                      </Animated.View>

                      <FeaturePanel
                        caption={slide.caption}
                        note={slide.note}
                        description={slide.panelDesc}
                      >
                        <Mock />
                      </FeaturePanel>
                    </View>
                  </ScrollView>

                  <View style={styles.footer}>
                    {isLast ? (
                      <>
                        <Dots index={i} />

                        <Pressable
                          onPress={goRegister}
                          style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
                          accessibilityRole="button"
                          accessibilityLabel="Create your WeCooked account"
                        >
                          <Text style={styles.ctaText}>Create Account</Text>
                          <Ionicons name="arrow-forward" size={16} color={ONBOARD_C.ctaInk} />
                        </Pressable>

                        <Pressable
                          onPress={goLogin}
                          hitSlop={10}
                          style={({ pressed }) => [styles.loginLink, pressed && styles.pressed]}
                          accessibilityRole="button"
                          accessibilityLabel="Log in to an existing account"
                        >
                          <Text style={styles.loginLinkText}>I already have an account</Text>
                        </Pressable>
                      </>
                    ) : (
                      <View style={styles.footerRow}>
                        <Dots index={i} />

                        <Pressable
                          hitSlop={12}
                          onPress={() => goToSlide(i + 1)}
                          style={({ pressed }) => [styles.chevronBtn, pressed && styles.pressed]}
                          accessibilityRole="button"
                          accessibilityLabel={`Next step, ${i + 2} of ${TOTAL}`}
                        >
                          <Ionicons name="chevron-forward" size={20} color={ONBOARD_C.ink} />
                        </Pressable>
                      </View>
                    )}
                  </View>
                </View>
              </ImageBackground>
            </View>
          );
        })}
      </Animated.ScrollView>

      <Text style={[styles.wordmark, { top: insets.top + spacing.sm }]} accessibilityRole="header">
        WeCooked
      </Text>

      {step < TOTAL - 1 && (
        <Pressable
          style={[styles.skipBtn, { top: insets.top + spacing.sm }]}
          hitSlop={12}
          onPress={skipToEnd}
          accessibilityRole="button"
          accessibilityLabel="Skip the tour"
          accessibilityHint="Jumps to the last step, where you can create an account or log in"
        >
          <Text style={styles.skipText}>Skip</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: ONBOARD_C.ground },

  // Fills the page View's explicit { width, height }. The photo is this
  // component's own background, so the scrim and foreground below are its
  // children and compose over it by construction.
  page: { flex: 1 },
  scrim: { ...StyleSheet.absoluteFillObject },

  foreground: { flex: 1, paddingHorizontal: spacing.xl },

  body: { flex: 1 },
  bodyContent: { flexGrow: 1 },
  bodyInner: { flexGrow: 1, justifyContent: 'space-between', gap: spacing.xl },

  // A normal-flow sibling after the body region — never inside it, never
  // absolutely positioned, and never measured.
  footer: { flexShrink: 0, paddingTop: spacing.lg, gap: spacing.md },
  footerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(250,249,246,0.30)' },
  dotOn: { width: 20, backgroundColor: ONBOARD_C.accent },

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
    gap: spacing.sm,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: ONBOARD_C.ctaBg,
  },
  ctaText: {
    fontFamily: typography.body.semibold,
    fontSize: typography.sizes.md,
    letterSpacing: 0.3,
    color: ONBOARD_C.ctaInk,
  },
  loginLink: { alignItems: 'center', paddingVertical: spacing.xs },
  loginLinkText: {
    fontFamily: typography.body.semibold,
    fontSize: 13.5,
    color: ONBOARD_C.ink,
  },
  pressed: { opacity: 0.8 },

  wordmark: {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
    fontFamily: typography.display.fontFamilyItalic,
    fontSize: typography.sizes.xl,
    letterSpacing: 0.5,
    color: ONBOARD_C.ink,
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowRadius: 8,
  },
  skipBtn: { position: 'absolute', right: spacing.xl, paddingVertical: 2 },
  skipText: {
    fontFamily: typography.body.semibold,
    fontSize: 13,
    color: ONBOARD_C.inkDim,
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowRadius: 8,
  },
});
