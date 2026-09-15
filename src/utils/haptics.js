import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

// Small wrappers so screens don't each import expo-haptics and repeat the
// web guard. Haptics are a native-only nicety — no-op on web, and any failure
// (older device, permissions) is swallowed so a tap never throws.
const isWeb = Platform.OS === 'web';

function run(fn) {
  if (isWeb) return;
  try {
    const r = fn();
    if (r && typeof r.catch === 'function') r.catch(() => {});
  } catch {}
}

// A light tick — tab switches, toggles, selecting a chip.
export const tapLight = () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));

// A firmer tap — primary buttons, saving, adding to a plan.
export const tapMedium = () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));

// Completion — finishing a cook step, creating a collection.
export const notifySuccess = () =>
  run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));

// Something went wrong / destructive confirm.
export const notifyWarning = () =>
  run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));

export default { tapLight, tapMedium, notifySuccess, notifyWarning };
