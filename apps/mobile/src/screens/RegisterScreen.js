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
  AccessibilityInfo,
  BackHandler,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import { BowlMark, GoogleGlyph } from '../theme/brandKit';
import {
  NEW_PASSWORD_ERROR_MESSAGES,
  PASSWORD_MIN_CHARS,
  validateNewPassword,
} from '@wecooked/contracts';
import { ApiError } from '../api/client';
import Input, { PasswordRequirements } from '../components/Input';
import Button from '../components/Button';
import useGoogleSignIn from '../hooks/useGoogleSignIn';
import { useAuth } from '../context/AuthContext';
import {
  getAuthErrorMessage,
  getAuthFieldErrors,
  getEmailValidationError,
} from '../api/errorMessages';

const REGISTRATION_PASSWORD_TOO_LONG = 'Password is too long. Please shorten it.';
const REGISTRATION_UNSUPPORTED_CHARACTERS =
  "Some characters aren't supported. Please choose different characters.";
const REGISTRATION_PASSWORD_MESSAGES = new Map([
  [NEW_PASSWORD_ERROR_MESSAGES.MIN_CHARS, `Use ${PASSWORD_MIN_CHARS}+ characters in your password.`],
  [NEW_PASSWORD_ERROR_MESSAGES.UPPERCASE, 'Add an uppercase letter to your password.'],
  [NEW_PASSWORD_ERROR_MESSAGES.LOWERCASE, 'Add a lowercase letter to your password.'],
  [NEW_PASSWORD_ERROR_MESSAGES.DIGIT, 'Add a number to your password.'],
  [NEW_PASSWORD_ERROR_MESSAGES.SPECIAL, 'Add at least one supported symbol to your password.'],
  [NEW_PASSWORD_ERROR_MESSAGES.UNSUPPORTED, REGISTRATION_UNSUPPORTED_CHARACTERS],
  [NEW_PASSWORD_ERROR_MESSAGES.MAX_BYTES, REGISTRATION_PASSWORD_TOO_LONG],
]);

function registrationPasswordMessage(message) {
  return REGISTRATION_PASSWORD_MESSAGES.get(message) || message;
}

function registrationPasswordError(value) {
  const errors = validateNewPassword(value);
  const firstError = errors.includes(NEW_PASSWORD_ERROR_MESSAGES.MAX_BYTES)
    ? NEW_PASSWORD_ERROR_MESSAGES.MAX_BYTES
    : errors.includes(NEW_PASSWORD_ERROR_MESSAGES.UNSUPPORTED)
      ? NEW_PASSWORD_ERROR_MESSAGES.UNSUPPORTED
      : errors[0];
  return firstError ? registrationPasswordMessage(firstError) : null;
}

function registrationApiFieldErrors(err) {
  const fieldErrors = getAuthFieldErrors(err, ['name', 'email', 'password']);
  if (!(err instanceof ApiError) || err.code !== 'VALIDATION_ERROR' || !fieldErrors.password) {
    return fieldErrors;
  }
  const passwordMessages = err.details
    .filter((detail) =>
      typeof detail?.field === 'string' &&
      detail.field.split('.').pop() === 'password' &&
      typeof detail.message === 'string' && detail.message
    )
    .map((detail) => registrationPasswordMessage(detail.message));
  if (passwordMessages.length) fieldErrors.password = passwordMessages.join(' ');
  return fieldErrors;
}

function registrationFallbackError(err) {
  const message = getAuthErrorMessage(err);
  if (!(err instanceof ApiError) || err.code !== 'VALIDATION_ERROR') return message;
  const field = err.details?.[0]?.field;
  if (typeof field === 'string' && field.split('.').pop() !== 'password') return message;
  return registrationPasswordMessage(message);
}

export function getRegistrationPasswordAutofillProps(platform) {
  // On iOS, cancelling a generated Strong Password can visually clear the
  // native field without reporting an empty value to React. Without a native
  // cancellation event to reconcile that divergence, do not opt this one
  // registration field into the generated-password flow. Other platforms keep
  // the standard new-password hint.
  return platform === 'ios'
    ? { textContentType: 'none' }
    : { autoComplete: 'new-password' };
}

