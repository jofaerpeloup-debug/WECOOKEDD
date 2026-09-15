import React from 'react';
import { Image } from 'react-native';

// One wrapper for every photo in the app, so there's a single place to tune
// image behaviour. It uses React Native's own <Image>: expo-image was silently
// failing to paint in Expo Go on this SDK — the same class of bug this project
// already hit with <ImageBackground>. See feedback_imagebackground_bug.
//
// `contentFit` / `transition` / `cachePolicy` are accepted and ignored so the
// old call sites don't need touching if expo-image is revisited later.
export default function AppImage({
  resizeMode = 'cover',
  contentFit,
  transition,
  cachePolicy,
  ...rest
}) {
  return <Image resizeMode={resizeMode} {...rest} />;
}
