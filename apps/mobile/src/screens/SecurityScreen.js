import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Switch, Pressable, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import TopBar from '../components/TopBar';
import Input from '../components/Input';
import Button from '../components/Button';
import { useAuth } from '../context/AuthContext';
import * as authService from '../api/authService';
import { isAvailable as isGoogleAvailable } from '../auth/googleAuthFlow';
import { getAuthErrorMessage } from '../api/errorMessages';

export default function SecurityScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { user, signOut, signOutEverywhere, linkGoogle } = useAuth();

  const mountedRef = useRef(true);
  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  // --- change password: the only real credential mutation this screen owns.
  // POST /auth/change-password revokes EVERY session for this user on
  // success (including this device's), so a successful change must be
  // followed by the real AuthContext.signOut() — never a fabricated "saved"
  // state that leaves a now-dead token in memory.
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwError, setPwError] = useState(null);
  const [pwSaving, setPwSaving] = useState(false);
  const pwSavingRef = useRef(false);

  const handleChangePassword = async () => {
    if (pwSavingRef.current) return;
    setPwError(null);

    if (!currentPassword || !newPassword) {
      setPwError('Enter your current and new password.');
      return;
    }
    if (newPassword.length < 8) {
      setPwError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError("New passwords don't match.");
      return;
    }

    pwSavingRef.current = true;
    setPwSaving(true);
    try {
      await authService.changePassword({ currentPassword, newPassword });
      Alert.alert(
        'Password changed',
        'For your security, you have been signed out of every device, including this one. Please log in again.',
        [{ text: 'OK', onPress: () => signOut() }]
      );
    } catch (err) {
      if (mountedRef.current) setPwError(getAuthErrorMessage(err));
    } finally {
      pwSavingRef.current = false;
      if (mountedRef.current) setPwSaving(false);
    }
  };

  // --- linked accounts: real (B4.3A) — user.authIdentities is server truth.
  // No unlink endpoint exists, so a linked provider is shown, never offered
  // an "Unlink" action that would fake a capability the backend doesn't have.
  const googleLinked = (user?.authIdentities || []).some((identity) => identity.provider === 'google');
  const googleAvailable = isGoogleAvailable();
  const [linking, setLinking] = useState(false);
  const linkingRef = useRef(false);
  const [linkError, setLinkError] = useState(null);

  const handleLinkGoogle = async () => {
    if (linkingRef.current) return;
    setLinkError(null);

    if (!googleAvailable) {
      setLinkError(getAuthErrorMessage({ code: 'GOOGLE_UNAVAILABLE' }));
      return;
    }

    linkingRef.current = true;
    setLinking(true);
    try {
      await linkGoogle();
    } catch (err) {
      if (err && err.code === 'GOOGLE_CANCELLED') {
        // Silent — the user backed out of the native picker.
      } else {
        setLinkError(getAuthErrorMessage(err));
      }
    } finally {
      linkingRef.current = false;
      if (mountedRef.current) setLinking(false);
    }
  };

  // --- sessions: no per-device list exists, but revoking every session at
  // once is real and already wired (used by admin suspension too). The
  // narrowest honest presentation of "sessions/devices" is one action, not a
  // fabricated device list.
  const handleSignOutEverywhere = () => {
    Alert.alert(
      'Sign out of all devices',
      'This ends every active WeCooked session, including this one.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign Out Everywhere', style: 'destructive', onPress: () => signOutEverywhere() },
      ]
    );
  };

  return (
    <View style={styles.root}>
      <TopBar mode="back" title="Security" onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.groupTitle}>CHANGE PASSWORD</Text>
        <Input
          label="Current Password"
          icon="lock-closed-outline"
          value={currentPassword}
          onChangeText={setCurrentPassword}
          secureTextEntry
          placeholder="Enter current password"
          editable={!pwSaving}
        />
        <Input
          label="New Password"
          icon="lock-closed-outline"
          value={newPassword}
          onChangeText={setNewPassword}
          secureTextEntry
          placeholder="At least 8 characters"
          editable={!pwSaving}
        />
        <Input
          label="Confirm New Password"
          icon="lock-closed-outline"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry
          placeholder="Re-enter new password"
          editable={!pwSaving}
        />
        {pwError ? <Text style={styles.fieldError}>{pwError}</Text> : null}

        <Button
          title="Change Password"
          variant="primary"
          onPress={handleChangePassword}
          loading={pwSaving}
          disabled={pwSaving}
          style={{ marginTop: spacing.sm }}
        />

        <Text style={[styles.groupTitle, { marginTop: spacing.xl }]}>LINKED ACCOUNTS</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Google</Text>
              <Text style={styles.rowSub}>
                {googleLinked
                  ? 'Linked to your WeCooked account.'
                  : googleAvailable
                    ? 'Not linked.'
                    : 'Not available in this build.'}
              </Text>
            </View>
            {googleLinked ? (
              <Ionicons name="checkmark-circle" size={20} color={colors.sageDeep} />
            ) : linking ? (
              <ActivityIndicator size="small" color={colors.sageDeep} />
            ) : (
              <Pressable onPress={handleLinkGoogle} disabled={!googleAvailable} hitSlop={8}>
                <Text style={[styles.linkAction, !googleAvailable && styles.linkActionDisabled]}>Link</Text>
              </Pressable>
            )}
          </View>
        </View>
        {linkError ? <Text style={styles.fieldError}>{linkError}</Text> : null}

        <Text style={[styles.groupTitle, { marginTop: spacing.xl }]}>TWO-FACTOR AUTHENTICATION</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Enable 2FA</Text>
              <Text style={styles.rowSub}>Coming soon — not yet available for WeCooked accounts.</Text>
            </View>
            <Switch
              value={false}
              disabled
              trackColor={{ false: colors.hairline, true: colors.sageDeep }}
              thumbColor={colors.onAccent}
            />
          </View>
        </View>

        <Text style={[styles.groupTitle, { marginTop: spacing.xl }]}>SESSIONS</Text>
        <View style={styles.card}>
          <Pressable style={styles.row} onPress={handleSignOutEverywhere}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Sign out of all devices</Text>
              <Text style={styles.rowSub}>
                WeCooked doesn't list individual devices yet — this ends every active session at
                once, including this one.
              </Text>
            </View>
            <Ionicons name="log-out-outline" size={18} color={colors.error} />
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
    groupTitle: {
      fontFamily: typography.body.semibold,
      fontSize: 10,
      color: colors.inkFaint,
      letterSpacing: 1,
      marginBottom: spacing.sm,
    },
    card: {
      backgroundColor: colors.paper,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.hairline,
      overflow: 'hidden',
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
    rowLabel: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.base,
      color: colors.ink,
    },
    rowSub: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.xs,
      color: colors.inkFaint,
      marginTop: 1,
    },
    linkAction: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.sm,
      color: colors.sageDeep,
    },
    linkActionDisabled: { opacity: 0.4 },
    fieldError: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.sm,
      color: colors.error,
      marginTop: spacing.xs,
      marginBottom: spacing.sm,
    },
  });
}
