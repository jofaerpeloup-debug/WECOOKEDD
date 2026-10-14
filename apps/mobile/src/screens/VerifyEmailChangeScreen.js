import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';
import { typography, spacing } from '../theme/theme';
import { BowlMark } from '../theme/brandKit';
import Button from '../components/Button';
import { useAuth } from '../context/AuthContext';
import { getAuthErrorMessage } from '../api/errorMessages';

export default function VerifyEmailChangeScreen({ navigation, route }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors);
  const { isLoggedIn, verifyEmailChange } = useAuth();
  const token = typeof route?.params?.token === 'string' ? route.params.token.trim() : '';
  const [phase, setPhase] = useState(token ? 'verifying' : 'missing');
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!token) return undefined;
    let current = true;
    (async () => {
      try {
        await verifyEmailChange(token);
        if (!current) return;
        setPhase('success');
      } catch (err) {
        if (!current) return;
        setError(getAuthErrorMessage(err));
        setPhase('error');
      }
    })();
    return () => { current = false; };
  }, [token, verifyEmailChange]);

  const goContinue = () => navigation.reset({
    index: 0,
    routes: [{ name: isLoggedIn ? 'MainTabs' : 'Login' }],
  });
  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl }]}>
        <View style={styles.logoRow}>
          <BowlMark size={34} ring={false} color={colors.sageDeep} accent={colors.stone} />
          <Text style={styles.wordmark}>WeCooked</Text>
        </View>
        {phase === 'verifying' ? <ActivityIndicator color={colors.sageDeep} /> : null}
        <Text style={styles.title} accessibilityRole="header">
          {phase === 'verifying' ? 'Changing your email…' : phase === 'success' ? 'Email changed' : 'Email change failed'}
        </Text>
        <Text style={phase === 'error' ? styles.error : styles.copy} accessibilityLiveRegion="polite">
          {phase === 'missing'
            ? 'This email-change link is missing or incomplete.'
            : phase === 'success'
              ? 'Your email was changed. Sign in again with your new address.'
              : error || 'Please wait while WeCooked confirms your new address.'}
        </Text>
        {phase !== 'verifying' ? (
          <Button title={isLoggedIn ? 'Back to app' : 'Go to Login'} onPress={goContinue} style={{ marginTop: spacing.lg }} />
        ) : null}
      </ScrollView>
    </View>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    root: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.xl, backgroundColor: colors.cream },
    content: { flexGrow: 1, justifyContent: 'center' },
    logoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.xl },
    wordmark: { fontFamily: typography.display.fontFamily, fontSize: typography.sizes.xl, color: colors.ink },
    title: { fontFamily: typography.display.fontFamily, fontSize: typography.sizes.xxl, color: colors.ink, marginTop: spacing.md },
    copy: { fontFamily: typography.body.fontFamily, fontSize: typography.sizes.base, color: colors.inkSoft, marginTop: spacing.sm },
    error: { fontFamily: typography.body.medium, fontSize: typography.sizes.sm, color: colors.error, marginTop: spacing.sm },
  });
}
