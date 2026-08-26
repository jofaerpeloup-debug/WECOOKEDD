// WeCooked design tokens
// Two palettes share the same shape so every screen (all on useTheme())
// repaints correctly when the mode switches:
//  - "Sage & Stone": the original cream/sage light palette.
//  - "Noir & Ember": a dark, orange-accented palette.

const sageAndStone = {
  // Core neutrals
  cream: '#FAF9F6',       // primary app background
  creamDeep: '#F4F1EA',   // secondary/inset surfaces
  paper: '#FFFFFF',       // cards, inputs, sheets
  ink: '#232620',          // primary text (warm near-black, not pure black)
  inkSoft: '#5B6058',      // secondary text
  inkFaint: '#9B9F96',     // tertiary / placeholder text
  hairline: '#E7E4DC',    // borders, dividers

  // Text/icon color for use on top of accent-colored (sage) surfaces
  onAccent: '#FFFFFF',

  // Sage system (brand primary)
  sagePale: '#DCE7DD',    // pale sage fills (pills, chip backgrounds)
  sageLight: '#C0D5C2',   // login panel, soft blocks
  sage: '#8FA88F',        // mid sage — badges, secondary buttons
  sageDeep: '#4A5D4E',    // primary buttons, active nav, headlines accent
  sageDeeper: '#3A4A3E',  // pressed states

  // Stone / clay accent (used sparingly: swap ratios, warm highlights)
  stone: '#B08968',
  stoneLight: '#E8DCC8',

  // Semantic
  success: '#4A5D4E',
  successBg: '#E4EDE4',
  warning: '#B08968',
  warningBg: '#F4E9DA',
  error: '#B1503F',
  errorBg: '#F4E1DC',
  info: '#5B7C9E',
  infoBg: '#E4EBF2',

  // Confidence / score tiers (molecular precision screens)
  scoreHigh: '#4A5D4E',
  scoreMid: '#B08968',

  overlay: 'rgba(35, 38, 32, 0.55)',
  shadow: 'rgba(35, 38, 32, 0.12)',
};

const noir = {
  // Core neutrals
  cream: '#121212',       // primary app background (near-black)
  creamDeep: '#1A1A1A',   // secondary/inset surfaces (search bars, chip fills)
  paper: '#1C1C1E',       // cards, inputs, sheets
  ink: '#FFFFFF',          // primary text
  inkSoft: '#B4B4B9',     // secondary text
  inkFaint: '#7C7C82',    // tertiary / placeholder text
  hairline: '#2A2A2E',    // borders, dividers

  // Text/icon color for use on top of accent-colored (orange) surfaces
  onAccent: '#FFFFFF',

  // Ember system (brand primary — was "sage")
  sagePale: '#241A10',    // dark accent-tinted fills (pills, chip backgrounds)
  sageLight: '#2E2118',   // soft blocks
  sage: '#F0A155',        // mid accent — badges, secondary text
  sageDeep: '#F5821F',    // primary buttons, active nav, headline accent
  sageDeeper: '#D66F12',  // pressed states

  // Gold accent (used sparingly: swap ratios, secondary highlights)
  stone: '#E0A458',
  stoneLight: '#2B2013',

  // Semantic
  success: '#3DD16F',
  successBg: '#12291B',
  warning: '#E0A458',
  warningBg: '#332714',
  error: '#F0544E',
  errorBg: '#33191A',
  info: '#5B9BD5',
  infoBg: '#16232F',

  // Confidence / score tiers (molecular precision screens)
  scoreHigh: '#3DD16F',
  scoreMid: '#E0A458',

  overlay: 'rgba(0, 0, 0, 0.65)',
  shadow: 'rgba(0, 0, 0, 0.5)',
};

export const lightColors = sageAndStone;
export const darkColors = noir;

// Kept as a plain, non-reactive default so nothing breaks if a file imports
// `colors` directly instead of going through useTheme(). Every screen in
// this app has been converted to useTheme(); this export exists as a
// safety net for future files, not the source of truth.
export const colors = lightColors;

export const typography = {
  // Display/serif: used for hero headlines, screen titles like
  // "Molecular Precision.", "Good Morning, Chef Ninong ry.", recipe titles.
  display: {
    fontFamily: 'PlayfairDisplay_700Bold',
    fontFamilyItalic: 'PlayfairDisplay_600SemiBold_Italic',
  },
  // Body/sans: UI chrome, labels, buttons, inputs, nav.
  body: {
    fontFamily: 'Inter_400Regular',
    medium: 'Inter_500Medium',
    semibold: 'Inter_600SemiBold',
    bold: 'Inter_700Bold',
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
  md: 12,
  lg: 18,
  xl: 24,
  pill: 999,
};

// shadowColor needs to track the active palette, so this is a function of
// the current colors rather than a static export.
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
