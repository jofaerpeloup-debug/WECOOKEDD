const fs = require('fs');
const path = require('path');

const MOBILE = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(MOBILE, 'src', relative), 'utf8');

describe('MOBILE-NOTIF1 static contract', () => {
  it('mounts exactly one authenticated provider while preserving parallel provider wiring', () => {
    const app = fs.readFileSync(path.join(MOBILE, 'App.js'), 'utf8');
    expect((app.match(/<NotificationsProvider>/g) || [])).toHaveLength(1);
    expect(app.indexOf('<AuthProvider>')).toBeLessThan(app.indexOf('<NotificationsProvider>'));
    expect(app.indexOf('<NotificationsProvider>')).toBeLessThan(app.indexOf('<SearchHistoryProvider>'));
    expect(app).toMatch(/<NotificationsProvider>[\s\S]*<SearchHistoryProvider>[\s\S]*<FavoritesProvider>/);
  });

  it('uses only the real authenticated notification service/context path', () => {
    const bounded = [
      read('api/notificationService.js'),
      read('context/NotificationsContext.js'),
      read('components/NotificationsDropdown.js'),
      read('components/TopBar.js'),
      read('screens/ProfileScreen.js'),
      read('screens/NotificationsScreen.js'),
    ].join('\n');
    expect(bounded).not.toMatch(/AsyncStorage|mockData|notificationSettings|expo-notifications|Notifications\.requestPermissions|pushToken|deviceToken|scheduleNotification|setInterval|createNotification/i);
    expect(read('api/notificationService.js')).not.toMatch(/\bfetch\s*\(/);
    expect(read('context/NotificationsContext.js')).toMatch(/useAuth\(\)/);
    expect(read('context/NotificationsContext.js')).toMatch(/ownerRef|generationRef|listGenerationRef|mutationVersionRef|listTokenRef|continuationTokenRef/);
  });

  it('wires authoritative bells on Home and Profile with the shared real dropdown', () => {
    const topBar = read('components/TopBar.js');
    const profile = read('screens/ProfileScreen.js');
    expect(topBar).toMatch(/useNotifications\(\)/);
    expect(topBar).toMatch(/Notifications, \$\{unreadCount\} unread/);
    expect(topBar).toMatch(/unreadCount > 0/);
    expect(topBar).toMatch(/<NotificationsDropdown/);
    expect(profile).toMatch(/useNotifications\(\)/);
    expect(profile).toMatch(/Notifications, \$\{unreadCount\} unread/);
    expect(profile).toMatch(/unreadCount > 0/);
    expect(profile).toMatch(/<NotificationsDropdown/);
    expect(profile).not.toMatch(/onPress=\{\(\) => navigation\.navigate\('Notifications'\)\}/);
  });

  it('freezes exact empty copy, anchored operations, and fixed safe action mapping', () => {
    const dropdown = read('components/NotificationsDropdown.js');
    const action = read('navigation/notificationAction.js');
    expect(dropdown).toContain("You're all caught up. Real activity — saves, cooked dishes, cook reminders — will show up here.");
    expect(dropdown).toMatch(/const anchorId = notifications\[0\]\.id/);
    expect(dropdown).toMatch(/markAllRead\(anchorId\)/);
    expect(dropdown).toMatch(/archiveAll\(anchorId\)/);
    expect(action).toMatch(/action\?\.kind === 'recipe'/);
    expect(action).toMatch(/action\?\.kind === 'communityPost'/);
    expect(action).toMatch(/action\?\.kind === 'mealPlan'/);
    expect(dropdown).not.toMatch(/navigation\.navigate\(notification\.action|action\.route|action\.url/);
  });

  it('renders exactly the five frozen preference controls and removes the legacy presentation', () => {
    const screen = read('screens/NotificationsScreen.js');
    for (const text of [
      'Push Notifications', 'Alerts on this device',
      'Email Alerts', 'Summaries and receipts',
      'Recipe Suggestions', 'New picks based on what you cook',
      'Weekly Digest', 'Top recipes every Sunday',
      'Cooking Reminders', 'Nudges to try something new',
      'Choose what WeCooked can notify you about.',
    ]) expect(screen).toContain(text);
    expect(screen).not.toMatch(/Allow notifications|Turn WeCooked notifications on or off/);
    expect(screen).toMatch(/setPreference\(setting\.key, value\)/);
  });
});
