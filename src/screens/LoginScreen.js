import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import { BowlMark, GoogleGlyph, FacebookGlyph } from '../theme/brandKit';
import Input from '../components/Input';
import Button from '../components/Button';
import useGoogleSignIn from '../hooks/useGoogleSignIn';
import { useAuth } from '../context/AuthContext';
import { notify } from '../utils/alert';

export default function LoginScreen({ navigation }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const google = useGoogleSignIn();
  const { login: markLoggedIn } = useAuth();

  const proceed = () => navigation.replace('MainTabs');

  // Static demo sign-in — any (or no) credentials just continue.
  const login = async () => {
    await markLoggedIn();
    proceed();
  };

  const forgot = () => notify('Demo sign-in', 'This is a demo — just tap "Log in" to continue.');

  useEffect(() => {
    if (google.profile) markLoggedIn().then(proceed);
  }, [google.profile]);

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
            <BowlMark size={34} ring={false} accent={colors.sageDeep} />
            <Text style={styles.wordmark}>WeCooked</Text>
          </View>

          <Text style={styles.title}>Welcome back</Text>
          <Text style={styles.subtitle}>Log in to continue your cooking journey.</Text>

          <Input
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="youremail@gmail.com"
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <Input
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="Enter your password"
            secureTextEntry
            style={{ marginBottom: spacing.sm }}
          />
          <Pressable hitSlop={8} style={styles.forgotWrap} onPress={forgot}>
            <Text style={styles.forgot}>Forgot password?</Text>
          </Pressable>

          <Button title="Log in" onPress={login} style={{ marginTop: spacing.lg }} />

          <View style={styles.dividerRow}>
            <View style={styles.divider} />
            <Text style={styles.dividerText}>or continue with</Text>
            <View style={styles.divider} />
          </View>

          <View style={styles.authRow}>
            <Pressable
              style={styles.authBtn}
              disabled={google.loading || !!google.deviceCode}
              onPress={google.signIn}
            >
              {google.loading ? (
                <ActivityIndicator size="small" color={colors.ink} />
              ) : (
                <GoogleGlyph size={20} />
              )}
            </Pressable>
            <Pressable style={styles.authBtn} onPress={login}>
              <FacebookGlyph size={22} />
            </Pressable>
          </View>

          {google.deviceCode && (
            <View style={styles.deviceBox}>
              <Text style={styles.deviceLabel}>
                On any browser, go to{' '}
                <Text style={styles.deviceLink} onPress={() => Linking.openURL(google.verificationUrl)}>
                  {google.verificationUrl?.replace('https://', '')}
                </Text>{' '}
                and enter this code:
              </Text>
              <Text style={styles.deviceCode}>{google.deviceCode}</Text>
              <View style={styles.deviceActions}>
                <ActivityIndicator size="small" color={colors.sageDeep} />
                <Text style={styles.deviceWaiting}>Waiting for you to sign in…</Text>
              </View>
              <Pressable onPress={google.cancel} hitSlop={8}>
                <Text style={styles.deviceCancel}>Cancel</Text>
              </Pressable>
            </View>
          )}

          {google.error && (
            <Text style={styles.googleError}>
              {google.error.message || 'Google sign-in failed. Try again.'}
            </Text>
          )}

          <View style={styles.signupRow}>
            <Text style={styles.signupText}>Don't have an account? </Text>
            <Pressable onPress={login} hitSlop={8}>
              <Text style={styles.signupLink}>Sign up</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: spacing.xl },
    logoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: spacing.xl },
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
    forgot: { fontFamily: typography.body.bold, fontSize: 13, color: colors.sageDeep },
    dividerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginVertical: spacing.xl },
    divider: { flex: 1, height: 1, backgroundColor: colors.hairline },
    dividerText: { fontFamily: typography.body.fontFamily, fontSize: typography.sizes.sm, color: colors.inkFaint },
    authRow: { flexDirection: 'row', gap: spacing.lg, justifyContent: 'center' },
    authBtn: {
      width: 46,
      height: 46,
      borderRadius: 23,
      borderWidth: 1,
      borderColor: colors.hairline,
      backgroundColor: colors.paper,
      alignItems: 'center',
      justifyContent: 'center',
    },
    deviceBox: {
      backgroundColor: colors.paper,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.hairline,
      padding: spacing.lg,
      alignItems: 'center',
      marginTop: spacing.lg,
    },
    deviceLabel: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.inkSoft,
      textAlign: 'center',
      lineHeight: 18,
      marginBottom: spacing.sm,
    },
    deviceLink: { color: colors.sageDeep, fontFamily: typography.body.bold },
    deviceCode: {
      fontFamily: typography.display.fontFamily,
      fontSize: typography.sizes.xxl,
      letterSpacing: 3,
      color: colors.ink,
      marginBottom: spacing.sm,
    },
    deviceActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
    deviceWaiting: { fontFamily: typography.body.fontFamily, fontSize: typography.sizes.sm, color: colors.inkFaint },
    deviceCancel: { fontFamily: typography.body.bold, fontSize: typography.sizes.sm, color: colors.error },
    googleError: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.sm,
      color: colors.error,
      textAlign: 'center',
      marginTop: spacing.sm,
    },
    signupRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: spacing.xxl },
    signupText: { fontFamily: typography.body.fontFamily, fontSize: 13.5, color: colors.inkSoft },
    signupLink: { fontFamily: typography.body.bold, fontSize: 13.5, color: colors.sageDeep },
  });
}