export function prepareRegistrationSubmission({ name, email, password }) {
  const trimmedName = name.trim();
  const trimmedEmail = email.trim();
  const fieldErrors = {
    name: trimmedName ? null : 'Name is required.',
    email: getEmailValidationError(email),
    password: registrationPasswordError(password),
  };

  return {
    fieldErrors,
    payload: Object.values(fieldErrors).some(Boolean)
      ? null
      : { name: trimmedName, email: trimmedEmail, password },
  };
}

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
  const [legalAcknowledged, setLegalAcknowledged] = useState(false);
  const [legalError, setLegalError] = useState(null);
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

  const openLegal = (route) => {
    if (inFlightRef.current) return;
    // A stack push keeps this Register instance and its in-progress form.
    navigation.navigate(route);
  };

  const toggleLegalAcknowledgement = () => {
    setLegalAcknowledged((current) => !current);
    setLegalError(null);
  };

  const register = async () => {
    if (inFlightRef.current) return; // guard against rapid duplicate submissions
    google.cancel();
    setError(null);
    // Validate and submit one immutable snapshot so no fallback/default value
    // can differ from the password state represented by the checklist.
    const submission = prepareRegistrationSubmission({ name, email, password });
    setFieldErrors(submission.fieldErrors);
    if (!legalAcknowledged) {
      setLegalError('Acknowledge the Terms & Conditions and Privacy Policy to create an account.');
      // Android announces the new inline text through accessibilityLiveRegion.
      // iOS needs an explicit announcement for this submit attempt.
      if (Platform.OS === 'ios') {
        AccessibilityInfo.announceForAccessibility(
          'Acknowledge the Terms & Conditions and Privacy Policy to create an account.'
        );
      }
    }
    if (!submission.payload || !legalAcknowledged) {
      return;
    }
    setLegalError(null);
    inFlightRef.current = true;
    setActiveAction('register');
    try {
      // Only name/email/password are sent — role/status/emailVerified and any
      // other server-owned fields are never supplied. The backend always
      // creates a normal user and returns a full session, so this also signs
      // the new account in; RootNavigator then swaps to the authed stack.
      await signUp(submission.payload);
    } catch (err) {
      const apiFieldErrors = registrationApiFieldErrors(err);
      setFieldErrors(apiFieldErrors);
      if (Object.keys(apiFieldErrors).length === 0) setError(registrationFallbackError(err));
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
            {...getRegistrationPasswordAutofillProps(Platform.OS)}
            editable={!busy}
            error={fieldErrors.password}
          />
          <PasswordRequirements value={password} />

          <View style={styles.legalSection}>
            <View style={styles.legalConsentRow}>
              <Pressable
                onPress={toggleLegalAcknowledgement}
                disabled={busy}
                style={styles.legalCheckboxTarget}
                accessibilityRole="checkbox"
                accessibilityLabel="I acknowledge the Terms & Conditions and Privacy Policy"
                accessibilityState={{ checked: legalAcknowledged, disabled: busy }}
                accessibilityHint={legalError || undefined}
              >
                <View style={[styles.legalCheckbox, legalAcknowledged && styles.legalCheckboxChecked]}>
                  {legalAcknowledged && <Text style={styles.legalCheckmark}>✓</Text>}
                </View>
              </Pressable>
              <View style={styles.legalCopy}>
                <Text style={styles.legalAcknowledgement}>I agree to the</Text>
                <View style={styles.legalLinks}>
                  <Pressable
                    onPress={() => openLegal('Terms')}
                    disabled={busy}
                    style={styles.legalLinkTarget}
                    accessibilityRole="link"
                    accessibilityLabel="Terms & Conditions"
                    accessibilityState={{ disabled: busy }}
                  >
                    <Text style={styles.legalLink}>Terms & Conditions</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => openLegal('Privacy')}
                    disabled={busy}
                    style={styles.legalLinkTarget}
                    accessibilityRole="link"
                    accessibilityLabel="Privacy Policy"
                    accessibilityState={{ disabled: busy }}
                  >
                    <Text style={styles.legalLink}>Privacy Policy</Text>
                  </Pressable>
                </View>
              </View>
            </View>
            {legalError && (
              <Text style={styles.legalError} accessibilityLiveRegion="polite">
                {legalError}
              </Text>
            )}
          </View>

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

          {/* The same compact presentation and real Google flow used by Login. */}
          <View style={styles.authRow}>
            <Pressable
              onPress={signInWithGoogle}
              disabled={busy}
              style={({ pressed }) => [
                styles.authBtn,
                pressed && styles.dim,
                busy && styles.dim,
                !google.ready && styles.authBtnUnavailable,
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
                <GoogleGlyph size={20} />
              )}
            </Pressable>
          </View>

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

    legalSection: { marginTop: spacing.sm },
    legalConsentRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
    },
    legalCheckboxTarget: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
    legalCheckbox: {
      width: 24,
      height: 24,
      borderWidth: 2,
      borderRadius: radius.sm,
      borderColor: colors.sageDeep,
      alignItems: 'center',
      justifyContent: 'center',
    },
    legalCheckboxChecked: { backgroundColor: colors.sageDeep },
    legalCheckmark: { color: colors.onAccent, fontFamily: typography.body.bold, fontSize: 16 },
    legalAcknowledgement: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.base,
      color: colors.ink,
    },
    legalCopy: { flex: 1 },
    legalLinks: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.md },
    legalLinkTarget: { minHeight: 48, justifyContent: 'center' },
    legalLink: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.base,
      color: isDark ? colors.sage : colors.sageDeep,
      textDecorationLine: 'underline',
    },
    legalError: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.sm,
      color: colors.ink,
      marginTop: spacing.xs,
    },

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

    authRow: { flexDirection: 'row', justifyContent: 'center' },
    authBtn: {
      width: 46,
      height: 46,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.hairline,
      backgroundColor: colors.paper,
    },
    authBtnUnavailable: { opacity: 0.55 },
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
