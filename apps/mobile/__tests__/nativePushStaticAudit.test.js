const fs = require('fs');
const path = require('path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

it('keeps native push secure, provider-bound, guarded, and free of scheduling or payload navigation', () => {
  const context = read('src/context/NativePushContext.js');
  const store = read('src/notifications/pushInstallationStore.js');
  const auth = read('src/context/AuthContext.js');
  const config = read('app.config.js');
  const packageJson = JSON.parse(read('package.json'));
  expect(context).toContain('markNotificationRead(data.notificationId)');
  expect(context).toContain('sessionIdentity');
  expect(context).toContain('localSessionRevision');
  expect(context).not.toContain('authGeneration');
  expect(context).toContain('responseOperationRef.current === operation');
  expect(context).toContain('while (mountedRef.current && !stateRef.current.authReady)');
  expect(context).toContain('if (responseKey(last) === key) await Notifications.clearLastNotificationResponseAsync()');
  expect(context).toContain('projectId: PROJECT_ID');
  expect(context).toContain('shouldSetBadge: false');
  expect(context).toContain('getExpoPushTokenAsync');
  expect(context).not.toMatch(/scheduleNotificationAsync|URL\.openURL|data\.route|data\.url/);
  expect(store).toContain("wecooked.pushInstallation.v1");
  expect(store).not.toMatch(/AsyncStorage|localStorage/);
  expect(config).toContain('enableBackgroundRemoteNotifications: false');
  expect(config).not.toMatch(/SCHEDULE_EXACT_ALARM/);
  expect(packageJson.dependencies['expo-notifications']).toBe('~57.0.17');
  expect(packageJson.dependencies['expo-constants']).toBe('~57.0.17');
  expect(packageJson.dependencies['expo-secure-store']).toBe('~57.0.3');
  expect(packageJson.dependencies).not.toHaveProperty('@react-native-async-storage/async-storage-push');
  expect(auth.indexOf('cleanPushForSession(session)')).toBeLessThan(auth.indexOf('await authService.logout()'));
  expect(auth.indexOf('cleanPushForSession(session)')).toBeLessThan(auth.indexOf('await authService.logoutAll()'));
  expect(auth).toContain('runBeforePushLogout({ localOnly: true })');
  expect(auth).toContain('authService.getLocalSessionRevision() === session.localSessionRevision');
  expect(auth).toContain('timeoutId = setTimeout(resolve, 1500)');
  expect(auth).toContain('clearTimeout(timeoutId)');
});

it('keeps web unsupported before reconciliation, listeners, permissions, or secure storage', () => {
  const context = read('src/context/NativePushContext.js');
  const store = read('src/notifications/pushInstallationStore.js');
  expect(context).toContain("const IS_NATIVE = Platform.OS === 'ios' || Platform.OS === 'android'");
  expect(context).toContain("useState(IS_NATIVE ? 'checking' : 'unsupported')");
  expect(context).toContain("if (!IS_NATIVE) { setStatus('unsupported'); return; }");
  expect(context).toMatch(/useEffect\(\(\) => \{\s*if \(!IS_NATIVE\) return undefined;\s*setBeforePushLogout/);
  expect(context).toMatch(/useEffect\(\(\) => \{\s*if \(!IS_NATIVE\) return undefined;\s*const tokenSubscription/);
  expect(store).toContain("if (!IS_NATIVE) return { kind: 'unsupported' }");
});
