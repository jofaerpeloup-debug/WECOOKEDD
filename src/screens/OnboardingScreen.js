import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Image, Animated, Easing, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { typography, spacing, radius } from '../theme/theme';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { tapLight, tapMedium } from '../utils/haptics';

// Swipeable carousel. Each slide has its own tinted canvas (light + dark
// variants), a round dish photo inside soft concentric rings with two floating
// feature chips, then an eyebrow, a serif headline whose second line is italic
// in the slide's accent colour, and a short description.
const SLIDES = [
  {
    image: require('../../assets/recipe-chicken-adobo.jpg'),
    eyebrow: '01 — DISCOVER',
    title: 'One search,',
    accent: 'every recipe.',
    desc: 'Filters for time, difficulty and diet, tuned to your taste.',
    chipTop: { icon: 'search', text: '32 Filipino recipes' },
    chipBottom: { icon: 'time-outline', text: 'Chicken Adobo · 50 min' },
    tone: 'sage',
  },
  {
    image: require('../../assets/recipe-sisig.jpg'),
    eyebrow: '02 — COOK MODE',
    title: 'Cook it',
    accent: 'hands-free.',
    desc: 'Full-screen guided steps, with a timer built into each one.',
    chipTop: { icon: 'timer-outline', text: 'Step 5 · 19:52 left' },
    chipBottom: { icon: 'checkmark', text: 'Big, clear steps' },
    tone: 'saffron',
  },
  {
    image: require('../../assets/recipe-ginataang-gulay.jpg'),
    eyebrow: '03 — INGREDIENT SWAPS',
    title: 'Out of something?',
    accent: 'Swap it.',
    desc: 'A substitute in the right ratio, with a quick tasting note.',
    chipTop: { icon: 'swap-horizontal', text: 'Coconut milk → Cashew cream' },
    chipBottom: { icon: 'scale-outline', text: '1 : 1 ratio' },
    tone: 'sage',
  },
  {
    image: require('../../assets/recipe-kare-kare.jpg'),
    eyebrow: '04 — MEAL PLAN',
    title: 'Plan the week,',
    accent: 'shop once.',
    desc: 'Add recipes to your week and the grocery list builds itself.',
    chipTop: { icon: 'calendar-outline', text: 'Thursday · Kare-Kare' },
    chipBottom: { icon: 'cart-outline', text: 'Grocery list ready' },
    tone: 'clay',
  },
  {
    image: require('../../assets/recipe-turon.jpg'),
    eyebrow: '05 — COMMUNITY',
    title: 'Cook with',
    accent: 'everyone.',
    desc: 'Share what you make, get inspired, and ask the Chef anytime.',
    chipTop: { icon: 'heart', text: 'Shared a Turon' },
    chipBottom: { icon: 'sparkles', text: 'Ask the Chef' },
    tone: 'saffron',
  },
];

const TOTAL = SLIDES.length;
const SAGE_BTN = '#4A5D4E';

// Fixed palettes: warm cream + tan rings + gold accents (light), deep forest
// green + green rings (dark). Dark slides tint their accent per feature.
const LIGHT = {
  bg: '#F6F0E2', ring: '#ECDDBC', dash: '#E0CFA6', ink: '#2A2F28', body: '#6B6F68',
  chip: '#FFFFFF', chipIcon: '#EEDDB8', photoBorder: '#FFFFFF', dot: '#D9D2C2', track: '#E6DDC6',
  btn: '#4A5D4E', accent: { sage: '#A8731F', saffron: '#A8731F', clay: '#A8731F' }, eyebrow: { sage: '#A8731F', saffron: '#A8731F', clay: '#A8731F' },
};
const DARK = {
  bg: '#192019', ring: '#2E3A2E', dash: 'rgba(255,255,255,0.08)', ink: '#EDEAE0', body: '#A9ACA3',
  chip: 'rgba(255,255,255,0.08)', chipIcon: 'rgba(255,255,255,0.08)', photoBorder: '#2E3A2E', dot: '#505750', track: '#3A463B',
  btn: '#536154', accent: { sage: '#A9C7A0', saffron: '#D9A64B', clay: '#E39A87' }, eyebrow: { sage: '#9CAE98', saffron: '#D9A64B', clay: '#E39A87' },
};

