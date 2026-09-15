import { useCallback, useEffect } from 'react';
import { Platform } from 'react-native';
import { useAudioPlayer, setAudioModeAsync } from 'expo-audio';

const SOURCE = require('../../assets/timer-done.wav');

// Returns a play() function for the short Cook Mode timer chime. Native-focused:
// on web the browser blocks sound started from a setInterval callback, and any
// playback failure (audio focus, older device) is swallowed so the timer never
// crashes.
export default function useChime() {
  const player = useAudioPlayer(SOURCE);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    // Ring even if the phone is on silent — it's a kitchen timer.
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
  }, []);

  return useCallback(() => {
    if (Platform.OS === 'web') return;
    try {
      player.seekTo(0);
      player.play();
    } catch {
      // ignore — the haptic + banner still fire
    }
  }, [player]);
}
