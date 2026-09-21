import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { typography, spacing } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import { BowlMark } from '../theme/brandKit';
import Input, { PasswordRequirements } from '../components/Input';
import Button from '../components/Button';
import { useAuth } from '../context/AuthContext';
import * as authService from '../api/authService';
import {
  getAuthErrorMessage,
  getAuthFieldErrors,
  getNewPasswordValidationError,
} from '../api/errorMessages';

// Reached only via the wecooked://reset-password?token=... deep link (see
// RootNavigator's `linking` config). The token lives ONLY in route.params —
// transient navigation state — for the lifetime of this screen. It is never
// written to AsyncStorage, SecureStore, or any other persistent store, and is
// never logged.
export default function ResetPasswordScreen({ navigation, route }) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors, isDark);
  const { isLoggedIn, endLocalSession } = useAuth();

  // route.params can be missing entirely (screen opened with no link at all)
  // or carry a malformed/empty token (a stale, hand-edited, or truncated
  // link) — both are treated as the same "this link doesn't work" state,
  // never as a crash.
  const rawToken = route?.params?.token;
  const token = typeof rawToken === 'string' ? rawToken.trim() : '';
  const tokenMissing = token.length === 0;

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  // Mirrors VerifyEmailScreen's goContinue. Uses reset(), not navigate(): in
  // React Navigation v7, navigate(name) only reuses an EXISTING route in the
  // stack when `name` is the currently-focused route — otherwise it pushes a
  // new instance (see @react-navigation/routers StackRouter's NAVIGATE
  // handler). Since this screen itself is always the focused route when this
  // fires, navigate('Login')/navigate('MainTabs') would push a new instance
  // on top and leave THIS ResetPassword screen in the history underneath it.
  // reset() instead replaces the whole stack with just the target route, so
  // no stale ResetPassword (reachable via back-gesture, or resurfacing later
  // through RootNavigator's route-name-based reconciliation on the next auth
  // flip) can survive. Route on the live isLoggedIn value, not a fixed name,
  // since this screen is registered in both the authenticated and
  // unauthenticated root stacks (see RootNavigator) and only one of
  // 'MainTabs' / 'Login' is a legal target in whichever is currently active.
  const goContinue = () => {
    navigation.reset({
      index: 0,
      routes: [{ name: isLoggedIn ? 'MainTabs' : 'Login' }],
    });
  };

  const submit = async () => {
    if (inFlightRef.current || tokenMissing) return;
    setError(null);

    const passwordError = getNewPasswordValidationError(newPassword);
    if (passwordError) {
      setFieldErrors({ newPassword: passwordError });
      return;
    }
    if (newPassword !== confirmPassword) {
      setFieldErrors({ confirmPassword: 'Passwords do not match.' });
      return;
    }
    setFieldErrors({});

    inFlightRef.current = true;
    setSubmitting(true);
    try {
      await authService.resetPassword({ token, newPassword });
      // Unconditional and harmless when there was no local session to begin
      // with: the backend already revoked every session for this account as
      // part of the reset, so any session this device happened to hold must
      // stop appearing authenticated. If that flip swaps RootNavigator's
      // stack out from under this screen (only possible when the link was
      // opened while still signed in — the rare edge case, not the ordinary
      // flow), the same precedent the rest of the app already follows for
      // every sign-out applies: no imperative navigation fights the swap.
      // RootNavigator's auth-keyed Stack.Navigator then remounts and this
      // instance unmounts along with it, so the mountedRef checks below guard
      // against setting state after that.
      await endLocalSession();
      if (mountedRef.current) setSucceeded(true);
    } catch (err) {
      if (mountedRef.current) {
        const apiFieldErrors = getAuthFieldErrors(err, ['newPassword']);
        setFieldErrors(apiFieldErrors);
        if (Object.keys(apiFieldErrors).length === 0) setError(getAuthErrorMessage(err));
      }
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current) setSubmitting(false);
    }
  };

  return (
    <View style={styles.root}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.logoRow}>
            <BowlMark size={34} ring={false} color={colors.sageDeep} accent={colors.stone} />
            <Text style={styles.wordmark}>WeCooked</Text>
          </View>

          {tokenMissing ? (
            <>
              <Text style={styles.title} accessibilityRole="header">
                Link incomplete
              </Text>
              <Text style={styles.subtitle}>
                This password reset link is missing or incomplete. Request a new one from the login
                screen.
              </Text>
              <Button
                title={isLoggedIn ? 'Back to app' : 'Back to Login'}
                onPress={goContinue}
                style={{ marginTop: spacing.lg }}
              />
            </>
          ) : succeeded ? (
            <>
              <Text style={styles.title} accessibilityRole="header">
                Password reset
              </Text>
              <Text style={styles.subtitle}>
                Your password has been reset. For your security, you've been signed out of every
                device — please log in again with your new password.
              </Text>
              <Button
                title={isLoggedIn ? 'Continue' : 'Go to Login'}
                onPress={goContinue}
                style={{ marginTop: spacing.lg }}
              />
            </>
          ) : (
            <>
              <Text style={styles.title} accessibilityRole="header">
                Reset your password
              </Text>
              <Text style={styles.subtitle}>Choose a new password for your account.</Text>

              <Input
                label="New Password"
                required
                icon="lock-closed-outline"
                value={newPassword}
                onChangeText={(value) => {
                  setNewPassword(value);
                  setFieldErrors((current) => ({ ...current, newPassword: null }));
                }}
                placeholder="At least 8 characters"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                autoComplete="new-password"
                textContentType="newPassword"
                editable={!submitting}
                error={fieldErrors.newPassword}
              />
              <PasswordRequirements value={newPassword} />
              <Input
                label="Confirm New Password"
                required
                icon="lock-closed-outline"
                value={confirmPassword}
                onChangeText={(value) => {
                  setConfirmPassword(value);
                  setFieldErrors((current) => ({ ...current, confirmPassword: null }));
                }}
                placeholder="Re-enter new password"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                autoComplete="new-password"
                textContentType="newPassword"
                editable={!submitting}
                error={fieldErrors.confirmPassword}
                style={{ marginBottom: spacing.sm }}
              />

              {error ? (
                <Text style={styles.statusError} accessibilityLiveRegion="polite">
                  {error}
                </Text>
              ) : null}

              <Button
                title="Reset Password"
                onPress={submit}
                loading={submitting}
                disabled={submitting}
                style={{ marginTop: spacing.lg }}
              />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: spacing.xl },
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
      marginBottom: spacing.xxl,
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
