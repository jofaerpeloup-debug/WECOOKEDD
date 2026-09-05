// Local, on-device cook reminders for the meal plan.
//
// These are OS-scheduled notifications (expo-notifications' WEEKLY trigger),
// not push notifications — no server, no network, and they still fire when the
// app is closed because the operating system owns the schedule. Web has no
// scheduling API, so the meal-plan UI hides reminders there.
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

export const remindersSupported = Platform.OS !== 'web';

// Show the banner + play a sound even if the app is foregrounded.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// Sunday = 1 … Saturday = 7 (expo-notifications WEEKLY trigger convention).
const WEEKDAY = {
  Sunday: 1,
  Monday: 2,
  Tuesday: 3,
  Wednesday: 4,
  Thursday: 5,
  Friday: 6,
  Saturday: 7,
};

let channelReady = false;
async function ensureChannel() {
  if (Platform.OS !== 'android' || channelReady) return;
  await Notifications.setNotificationChannelAsync('meal-reminders', {
    name: 'Cook reminders',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    sound: 'default',
  });
  channelReady = true;
}

// Prompts for permission the first time it's actually needed. Returns true if
// we're allowed to post notifications.
export async function ensureNotificationPermission() {
  if (!remindersSupported) return false;
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (current.canAskAgain === false && current.status === 'denied') return false;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

function weeklyTrigger(day, hour, minute) {
  return {
    type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
    weekday: WEEKDAY[day] ?? 2,
    hour,
    minute,
    ...(Platform.OS === 'android' ? { channelId: 'meal-reminders' } : null),
  };
}

// Schedules a weekly reminder for `day` at `hour:minute`. Returns
// { id, nextDate } — store `id` so the reminder can be cancelled/replaced.
export async function scheduleMealReminder({ day, hour, minute, title }) {
  if (!remindersSupported) return { id: null, nextDate: null };
  await ensureChannel();
  const trigger = weeklyTrigger(day, hour, minute);
  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Time to cook! 🍳',
      body: `It's time to cook ${title}!`,
      sound: 'default',
    },
    trigger,
  });
  let nextDate = null;
  try {
    const ts = await Notifications.getNextTriggerDateAsync(trigger);
    if (ts) nextDate = new Date(ts);
  } catch {
    // getNextTriggerDateAsync isn't critical — the reminder is still scheduled.
  }
  return { id, nextDate };
}

export async function cancelMealReminder(notifId) {
  if (!notifId || !remindersSupported) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(notifId);
  } catch {
    // Already fired or removed — nothing to do.
  }
}

// Fires a one-off notification a few seconds from now so the user can confirm
// that notification delivery works on their device / build.
export async function sendTestReminder(title) {
  if (!remindersSupported) return false;
  const granted = await ensureNotificationPermission();
  if (!granted) return false;
  await ensureChannel();
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Test reminder ✅',
      body: title ? `This is how "${title}" will look.` : 'Cook reminders are working.',
      sound: 'default',
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 8,
      repeats: false,
      ...(Platform.OS === 'android' ? { channelId: 'meal-reminders' } : null),
    },
  });
  return true;
}

// How many reminders the OS currently has queued (diagnostic).
export async function scheduledCount() {
  if (!remindersSupported) return 0;
  try {
    const all = await Notifications.getAllScheduledNotificationsAsync();
    return all.length;
  } catch {
    return 0;
  }
}
