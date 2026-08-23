import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Image,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Linking,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, HeartIcon } from '../theme/brandKit';
import useGoogleSignIn from '../hooks/useGoogleSignIn';
import { useAuth } from '../context/AuthContext';

const LOGIN_BG = require('../assets/landing/login-bg.jpg');

function MailIcon({ size = 16, color = COLORS.inkFaint }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 6h16v12H4V6Z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <Path d="M4.5 6.5 12 12.5l7.5-6" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function LockIcon({ size = 16, color = COLORS.inkFaint }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M6 11h12v9H6v-9Z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <Path d="M8 11V8a4 4 0 1 1 8 0v3" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

function EyeIcon({ size = 16, color = COLORS.inkFaint, off }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <Path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" stroke={color} strokeWidth={1.8} />
      {off && <Path d="M3 3l18 18" stroke={color} strokeWidth={1.8} strokeLinecap="round" />}
    </Svg>
  );
}

function GoogleIcon({ size = 18 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M21.6 12.23c0-.7-.06-1.38-.18-2.03H12v3.84h5.4a4.6 4.6 0 0 1-2 3.02v2.5h3.23c1.9-1.75 2.97-4.33 2.97-7.33Z"
        fill="#4285F4"
      />
      <Path
        d="M12 22c2.7 0 4.96-.9 6.62-2.44l-3.23-2.5c-.9.6-2.04.96-3.39.96-2.6 0-4.8-1.76-5.59-4.12H3.07v2.58A10 10 0 0 0 12 22Z"
        fill="#34A853"
      />
      <Path
        d="M6.41 13.9a6 6 0 0 1 0-3.8V7.52H3.07a10 10 0 0 0 0 8.96l3.34-2.58Z"
        fill="#FBBC05"
      />
      <Path
        d="M12 6.18c1.47 0 2.79.5 3.83 1.5l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.93 5.52l3.34 2.58C7.2 7.94 9.4 6.18 12 6.18Z"
        fill="#EA4335"
      />
    </Svg>
  );
}

function AppleIcon({ size = 19, color = '#fff' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M16.4 1c.1 1-.3 2-1 2.7-.7.8-1.8 1.4-2.8 1.3-.1-1 .4-2 1-2.7C14.3 1.4 15.4 1 16.4 1Zm3.6 16.3c-.3.7-.6 1.3-1 1.9-.6.9-1.1 1.6-1.6 2-.5.5-1.1.7-1.8.7-.5 0-1.1-.1-1.9-.5-.7-.3-1.4-.5-2-.5-.7 0-1.3.2-2 .5-.7.4-1.3.5-1.7.5-.7 0-1.3-.2-1.8-.7-.6-.5-1.1-1.2-1.7-2.1-.6-1-1.1-2.1-1.5-3.4-.4-1.4-.6-2.7-.6-4 0-1.5.3-2.7 1-3.8.5-.9 1.2-1.5 2-2 .8-.5 1.7-.7 2.6-.7.5 0 1.2.2 2.1.5.8.3 1.4.5 1.7.5.2 0 .8-.2 1.8-.6 1-.3 1.8-.5 2.4-.4 1.8.1 3.1.9 4 2.2-1.6 1-2.4 2.3-2.4 4.1 0 1.4.5 2.5 1.5 3.5.4.4.9.8 1.4 1-.1.3-.2.6-.3.8Z"
        fill={color}
      />
    </Svg>
  );
}

function FacebookIcon({ size = 18, color = '#1877F2' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M22 12a10 10 0 1 0-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.5 1.5-3.89 3.78-3.89 1.1 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.78l-.44 2.89h-2.34v6.99A10 10 0 0 0 22 12Z"
        fill={color}
      />
    </Svg>
  );
}

function Field({ icon, secureTextEntry, rightAction, style, ...props }) {
  const [hidden, setHidden] = useState(!!secureTextEntry);

  return (
    <View style={[styles.field, style]}>
      {icon}
      <TextInput
        style={styles.input}
        placeholderTextColor={COLORS.inkFaint}
        secureTextEntry={hidden}
        {...props}
      />
      {secureTextEntry && (
        <Pressable onPress={() => setHidden(!hidden)} hitSlop={10}>
          <EyeIcon off={hidden} />
        </Pressable>
      )}
      {rightAction}
    </View>
  );
}

export default function LoginScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const google = useGoogleSignIn();
  const { login: markLoggedIn } = useAuth();

  const login = async () => {
    await markLoggedIn();
    navigation.replace('MainTabs');
  };

  useEffect(() => {
    if (google.profile) {
      markLoggedIn().then(() => navigation.replace('MainTabs'));
    }
  }, [google.profile]);

  return (
    <View style={styles.root}>
      <Image
        source={LOGIN_BG}
        style={[StyleSheet.absoluteFillObject, { width: '100%', height: '100%' }]}
        resizeMode="cover"
      />
      <View style={styles.scrim} pointerEvents="none" />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8 },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.logoRow}>
            <View style={styles.logoMark}>
              <MaterialCommunityIcons name="chef-hat" size={18} color="#fff" />
            </View>
            <Text style={styles.wordmark}>
              <Text style={{ color: COLORS.greenMid }}>We</Text>Cooked
            </Text>
          </View>

          <View style={styles.headerText}>
            <Text style={styles.welcome}>Welcome back!</Text>
            <View style={styles.subtitleRow}>
              <Text style={styles.subtitle}>Log in to continue your cooking journey</Text>
              <HeartIcon size={14} />
            </View>
          </View>

          <View style={styles.form}>
            <Text style={styles.label}>Email</Text>
            <Field
              icon={<MailIcon />}
              value={email}
              onChangeText={setEmail}
              placeholder="youremail@gmail.com"
              autoCapitalize="none"
              keyboardType="email-address"
            />

            <Text style={styles.label}>Password</Text>
            <Field
              icon={<LockIcon />}
              value={password}
              onChangeText={setPassword}
              placeholder="Enter your password"
              secureTextEntry
              style={{ marginBottom: 4 }}
            />

            <Pressable hitSlop={8} style={styles.forgotWrap}>
              <Text style={styles.forgot}>Forgot password?</Text>
            </Pressable>

            <Pressable onPress={login} style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}>
              <Text style={styles.ctaText}>Log in</Text>
            </Pressable>

            <View style={styles.dividerRow}>
              <View style={styles.divider} />
              <Text style={styles.dividerText}>or continue with</Text>
              <View style={styles.divider} />
            </View>

            <View style={styles.socialRow}>
              <Pressable
                style={({ pressed }) => [styles.socialBtn, pressed && styles.socialBtnPressed]}
                disabled={google.loading || !!google.deviceCode}
                onPress={google.signIn}
              >
                {google.loading ? <ActivityIndicator size="small" color={COLORS.ink} /> : <GoogleIcon />}
              </Pressable>
              <Pressable style={({ pressed }) => [styles.socialBtn, pressed && styles.socialBtnPressed]}>
                <AppleIcon />
              </Pressable>
              <Pressable style={({ pressed }) => [styles.socialBtn, pressed && styles.socialBtnPressed]}>
                <FacebookIcon />
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
                  <ActivityIndicator size="small" color={COLORS.greenMid} />
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
              <Pressable onPress={() => navigation.navigate('Landing')} hitSlop={8}>
                <Text style={styles.signupLink}>Sign up</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  scrollContent: { paddingHorizontal: 26, flexGrow: 1, justifyContent: 'center' },

  logoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 10 },
  logoMark: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: COLORS.greenMid,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordmark: { fontSize: 18, fontWeight: '700', color: COLORS.ink },

  headerText: { alignItems: 'center', marginBottom: 32 },
  welcome: { fontSize: 20, fontWeight: '800', color: COLORS.ink, marginBottom: 3 },
  subtitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  subtitle: { fontSize: 12.5, fontWeight: '600', color: COLORS.inkSoft },

  form: { width: '100%' },
  label: { fontSize: 12.5, fontWeight: '700', color: COLORS.inkSoft, marginBottom: 6 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: COLORS.creamCard,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.hairline,
    paddingHorizontal: 14,
    height: 46,
    marginBottom: 10,
  },
  input: { flex: 1, fontSize: 14, color: COLORS.ink, height: '100%', outlineStyle: 'none' },

  forgotWrap: { alignSelf: 'flex-end', marginTop: -6, marginBottom: 10 },
  forgot: { fontSize: 12, fontWeight: '700', color: COLORS.greenLink },

  cta: {
    backgroundColor: COLORS.greenMid,
    borderRadius: 26,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  ctaPressed: { backgroundColor: COLORS.greenChef },
  ctaText: { color: '#fff', fontSize: 15, fontWeight: '800' },

  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  divider: { flex: 1, height: 1, backgroundColor: COLORS.hairline },
  dividerText: { fontSize: 11.5, fontWeight: '600', color: COLORS.inkFaint },

  socialRow: { flexDirection: 'row', gap: 14, marginBottom: 14, justifyContent: 'center' },
  socialBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.creamCard,
    borderWidth: 1,
    borderColor: COLORS.hairline,
  },
  socialBtnPressed: { opacity: 0.7 },

  deviceBox: {
    backgroundColor: COLORS.creamCard,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.hairline,
    padding: 16,
    alignItems: 'center',
    marginBottom: 14,
  },
  deviceLabel: {
    fontSize: 12.5,
    fontWeight: '600',
    color: COLORS.inkSoft,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 8,
  },
  deviceLink: { color: COLORS.greenLink, fontWeight: '800' },
  deviceCode: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: 3,
    color: COLORS.ink,
    marginBottom: 10,
  },
  deviceActions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  deviceWaiting: { fontSize: 12, fontWeight: '600', color: COLORS.inkFaint },
  deviceCancel: { fontSize: 12.5, fontWeight: '700', color: '#F0544E' },

  googleError: {
    fontSize: 12,
    fontWeight: '600',
    color: '#F0544E',
    textAlign: 'center',
    marginTop: -6,
    marginBottom: 12,
  },

  signupRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  signupText: { fontSize: 13.5, fontWeight: '600', color: COLORS.inkSoft },
  signupLink: { fontSize: 13.5, fontWeight: '800', color: COLORS.greenLink },
});