function Chip({ icon, text, accent, isDark }) {
  const k = isDark ? DARK : LIGHT;
  return (
    <View style={[styles.chip, isDark ? styles.chipDark : styles.chipLight, { backgroundColor: k.chip }]}>
      <View style={[styles.chipIcon, { backgroundColor: k.chipIcon }]}>
        <Ionicons name={icon} size={11} color={accent} />
      </View>
      <Text style={[styles.chipText, { color: k.ink }]} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

export default function OnboardingScreen({ navigation, route }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { isLoggedIn, markOnboardingSeen } = useAuth();
  const { isDark } = useTheme();
  const k = isDark ? DARK : LIGHT;

  const scrollRef = useRef(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  const float = useRef(new Animated.Value(0)).current;
  const [step, setStep] = useState(0);
  const stepRef = useRef(0);

  const replay = route?.params?.replay;
  const photoD = Math.min(width * 0.6, height * 0.27);
  const outerD = photoD * 1.42;
  const midD = photoD * 1.2;

  const ink = k.ink;
  const body = k.body;
  const pal = (s) => ({ bg: k.bg, ring: k.ring, accent: k.accent[s.tone] });

  // Gentle idle bob on the dish so the screen is never completely still.
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(float, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(float, { toValue: 0, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [float]);
  const bob = float.interpolate({ inputRange: [0, 1], outputRange: [-5, 5] });

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

  // Value for slide i as it enters (left), is centred (middle) and leaves (right).
  // `reach` is how many pages away the animation spans (smaller = snappier).
  const at = (i, out, reach = 1) =>
    scrollX.interpolate({
      inputRange: [(i - reach) * width, i * width, (i + reach) * width],
      outputRange: out,
      extrapolate: 'clamp',
    });

  const lastFade = scrollX.interpolate({
    inputRange: [(TOTAL - 2) * width, (TOTAL - 1) * width],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const notLastFade = scrollX.interpolate({
    inputRange: [(TOTAL - 2) * width, (TOTAL - 1) * width],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  const onLast = step === TOTAL - 1;
  const accent = pal(SLIDES[step]).accent;
  const filled = Math.ceil(((step + 1) / TOTAL) * 4);
  const ringColor = (n) => (n <= filled ? accent : k.track);

  return (
    <View style={[styles.root, { backgroundColor: pal(SLIDES[0]).bg }]}>
      {/* Backgrounds crossfade as you drag. */}
      {SLIDES.map((s, i) => (
        <Animated.View
          key={'bg' + i}
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: pal(s).bg, opacity: at(i, [0, 1, 0]) }]}
        />
      ))}

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
          const p = pal(s);

          // The ScrollView mounts every page up front (it isn't virtualized), so
          // this keeps only the visible photo + its neighbours loaded.
          const nearby = Math.abs(i - step) <= 1;

          const fade = at(i, [0, 1, 0]);
          const fadeFast = at(i, [0, 1, 0], 0.6);

          const ringOuterAnim = { opacity: fade, transform: [{ scale: at(i, [0.4, 1, 1.7]) }] };
          const ringMidAnim = { opacity: fade, transform: [{ scale: at(i, [0.55, 1, 1.45]) }] };
          // The dish spins in like a plate, scaling up as it settles.
          const photoAnim = {
            opacity: fadeFast,
            transform: [
              { translateX: at(i, [-width * 0.35, 0, width * 0.35]) },
              { translateY: bob },
              { scale: at(i, [0.55, 1, 0.55]) },
              { rotate: at(i, ['-110deg', '0deg', '110deg']) },
            ],
          };
          // Everything else travels at its own speed for depth.
          const chipTopAnim = {
            opacity: fadeFast,
            transform: [{ translateX: at(i, [width * 0.7, 0, -width * 0.7]) }, { scale: at(i, [0.7, 1, 0.7]) }],
          };
          const chipBottomAnim = {
            opacity: fadeFast,
            transform: [{ translateX: at(i, [width * 0.95, 0, -width * 0.95]) }, { scale: at(i, [0.7, 1, 0.7]) }],
          };
          const eyebrowAnim = {
            opacity: fadeFast,
            transform: [{ translateX: at(i, [width * 0.5, 0, -width * 0.5]) }],
          };
          const headAnim = {
            opacity: fadeFast,
            transform: [{ translateX: at(i, [width * 0.35, 0, -width * 0.35]) }],
          };
          const accentAnim = {
            opacity: fadeFast,
            transform: [{ translateX: at(i, [width * 0.5, 0, -width * 0.5]) }, { scale: at(i, [0.92, 1, 0.92]) }],
          };
          const leadAnim = {
            opacity: fadeFast,
            transform: [{ translateX: at(i, [width * 0.7, 0, -width * 0.7]) }],
          };

          return (
            <View key={i} style={{ width, height, paddingTop: insets.top + 74 }}>
              <View style={[styles.stage, { height: outerD }]}>
                <Animated.View
                  style={[
                    styles.ringOuter,
                    { width: outerD, height: outerD, borderRadius: outerD / 2, backgroundColor: p.ring },
                    ringOuterAnim,
                  ]}
                />
                <Animated.View
                  style={[
                    styles.ringMid,
                    { width: midD, height: midD, borderRadius: midD / 2, borderColor: k.dash, borderStyle: 'dashed' },
                    ringMidAnim,
                  ]}
                />
                <Animated.View
                  style={[
                    styles.photoRing,
                    {
                      width: photoD,
                      height: photoD,
                      borderRadius: photoD / 2,
                      borderColor: k.photoBorder,
                    },
                    photoAnim,
                  ]}
                >
                  {nearby && <Image source={s.image} style={styles.fill} resizeMode="cover" />}
                </Animated.View>

                <Animated.View style={[styles.chipSlot, { top: 8, left: 18 }, chipTopAnim]}>
                  <Chip {...s.chipTop} accent={p.accent} isDark={isDark} />
                </Animated.View>
                <Animated.View style={[styles.chipSlot, { bottom: 8, right: 18 }, chipBottomAnim]}>
                  <Chip {...s.chipBottom} accent={p.accent} isDark={isDark} />
                </Animated.View>
              </View>

              <View style={styles.textBlock}>
                <Animated.Text style={[styles.eyebrow, { color: k.eyebrow[s.tone] }, eyebrowAnim]}>
                  {s.eyebrow}
                </Animated.Text>
                <Animated.Text style={[styles.headline, { color: ink }, headAnim]}>{s.title}</Animated.Text>
                <Animated.Text style={[styles.headlineAccent, { color: p.accent }, accentAnim]}>
                  {s.accent}
                </Animated.Text>
                <Animated.Text style={[styles.lead, { color: body }, leadAnim]}>{s.desc}</Animated.Text>
              </View>
            </View>
          );
        })}
      </Animated.ScrollView>

      {/* Footer lives outside the pages so the dots slide and morph continuously. */}
      <View style={[styles.bottomBlock, { paddingBottom: insets.bottom + spacing.lg }]} pointerEvents="box-none">
        <Animated.View
          style={[styles.footerRow, { opacity: notLastFade }]}
          pointerEvents={onLast ? 'none' : 'box-none'}
        >
          <View style={styles.dots}>
            {SLIDES.map((_, idx) => (
              <View key={idx} style={styles.dotSlot}>
                <View
                  style={[styles.dotBase, { backgroundColor: k.dot }]}
                />
                <Animated.View
                  style={[
                    styles.dotActive,
                    {
                      backgroundColor: ink,
                      opacity: at(idx, [0, 1, 0]),
                      transform: [{ scaleX: at(idx, [0.27, 1, 0.27]) }],
                    },
                  ]}
                />
              </View>
            ))}
          </View>
          <Pressable
            hitSlop={10}
            onPress={next}
            style={[
              styles.nextRing,
              {
                borderTopColor: ringColor(1),
                borderRightColor: ringColor(2),
                borderBottomColor: ringColor(3),
                borderLeftColor: ringColor(4),
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Next"
          >
            <View style={[styles.nextInner, { backgroundColor: k.btn }]}>
              <Ionicons name="arrow-forward" size={18} color="#fff" />
            </View>
          </Pressable>
        </Animated.View>

        <Animated.View
          style={[
            styles.lastBlock,
            {
              opacity: lastFade,
              transform: [{ translateY: lastFade.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
              paddingBottom: insets.bottom + spacing.lg,
            },
          ]}
          pointerEvents={onLast ? 'box-none' : 'none'}
        >
          <Pressable
            style={styles.ctaWide}
            onPress={() => {
              tapMedium();
              finish();
            }}
            accessibilityRole="button"
            accessibilityLabel="Get started"
          >
            <Text style={styles.ctaText}>Get Started →</Text>
          </Pressable>
          {!replay && (
            <Pressable
              style={styles.loginLink}
              hitSlop={8}
              onPress={() => leave('Login')}
              accessibilityRole="button"
              accessibilityLabel="I already have an account"
            >
              <Text style={[styles.loginLinkPlain, { color: body }]}>
                Already have an account? <Text style={[styles.loginLinkText, { color: ink }]}>Log in</Text>
              </Text>
            </Pressable>
          )}
        </Animated.View>
      </View>

      <View style={[styles.header, { top: insets.top + spacing.md }]} pointerEvents="box-none">
        <View style={styles.brand}>
          <View style={styles.logo}>
            <Image source={require('../../assets/logo-pan.png')} style={styles.logoImg} resizeMode="contain" />
          </View>
          <Text style={[styles.wordmark, { color: ink }]}>WeCooked</Text>
        </View>
        {!onLast && (
          <Pressable
            hitSlop={10}
            onPress={() => {
              tapLight();
              finish();
            }}
            accessibilityRole="button"
            accessibilityLabel={replay ? 'Close the tour' : 'Skip onboarding'}
          >
            <Text style={[styles.skipText, { color: body }]}>{replay ? 'Done' : 'Skip'}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  fill: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },

  header: {
    position: 'absolute',
    left: 0,
    right: 0,
    paddingHorizontal: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#fff',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoImg: { width: 30, height: 30 },
  wordmark: { fontFamily: typography.display.fontFamilyItalic, fontSize: 19 },
  skipText: { fontFamily: typography.body.semibold, fontSize: 13 },

  stage: { alignItems: 'center', justifyContent: 'center' },
  ringOuter: { position: 'absolute' },
  ringMid: { position: 'absolute', borderWidth: 1.5 },
  photoRing: { borderWidth: 5, overflow: 'hidden', backgroundColor: '#ddd' },

  chipSlot: { position: 'absolute', maxWidth: '78%' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 6,
    paddingLeft: 6,
    paddingRight: 12,
    borderRadius: radius.pill,
  },
  chipLight: {
    backgroundColor: '#fff',
    shadowColor: '#2a2f26',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  chipDark: {},
  chipIcon: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontFamily: typography.body.semibold, fontSize: 11.5, flexShrink: 1 },

  textBlock: { alignItems: 'center', paddingHorizontal: 34, marginTop: spacing.xxl },
  eyebrow: { fontFamily: typography.body.bold, fontSize: 10.5, letterSpacing: 1.6, marginBottom: spacing.sm },
  headline: {
    fontFamily: typography.display.fontFamilyBold,
    fontSize: 30,
    lineHeight: 36,
    textAlign: 'center',
  },
  headlineAccent: {
    fontFamily: typography.display.fontFamilyItalic,
    fontSize: 30,
    lineHeight: 36,
    textAlign: 'center',
  },
  lead: {
    fontFamily: typography.body.fontFamily,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: spacing.md,
  },

  bottomBlock: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 24 },
  footerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  dotSlot: { width: 14, height: 6, alignItems: 'center', justifyContent: 'center' },
  dotBase: { width: 6, height: 6, borderRadius: 3 },
  dotActive: { position: 'absolute', width: 22, height: 6, borderRadius: 3 },
  lastBlock: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 24 },
  nextRing: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextInner: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: SAGE_BTN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaWide: {
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: SAGE_BTN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: { fontFamily: typography.body.semibold, fontSize: 15, letterSpacing: 0.2, color: '#fff' },
  loginLink: { alignSelf: 'center', marginTop: spacing.md, paddingVertical: 4 },
  loginLinkPlain: { fontFamily: typography.body.semibold, fontSize: 12 },
  loginLinkText: { textDecorationLine: 'underline' },
});
