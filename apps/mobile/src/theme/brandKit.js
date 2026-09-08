import React from 'react';
import Svg, { Path, Circle, Line, Rect } from 'react-native-svg';

// Shared visual language for the WeCooked entry flow (Landing + Onboarding +
// Login + Register) — the "Sage & Stone" system in src/theme/theme.js.
//
// NOTE: unlike the rest of the app, these screens consume COLORS as a fixed
// palette rather than going through useTheme(), so the entry flow renders in
// the light Sage & Stone values in both modes. Making it mode-reactive is a
// screen-level change and is deliberately out of scope here.
//
// The green* / cream* key names are retained because the current entry
// screens import them; each one now points at its Sage & Stone equivalent:
//   greenBright -> sage (mid)   greenMid/greenLink -> sageDeep (primary)
//   greenChef   -> sageDeeper   greenDark          -> ink
export const COLORS = {
  // --- existing keys, remapped onto Sage & Stone -------------------------
  cream: '#FAF9F6',       // app background
  creamCard: '#FFFFFF',   // cards, inputs, sheets
  greenBright: '#6B8069', // sage mid
  greenMid: '#4A5D4E',    // sage deep — primary
  greenChef: '#3C4B3F',   // sage deeper — pressed / underline
  greenLink: '#4A5D4E',   // links
  greenDark: '#2A2F28',   // ink on cream
  ink: '#2A2F28',
  inkSoft: '#5B6058',
  inkFaint: '#8C8577',
  hairline: '#DAD3C4',

  // --- Sage & Stone names (teammate reference) ---------------------------
  forest: '#4A5D4E',
  beige: '#5B6058',
  muted: '#8C8577',
  terracotta: '#B15A3E',
  terracottaDeep: '#9A4A33',
  saffron: '#C9962E',
};

// ---- small reusable icons -------------------------------------------------

export function LeafIcon({ size = 20, color = COLORS.greenMid }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4 20c8-1 14-7 15-15C11 6 5 12 4 20Z" fill={color} />
    </Svg>
  );
}

export function SparkleIcon({ size = 12, color = COLORS.saffron }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 2l1.8 7.2L21 11l-7.2 1.8L12 20l-1.8-7.2L3 11l7.2-1.8L12 2Z" fill={color} />
    </Svg>
  );
}

export function HeartIcon({ size = 16, color = COLORS.terracotta }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 20s-7-4.4-9.5-9C1 7.8 2.7 4.5 6 4c2-.3 4 .7 6 3 2-2.3 4-3.3 6-3 3.3.5 5 3.8 3.5 7-2.5 4.6-9.5 9-9.5 9Z"
        fill={color}
      />
    </Svg>
  );
}

export function SquiggleUnderline({ width = 118, color = COLORS.greenChef }) {
  const height = (width / 118) * 10;
  return (
    <Svg width={width} height={height} viewBox="0 0 118 10" fill="none">
      <Path
        d="M2 6c10-6 20-6 29 0s20 6 29 0 20-6 29 0 20 6 27 0"
        stroke={color}
        strokeWidth={3}
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  );
}

export function LogoBadge({ size = 38 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40" fill="none">
      <Circle cx="20" cy="20" r="17.5" stroke={COLORS.greenMid} strokeWidth={2.4} />
      <Path
        d="M13 22c0-4 3-6.5 7-6.5s7 2.5 7 6.5"
        stroke={COLORS.greenMid}
        strokeWidth={2}
        strokeLinecap="round"
        fill="none"
      />
      <Path d="M14 22h12v1.5c0 2-2 3.5-6 3.5s-6-1.5-6-3.5V22Z" fill={COLORS.greenMid} />
      <Circle cx="24.5" cy="15.5" r="4" stroke={COLORS.greenMid} strokeWidth={1.8} fill={COLORS.cream} />
      <Line x1="27.3" y1="18.3" x2="30" y2="21" stroke={COLORS.greenMid} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

// ---- Sage & Stone presentation marks (teammate reference) -----------------
// Additive only: nothing above is replaced. These are not wired into any
// screen yet — screens adopt them in a later phase.

// Bowl with steam wisps, in a circular outline — the app mark on the
// Onboarding welcome and the Login header.
export function BowlMark({ size = 88, ring = true, color = COLORS.forest, accent = COLORS.saffron }) {
  const s = size;
  return (
    <Svg width={s} height={s} viewBox="0 0 88 88" fill="none">
      {ring && (
        <Circle cx="44" cy="44" r="43" stroke={accent} strokeOpacity={0.35} strokeWidth={1.4} />
      )}
      <Path d="M24 42h40v3c0 10-9 17-20 17s-20-7-20-17v-3Z" fill={color} />
      <Path d="M22 42h44" stroke={color} strokeWidth={3} strokeLinecap="round" />
      <Path d="M36 24c-2 3-2 6 0 9" stroke={color} strokeWidth={3} strokeLinecap="round" />
      <Path d="M44 20c-2 3-2 7 0 10" stroke={color} strokeWidth={3} strokeLinecap="round" />
      <Path d="M52 24c-2 3-2 6 0 9" stroke={color} strokeWidth={3} strokeLinecap="round" />
    </Svg>
  );
}

export function PlayIcon({ size = 14, color = COLORS.cream }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d="M6 4l14 8-14 8V4z" />
    </Svg>
  );
}

export function BookIcon({ size = 22, color = COLORS.saffron }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="6" y="2" width="12" height="20" rx="2" stroke={color} strokeWidth={1.6} />
      <Path d="M6 9h12M6 14h12" stroke={color} strokeWidth={1.6} />
    </Svg>
  );
}

export function ArrowRightIcon({ size = 20, color = COLORS.saffron }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4 12h16M13 6l7 6-7 6" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

// Brand marks for a future "or continue with" row. Presentation only — these
// carry no auth behaviour, no client IDs and no navigation.
export function GoogleGlyph({ size = 18 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z" />
      <Path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z" />
      <Path fill="#FBBC05" d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z" />
      <Path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z" />
    </Svg>
  );
}

export function FacebookGlyph({ size = 18, color = '#1877F2' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        fill={color}
        d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"
      />
    </Svg>
  );
}
