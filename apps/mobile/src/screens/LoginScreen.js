import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  BackHandler,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import { BowlMark, GoogleGlyph } from '../theme/brandKit';
import Input from '../components/Input';
import Button from '../components/Button';
import useGoogleSignIn from '../hooks/useGoogleSignIn';
import { useAuth } from '../context/AuthContext';
import * as authService from '../api/authService';
import { getAuthErrorMessage } from '../api/errorMessages';

// Identical wording whether or not the address has an account — the screen must
// never become an account-existence oracle.
const RESET_REQUESTED =
  'If an account exists for that email, password reset instructions have been sent.';

export default function LoginScreen({ navigation }) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors, isDark);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [activeAction, setActiveAction] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const inFlightRef = useRef(false);

  const google = useGoogleSignIn();
  const { signIn } = useAuth();

  const submitting = activeAction === 'login';
  const resetting = activeAction === 'reset';
  const googleSubmitting = activeAction === 'google' || google.loading;
  const busy = activeAction !== null || google.loading;

  // Disable only user-driven back mechanisms while work is active. This does
  // not register a navigation-removal blocker, so RootNavigator remains free
  // to replace the unauthenticated tree immediately after a successful login.
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: !busy });
  }, [busy, navigation]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => inFlightRef.current
    );
    return () => subscription.remove();
  }, []);

  const goRegister = () => {
    if (inFlightRef.current) return;
    navigation.navigate('Register');
  };

  const login = async () => {
    if (inFlightRef.current) return; // guard against rapid duplicate submissions
    google.cancel();
    setNotice(null);
    setError(null);
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError('Enter your email and password to continue.');
      return;
    }
    inFlightRef.current = true;
    setActiveAction('login');
    try {
      await signIn({ email: trimmedEmail, password });
      // On success the auth state flips and RootNavigator swaps to the
      // authenticated stack — no manual navigation needed here.
    } catch (err) {
      setError(getAuthErrorMessage(err));
    } finally {
      inFlightRef.current = false;
      setActiveAction(null);
    }
  };

  // Request step only. Goes straight to authService because it carries no
  // session authority — no tokens are issued, and AuthContext (the auth
  // boundary) has nothing to reconcile. The reset itself is completed off-device
  // through the emailed link, so there is no route to navigate to here.
  const requestPasswordReset = async () => {
    if (inFlightRef.current) return;
    google.cancel();
    setNotice(null);
    setError(null);
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError('Enter your email address first, then tap Forgot password.');
      return;
    }
    inFlightRef.current = true;
    setActiveAction('reset');
    try {
      await authService.forgotPassword(trimmedEmail);
      setNotice(RESET_REQUESTED);
    } catch (err) {
      setError(getAuthErrorMessage(err));
    } finally {
      inFlightRef.current = false;
      setActiveAction(null);
    }
  };

  const signInWithGoogle = async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setActiveAction('google');
    setError(null);
    setNotice(null);
    try {
      await google.signIn();
    } finally {
      inFlightRef.current = false;
      setActiveAction(null);
    }
  };

  // One polite live region for everything the form has to say back, so the
  // spinner-only states still announce what is happening.
  let status = null;
  if (error) status = { text: error, tone: styles.statusError };
  else if (notice) status = { text: notice, tone: styles.statusNotice };
  else if (submitting) status = { text: 'Logging in…', tone: styles.statusMuted };
  else if (resetting) status = { text: 'Sending reset instructions…', tone: styles.statusMuted };

  return (
    <View style={styles.root}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
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

          <Text style={styles.title} accessibilityRole="header">
            Welcome back
          </Text>
          <Text style={styles.subtitle}>Log in to continue your cooking journey.</Text>

          {/* Password-manager integration is deferred out of M1 to its own
              slice, so these fields carry no autofill hints — same as before
              the migration. What stays is IME hardening: an email address must
              not be capitalised, autocorrected or spell-checked on its way in. */}
          <Input
            label="Email"
            icon="mail-outline"
            value={email}
            onChangeText={setEmail}
            placeholder="youremail@gmail.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            editable={!busy}
          />
          {/* The IME transforms are pinned off for their own sake, not for
              autofill: the eye toggle unmasks this field, and a plain text
              field would otherwise apply sentence capitalisation, autocorrect
              and spell-check suggestions to a typed password. */}
          <Input
            label="Password"
            icon="lock-closed-outline"
            value={password}
            onChangeText={setPassword}
            placeholder="Enter your password"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            editable={!busy}
            style={{ marginBottom: spacing.sm }}
          />

          <Pressable
            hitSlop={8}
            onPress={requestPasswordReset}
            disabled={busy}
            style={({ pressed }) => [styles.forgotWrap, (pressed || busy) && styles.dim]}
            accessibilityRole="button"
            accessibilityLabel="Forgot password"
            accessibilityHint="Emails reset instructions to the address entered above"
            accessibilityState={{ disabled: busy, busy: resetting }}
          >
            <Text style={styles.forgot}>Forgot password?</Text>
          </Pressable>

          {status && (
            <Text style={[styles.status, status.tone]} accessibilityLiveRegion="polite">
              {status.text}
            </Text>
          )}

          <Button
            title="Log in"
            onPress={login}
            loading={submitting}
            disabled={busy}
            style={{ marginTop: spacing.lg }}
          />

          <View style={styles.dividerRow}>
            <View style={styles.divider} />
            <Text style={styles.dividerText}>or continue with</Text>
            <View style={styles.divider} />
          </View>

          {/* The real WeCooked Google flow: useGoogleSignIn -> AuthContext
              .signInWithGoogle -> googleAuthFlow. Presentation only here. */}
          <Pressable
            onPress={signInWithGoogle}
            disabled={busy}
            style={({ pressed }) => [
              styles.googleBtn,
              pressed && styles.dim,
              busy && styles.dim,
              !google.ready && styles.googleBtnUnavailable,
            ]}
            accessibilityRole="button"
            accessibilityLabel={
              googleSubmitting ? 'Signing in with Google' : 'Continue with Google'
            }
            accessibilityState={{
              disabled: busy,
              busy: googleSubmitting,
            }}
          >
            {googleSubmitting ? (
              <ActivityIndicator size="small" color={colors.ink} />
            ) : (
              <>
                <GoogleGlyph size={18} />
                <Text style={styles.googleText}>Continue with Google</Text>
              </>
            )}
          </Pressable>

          {google.error && (
            <Text style={styles.googleError} accessibilityLiveRegion="polite">
              {google.error.message || 'Google sign-in failed. Try again.'}
            </Text>
          )}

          <View style={styles.signupRow}>
            <Text style={styles.signupText}>Don't have an account? </Text>
            <Pressable
              onPress={goRegister}
              disabled={busy}
              hitSlop={8}
              style={({ pressed }) => [(pressed || busy) && styles.dim]}
              accessibilityRole="button"
              accessibilityLabel="Create a new account"
              accessibilityState={{ disabled: busy }}
            >
              <Text style={styles.signupLink}>Sign up</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function makeStyles(colors, isDark) {
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

    forgotWrap: { alignSelf: 'flex-end', marginTop: -spacing.xs },
    forgot: {
      fontFamily: typography.body.bold,
      fontSize: 13,
      color: isDark ? colors.sage : colors.sageDeep,
    },
    dim: { opacity: 0.6 },

    status: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.sm,
      lineHeight: 18,
      textAlign: 'center',
      marginTop: spacing.lg,
    },
    statusError: { color: colors.error },
    statusNotice: { color: colors.inkSoft },
    statusMuted: { color: colors.inkFaint },

    dividerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      marginVertical: spacing.xl,
    },
    divider: { flex: 1, height: 1, backgroundColor: colors.hairline },
    dividerText: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.inkFaint,
    },

    googleBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.md,
      height: 50,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.hairline,
      backgroundColor: colors.paper,
    },
    googleBtnUnavailable: { opacity: 0.55 },
    googleText: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.base,
      color: colors.ink,
    },
    googleError: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.sm,
      color: colors.error,
      textAlign: 'center',
      marginTop: spacing.md,
    },

    signupRow: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      marginTop: spacing.xxl,
    },
    signupText: {
      fontFamily: typography.body.fontFamily,
      fontSize: 13.5,
      color: colors.inkSoft,
    },
    signupLink: {
      fontFamily: typography.body.bold,
      fontSize: 13.5,
      color: isDark ? colors.sage : colors.sageDeep,
    },
  });
}
