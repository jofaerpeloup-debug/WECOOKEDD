import React, { useRef, useState } from 'react';
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
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, HeartIcon } from '../theme/brandKit';
import { useAuth } from '../context/AuthContext';
import { getAuthErrorMessage } from '../api/errorMessages';

const LOGIN_BG = require('../assets/landing/login-bg.jpg');

function UserIcon({ size = 16, color = COLORS.inkFaint }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" stroke={color} strokeWidth={1.8} />
      <Path d="M5 20c0-3.3 3.1-6 7-6s7 2.7 7 6" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

function MailIcon({ size = 16, color = COLORS.inkFaint }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4 6h16v12H4V6Z" stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
      <Path
        d="M4.5 6.5 12 12.5l7.5-6"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function LockIcon({ size = 16, color = COLORS.inkFaint }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M6 11h12v9H6v-9Z" stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
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

function Field({ icon, secureTextEntry, style, ...props }) {
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
    </View>
  );
}

export default function RegisterScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const inFlightRef = useRef(false);
  const { signUp } = useAuth();

  const register = async () => {
    if (inFlightRef.current) return; // guard against rapid duplicate submissions
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    if (!trimmedName || !trimmedEmail || !password) {
      setError('Fill in your name, email, and a password to continue.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }
    inFlightRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      // Only name/email/password are sent — role/status/emailVerified and any
      // other server-owned fields are never supplied. The backend always
      // creates a normal user and returns a full session, so this also signs
      // the new account in; RootNavigator then swaps to the authed stack.
      await signUp({ name: trimmedName, email: trimmedEmail, password });
    } catch (err) {
      setError(getAuthErrorMessage(err));
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.root}>
      <Image
        source={LOGIN_BG}
        style={[StyleSheet.absoluteFill, { width: '100%', height: '100%' }]}
        resizeMode="cover"
      />
      <View style={styles.scrim} pointerEvents="none" />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
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
            <Text style={styles.welcome}>Create your account</Text>
            <View style={styles.subtitleRow}>
              <Text style={styles.subtitle}>Start your cooking journey with us</Text>
              <HeartIcon size={14} />
            </View>
          </View>

          <View style={styles.form}>
            <Text style={styles.label}>Name</Text>
            <Field
              icon={<UserIcon />}
              value={name}
              onChangeText={setName}
              placeholder="Your name"
              autoCapitalize="words"
            />

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
              placeholder="At least 8 characters"
              secureTextEntry
              style={{ marginBottom: 10 }}
            />

            {error && <Text style={styles.formError}>{error}</Text>}

            <Pressable
              onPress={register}
              disabled={submitting}
              style={({ pressed }) => [
                styles.cta,
                pressed && styles.ctaPressed,
                submitting && styles.ctaDisabled,
              ]}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.ctaText}>Create account</Text>
              )}
            </Pressable>

            <View style={styles.signupRow}>
              <Text style={styles.signupText}>Already have an account? </Text>
              <Pressable onPress={() => navigation.navigate('Login')} hitSlop={8}>
                <Text style={styles.signupLink}>Log in</Text>
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
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.45)' },
  scrollContent: { paddingHorizontal: 26, flexGrow: 1, justifyContent: 'center' },

  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 10,
  },
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

  formError: {
    fontSize: 12.5,
    fontWeight: '600',
    color: '#F0544E',
    textAlign: 'center',
    marginBottom: 10,
  },

  cta: {
    backgroundColor: COLORS.greenMid,
    borderRadius: 26,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  ctaPressed: { backgroundColor: COLORS.greenChef },
  ctaDisabled: { opacity: 0.6 },
  ctaText: { color: '#fff', fontSize: 15, fontWeight: '800' },

  signupRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  signupText: { fontSize: 13.5, fontWeight: '600', color: COLORS.inkSoft },
  signupLink: { fontSize: 13.5, fontWeight: '800', color: COLORS.greenLink },
});
