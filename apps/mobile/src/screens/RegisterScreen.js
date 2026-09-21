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
import Input, { PasswordRequirements } from '../components/Input';
import Button from '../components/Button';
import useGoogleSignIn from '../hooks/useGoogleSignIn';
import { useAuth } from '../context/AuthContext';
import {
  getAuthErrorMessage,
  getAuthFieldErrors,
  getEmailValidationError,
  getNewPasswordValidationError,
} from '../api/errorMessages';

export default function RegisterScreen({ navigation }) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors, isDark);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [activeAction, setActiveAction] = useState(null);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const inFlightRef = useRef(false);

  // The SAME hook, and therefore the same real flow, that Login uses: there is
  // no separate Google signup path. The backend decides whether a given Google
  // identity is a new account or an existing one.
  const google = useGoogleSignIn();
  const { signUp } = useAuth();

  const submitting = activeAction === 'register';
  const googleSubmitting = activeAction === 'google' || google.loading;
  const busy = activeAction !== null || google.loading;

  // Block only user back/gesture input while a request is active. Structural
  // removal by RootNavigator after AuthContext authenticates remains untouched.
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

  const goLogin = () => {
    if (inFlightRef.current) return;
    navigation.navigate('Login');
  };

  const register = async () => {
    if (inFlightRef.current) return; // guard against rapid duplicate submissions
    google.cancel();
    setError(null);
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const nextFieldErrors = {
      name: trimmedName ? null : 'Name is required.',
      email: getEmailValidationError(email),
      password: getNewPasswordValidationError(password),
    };
    if (Object.values(nextFieldErrors).some(Boolean)) {
      setFieldErrors(nextFieldErrors);
      return;
    }
    setFieldErrors({});
    inFlightRef.current = true;
    setActiveAction('register');
    try {
      // Only name/email/password are sent — role/status/emailVerified and any
      // other server-owned fields are never supplied. The backend always
      // creates a normal user and returns a full session, so this also signs
      // the new account in; RootNavigator then swaps to the authed stack.
      await signUp({ name: trimmedName, email: trimmedEmail, password });
    } catch (err) {
      const apiFieldErrors = getAuthFieldErrors(err, ['name', 'email', 'password']);
      setFieldErrors(apiFieldErrors);
      if (Object.keys(apiFieldErrors).length === 0) setError(getAuthErrorMessage(err));
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
    try {
      await google.signIn();
    } finally {
      inFlightRef.current = false;
      setActiveAction(null);
    }
  };

  let status = null;
  if (error) status = { text: error, tone: styles.statusError };
  else if (submitting) status = { text: 'Creating your account…', tone: styles.statusMuted };

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
            Create your account
          </Text>
          <Text style={styles.subtitle}>Start your cooking journey with us.</Text>

          <Input
            label="Name"
            required
            icon="person-outline"
            value={name}
            onChangeText={(value) => {
              setName(value);
              setFieldErrors((current) => ({ ...current, name: null }));
            }}
            placeholder="Your name"
            autoCapitalize="words"
            autoComplete="name"
            textContentType="name"
            editable={!busy}
            error={fieldErrors.name}
          />
          <Input
            label="Email"
            required
            icon="mail-outline"
            value={email}
            onChangeText={(value) => {
              setEmail(value);
              setFieldErrors((current) => ({ ...current, email: null }));
            }}
            placeholder="youremail@gmail.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            autoComplete="email"
            textContentType="emailAddress"
            editable={!busy}
            error={fieldErrors.email}
          />
          <Input
            label="Password"
            required
            icon="lock-closed-outline"
            value={password}
            onChangeText={(value) => {
              setPassword(value);
              setFieldErrors((current) => ({ ...current, password: null }));
            }}
            placeholder="At least 8 characters"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            autoComplete="new-password"
            textContentType="newPassword"
            editable={!busy}
            error={fieldErrors.password}
          />
          <PasswordRequirements value={password} />

          {status && (
            <Text style={[styles.status, status.tone]} accessibilityLiveRegion="polite">
              {status.text}
            </Text>
          )}

          <Button
            title="Create account"
            onPress={register}
            loading={submitting}
            disabled={busy}
            style={{ marginTop: spacing.lg }}
          />

          <View style={styles.dividerRow}>
            <View style={styles.divider} />
            <Text style={styles.dividerText}>or continue with</Text>
            <View style={styles.divider} />
          </View>

          <Pressable
            onPress={signInWithGoogle}
            disabled={busy}
            style={({ pressed }) => [
              styles.googleBtn,
              (pressed || busy) && styles.dim,
              !google.ready && styles.googleBtnUnavailable,
            ]}
            accessibilityRole="button"
            accessibilityLabel={
              googleSubmitting ? 'Continuing with Google' : 'Continue with Google'
            }
            accessibilityState={{ disabled: busy, busy: googleSubmitting }}
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

          <View style={styles.signinRow}>
            <Text style={styles.signinText}>Already have an account? </Text>
            <Pressable
              onPress={goLogin}
              disabled={busy}
              hitSlop={8}
              style={({ pressed }) => [(pressed || busy) && styles.dim]}
              accessibilityRole="button"
              accessibilityLabel="Log in to an existing account"
              accessibilityState={{ disabled: busy }}
            >
              <Text style={styles.signinLink}>Log in</Text>
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

    dim: { opacity: 0.6 },

    status: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.sm,
      lineHeight: 18,
      textAlign: 'center',
      marginTop: spacing.md,
    },
    statusError: { color: colors.error },
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

    signinRow: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      marginTop: spacing.xxl,
    },
    signinText: {
      fontFamily: typography.body.fontFamily,
      fontSize: 13.5,
      color: colors.inkSoft,
    },
    signinLink: {
      fontFamily: typography.body.bold,
      fontSize: 13.5,
      color: isDark ? colors.sage : colors.sageDeep,
    },
  });
}
