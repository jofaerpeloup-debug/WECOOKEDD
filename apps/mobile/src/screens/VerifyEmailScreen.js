import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { typography, spacing } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import { BowlMark } from '../theme/brandKit';
import Button from '../components/Button';
import { useAuth } from '../context/AuthContext';
import * as authService from '../api/authService';
import { getAuthErrorMessage } from '../api/errorMessages';

// Reached only via the wecooked://verify-email?token=... deep link (see
// RootNavigator's `linking` config). The token lives ONLY in route.params —
// transient navigation state — for the lifetime of this screen; it is never
// written to AsyncStorage/SecureStore and never logged. Registered in BOTH
// RootNavigator stacks (authenticated and unauthenticated) so it is reachable
// regardless of whether the tapping device currently has a live session —
// email verification carries no login-gate of its own.
export default function VerifyEmailScreen({ navigation, route }) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors, isDark);
  const { isLoggedIn, user, refreshUser } = useAuth();

  const rawToken = route?.params?.token;
  const token = typeof rawToken === 'string' ? rawToken.trim() : '';
  const tokenMissing = token.length === 0;

  // 'verifying' | 'success' | 'error' | 'missing'
  const [phase, setPhase] = useState(tokenMissing ? 'missing' : 'verifying');
  const [error, setError] = useState(null);
  const [resendState, setResendState] = useState('idle'); // idle | sending | sent
  const mountedRef = useRef(true);
  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  useEffect(() => {
    if (tokenMissing) return;
    let cancelled = false;

    (async () => {
      try {
        await authService.verifyEmail(token);
        if (cancelled || !mountedRef.current) return;
        // Logged-in device: reconcile the authoritative user so
        // emailVerified flips to true locally without a fake local write.
        if (isLoggedIn) {
          try {
            await refreshUser();
          } catch {
            // The verification itself already succeeded server-side; a
            // transient failure to refresh /users/me right now just means the
            // UI will pick up emailVerified on its next natural refresh.
          }
        }
        if (!cancelled && mountedRef.current) setPhase('success');
      } catch (err) {
        if (cancelled || !mountedRef.current) return;
        setError(getAuthErrorMessage(err));
        setPhase('error');
      }
    })();

    return () => {
      cancelled = true;
    };
    // Intentionally run once per mounted token — this is a link-consumption
    // effect, not a live subscription to isLoggedIn/refreshUser identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, tokenMissing]);

  // reset(), not navigate() — see ResetPasswordScreen's goContinue for why:
  // in React Navigation v7, navigate(name) pushes a new instance instead of
  // popping to an existing one unless `name` is already the focused route,
  // so it would leave this screen in the stack's history underneath the
  // target rather than discarding it.
  const goContinue = () => {
    navigation.reset({
      index: 0,
      routes: [{ name: isLoggedIn ? 'MainTabs' : 'Login' }],
    });
  };

  const resend = async () => {
    if (!isLoggedIn || !user?.email || resendState === 'sending') return;
    setResendState('sending');
    try {
      await authService.resendVerification(user.email);
    } finally {
      if (mountedRef.current) setResendState('sent');
    }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.content, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl }]}>
        <View style={styles.logoRow}>
          <BowlMark size={34} ring={false} color={colors.sageDeep} accent={colors.stone} />
          <Text style={styles.wordmark}>WeCooked</Text>
        </View>

        {phase === 'missing' && (
          <>
            <Text style={styles.title} accessibilityRole="header">
              Link incomplete
            </Text>
            <Text style={styles.subtitle}>
              This verification link is missing or incomplete. Request a new one from your account
              settings.
            </Text>
            <Button
              title={isLoggedIn ? 'Back to app' : 'Back to Login'}
              onPress={goContinue}
              style={{ marginTop: spacing.lg }}
            />
          </>
        )}

        {phase === 'verifying' && (
          <>
            <Text style={styles.title} accessibilityRole="header">
              Verifying your email…
            </Text>
            <ActivityIndicator size="small" color={colors.sageDeep} style={{ marginTop: spacing.lg }} />
          </>
        )}

        {phase === 'success' && (
          <>
            <Text style={styles.title} accessibilityRole="header">
              Email verified
            </Text>
            <Text style={styles.subtitle}>Your email address has been verified.</Text>
            <Button
              title={isLoggedIn ? 'Continue' : 'Go to Login'}
              onPress={goContinue}
              style={{ marginTop: spacing.lg }}
            />
          </>
        )}

        {phase === 'error' && (
          <>
            <Text style={styles.title} accessibilityRole="header">
              Verification failed
            </Text>
            <Text style={styles.statusError} accessibilityLiveRegion="polite">
              {error}
            </Text>
            {isLoggedIn && user?.email ? (
              <Button
                title={resendState === 'sent' ? 'New link sent' : 'Send a new link'}
                onPress={resend}
                loading={resendState === 'sending'}
                disabled={resendState !== 'idle'}
                variant="outline"
                style={{ marginTop: spacing.lg }}
              />
            ) : null}
            <Button
              title={isLoggedIn ? 'Back to app' : 'Back to Login'}
              onPress={goContinue}
              variant={isLoggedIn && user?.email ? 'ghost' : 'primary'}
              style={{ marginTop: spacing.md }}
            />
          </>
        )}
      </View>
    </View>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    content: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.xl },
    logoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.xl },
    wordmark: {
      fontFamily: typography.display.fontFamily,
      fontSize: typography.sizes.xl,
      color: colors.ink,
    },
    title: {
      fontFamily: typography.display.fontFamily,
      fontSize: typography.sizes.xxl,
      color: colors.ink,
      marginBottom: spacing.xs,
    },
    subtitle: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.base,
      color: colors.inkSoft,
    },
    statusError: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.sm,
      lineHeight: 18,
      color: colors.error,
      marginTop: spacing.sm,
    },
  });
}
