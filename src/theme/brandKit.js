import React from 'react';
import Svg, { Path, Circle, Line } from 'react-native-svg';

// Shared visual language for the WeCooked onboarding flow (Landing +
// Login) — matches the app-wide "Noir & Ember" theme in src/theme/theme.js.
export const COLORS = {
  cream: '#121212',
  creamCard: '#1C1C1E',
  greenBright: '#F0A155',
  greenMid: '#F5821F',
  greenChef: '#D66F12',
  greenLink: '#F5821F',
  greenDark: '#FFFFFF',
  ink: '#FFFFFF',
  inkSoft: '#B4B4B9',
  inkFaint: '#7C7C82',
  hairline: '#2A2A2E',
};

// ---- small reusable icons -------------------------------------------------

export function LeafIcon({ size = 20, color = COLORS.greenMid }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4 20c8-1 14-7 15-15C11 6 5 12 4 20Z" fill={color} />
    </Svg>
  );
}

export function SparkleIcon({ size = 12, color = '#E8B84B' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 2l1.8 7.2L21 11l-7.2 1.8L12 20l-1.8-7.2L3 11l7.2-1.8L12 2Z" fill={color} />
    </Svg>
  );
}

export function HeartIcon({ size = 16, color = COLORS.greenBright }) {
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
