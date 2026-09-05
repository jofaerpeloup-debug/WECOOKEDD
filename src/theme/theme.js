// WeCooked design tokens — "Sage & Stone" palette
//   Sage Deep    #4A5D4E  (primary — the one token fixed across light & dark)
//   Warm Cream   #FAF9F6  (background)
//   Saffron      #C9962E  (secondary accent — eyebrows, badges, timers, ratings)
//   Clay         #B15A3E  (favorite heart / destructive / warm highlight)
//
// Every token name is shared by both palettes so every screen (all on
// useTheme()) repaints when the mode switches:
//   light = "Sage & Stone"        — cream ground, deep-sage primary
//   dark  = "Sage & Stone Night"  — near-black sage ground, same deep-sage primary
//
// Values mirror the WeCooked Admin colour system (the .exp.direct token set):
// --cream, --parchment, --field-bg, --stone-light, --sage-deep/-mid/-light,
// --ink, --stone, --saffron, --clay.

const sageStone = {
  cream: '#FAF9F6',       // --cream: app background (warm cream)
  creamDeep: '#F1ECE1',   // --parchment: secondary surfaces / chips / hover
  paper: '#FFFFFF',       // --field-bg: cards, inputs, sheets
  ink: '#2A2F28',          // --ink: primary text
  inkSoft: '#5B6058',      // secondary text
  inkFaint: '#8C8577',     // --stone: tertiary / placeholder / eyebrow
  hairline: '#DAD3C4',    // --stone-light: borders, dividers

  onAccent: '#FAF9F6',    // text/icons on deep-sage surfaces

  // Sage system (brand primary)
  sagePale: '#E9EFE7',    // pale sage fills (icon badges, chips)
  sageLight: '#C0D5C2',   // --sage-light: soft sage blocks
  sage: '#6B8069',        // --sage-mid: mid sage — badges, secondary, section icons
  sageDeep: '#4A5D4E',    // --sage-deep: primary buttons, active tab, headline accent, wordmark
  sageDeeper: '#3C4B3F',  // pressed states

  // Saffron accent
  stone: '#C9962E',       // --saffron
  stoneLight: '#F3E7CC',

  // Clay — favorite heart + occasional warm highlight
  favorite: '#B15A3E',    // --clay

  // Semantic
  success: '#4A5D4E',
  successBg: '#E4EDE4',
  warning: '#A9781C',
  warningBg: '#F3E7CC',
  error: '#B15A3E',
  errorBg: '#F4E1DA',
  info: '#5B7C9E',
  infoBg: '#E7EDF2',

  scoreHigh: '#4A5D4E',
  scoreMid: '#C9962E',

  overlay: 'rgba(30, 33, 29, 0.5)',
  shadow: 'rgba(42, 47, 40, 0.12)',
};

const sageStoneNight = {
  cream: '#1E211D',       // --cream (dark)
  creamDeep: '#262B24',   // --parchment (dark)
  paper: '#2F342B',       // --field-bg (dark)
  ink: '#EDEAE0',          // --ink (dark)
  inkSoft: '#B4B6AC',
  inkFaint: '#A39C8C',     // --stone (dark)
  hairline: '#3A392F',    // --stone-light (dark)

  onAccent: '#FAF9F6',    // deep-sage stays fixed, so its text stays cream

  sagePale: '#2A342A',
  sageLight: '#33402F',
  sage: '#7C9478',        // --sage-mid (dark)
  sageDeep: '#4A5D4E',    // --sage-deep: fixed across modes
  sageDeeper: '#3C4B3F',

  stone: '#D9A64B',       // --saffron (dark)
  stoneLight: 'rgba(217,166,75,0.16)',

  favorite: '#C97558',    // --clay (dark)

  success: '#7C9478',
  successBg: 'rgba(124,148,120,0.16)',
  warning: '#D9A64B',
  warningBg: 'rgba(217,166,75,0.16)',
  error: '#C97558',
  errorBg: '#34221C',
  info: '#7CA3C0',
  infoBg: '#1C2530',

  scoreHigh: '#7C9478',
  scoreMid: '#D9A64B',

  overlay: 'rgba(0, 0, 0, 0.6)',
  shadow: 'rgba(0, 0, 0, 0.5)',
};

export const lightColors = sageStone;
export const darkColors = sageStoneNight;

// Non-reactive default for any file that imports `colors` directly. Every
// screen goes through useTheme(); this is a safety net.
export const colors = lightColors;

export const typography = {
  display: {
    fontFamily: 'PlayfairDisplay_600SemiBold',
    fontFamilyItalic: 'PlayfairDisplay_600SemiBold_Italic',
    fontFamilyBold: 'PlayfairDisplay_700Bold',
  },
  body: {
    fontFamily: 'WorkSans_400Regular',
    medium: 'WorkSans_500Medium',
    semibold: 'WorkSans_600SemiBold',
    bold: 'WorkSans_700Bold',
  },
  sizes: {
    xs: 11,
    sm: 12,
    base: 14,
    md: 15,
    lg: 17,
    xl: 20,
    xxl: 26,
    display: 32,
    displayLg: 36,
  },
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  xxxl: 36,
};

export const radius = {
  sm: 8,
  md: 14,
  lg: 18,
  xl: 22,
  pill: 999,
};

export function buildShadow(activeColors) {
  return {
    card: {
      shadowColor: activeColors.shadow,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 1,
      shadowRadius: 12,
      elevation: 3,
    },
    soft: {
      shadowColor: activeColors.shadow,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 1,
      shadowRadius: 6,
      elevation: 2,
    },
  };
}

export const shadow = buildShadow(lightColors);

export default { colors, lightColors, darkColors, typography, spacing, radius, shadow, buildShadow };
