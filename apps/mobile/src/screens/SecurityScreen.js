import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Switch, Pressable, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import TopBar from '../components/TopBar';
import Input, { PasswordRequirements } from '../components/Input';
import Button from '../components/Button';
import { useAuth } from '../context/AuthContext';
import * as authService from '../api/authService';
import { isAvailable as isGoogleAvailable } from '../auth/googleAuthFlow';
import {
  getAuthErrorMessage,
  getAuthFieldErrors,
  getEmailValidationError,
  getLegacyPasswordValidationError,
  getNewPasswordValidationError,
} from '../api/errorMessages';

export default function SecurityScreen({ navigation }) {
  const { colors, isDark } = useTheme();
  const styles = makeStyles(colors, isDark);
  const { user, signOut, signOutEverywhere, linkGoogle, refreshUser, deactivate } = useAuth();

  const mountedRef = useRef(true);
  useEffect(() => () => {
    mountedRef.current = false;
  }, []);
  const ownerRef = useRef(user?.id || null);
  const generationRef = useRef(0);
  const accountOperationRef = useRef(null);
  useEffect(() => {
    const ownerId = user?.id || null;
    if (ownerRef.current !== ownerId) {
      ownerRef.current = ownerId;
      generationRef.current += 1;
      accountOperationRef.current = null;
    }
  }, [user?.id]);
  const beginAccountOperation = (kind) => {
    if (!ownerRef.current || accountOperationRef.current) return null;
    const operation = { kind, ownerId: ownerRef.current, generation: generationRef.current };
    accountOperationRef.current = operation;
    return operation;
  };
  const ownsAccountOperation = (operation) => mountedRef.current
    && accountOperationRef.current === operation
    && ownerRef.current === operation.ownerId
    && generationRef.current === operation.generation;
  const finishAccountOperation = (operation) => {
    if (ownsAccountOperation(operation)) accountOperationRef.current = null;
  };

  const [newEmail, setNewEmail] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [emailChangeError, setEmailChangeError] = useState(null);
  const [emailChangeBusy, setEmailChangeBusy] = useState(false);
  const handleEmailChange = async () => {
    const emailError = getEmailValidationError(newEmail);
    const passwordError = getLegacyPasswordValidationError(emailPassword, 'Current password');
    if (emailError || passwordError) {
      setEmailChangeError(emailError || passwordError);
      return;
    }
    const operation = beginAccountOperation('email-change');
    if (!operation) return;
    setEmailChangeBusy(true);
    setEmailChangeError(null);
    try {
      await authService.requestEmailChange({ newEmail, currentPassword: emailPassword });
      if (!ownsAccountOperation(operation)) return;
      await refreshUser();
      if (ownsAccountOperation(operation)) {
        setNewEmail('');
        setEmailPassword('');
      }
    } catch (err) {
      if (ownsAccountOperation(operation)) setEmailChangeError(getAuthErrorMessage(err));
    } finally {
      if (ownsAccountOperation(operation)) setEmailChangeBusy(false);
      finishAccountOperation(operation);
    }
  };
  const handleCancelEmailChange = async () => {
    const operation = beginAccountOperation('email-change-cancel');
    if (!operation) return;
    setEmailChangeBusy(true);
    setEmailChangeError(null);
    try {
      await authService.cancelEmailChange();
      if (ownsAccountOperation(operation)) await refreshUser();
    } catch (err) {
      if (ownsAccountOperation(operation)) setEmailChangeError(getAuthErrorMessage(err));
    } finally {
      if (ownsAccountOperation(operation)) setEmailChangeBusy(false);
      finishAccountOperation(operation);
    }
  };

  const [deactivateConfirmation, setDeactivateConfirmation] = useState('');
  const [deactivateError, setDeactivateError] = useState(null);
  const [deactivateBusy, setDeactivateBusy] = useState(false);
  const handleDeactivate = async () => {
    if (deactivateConfirmation !== 'DEACTIVATE') return;
    const operation = beginAccountOperation('deactivate');
    if (!operation) return;
    setDeactivateBusy(true);
    setDeactivateError(null);
    try {
      await deactivate();
    } catch (err) {
      if (ownsAccountOperation(operation)) setDeactivateError(getAuthErrorMessage(err));
    } finally {
      if (ownsAccountOperation(operation)) setDeactivateBusy(false);
      finishAccountOperation(operation);
    }
  };

  // --- change password: the only real credential mutation this screen owns.
  // POST /auth/change-password revokes EVERY session for this user on
  // success (including this device's), so a successful change must be
  // followed by the real AuthContext.signOut() — never a fabricated "saved"
  // state that leaves a now-dead token in memory.
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwError, setPwError] = useState(null);
  const [pwFieldErrors, setPwFieldErrors] = useState({});
  const [pwSaving, setPwSaving] = useState(false);
  const pwSavingRef = useRef(false);

  const handleChangePassword = async () => {
    if (pwSavingRef.current) return;
    setPwError(null);

    const nextFieldErrors = {
      currentPassword: getLegacyPasswordValidationError(currentPassword, 'Current password'),
      newPassword: getNewPasswordValidationError(newPassword),
      confirmPassword: newPassword === confirmPassword ? null : 'Passwords do not match.',
    };
    if (Object.values(nextFieldErrors).some(Boolean)) {
      setPwFieldErrors(nextFieldErrors);
      return;
    }
    setPwFieldErrors({});

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
      if (mountedRef.current) {
        const apiFieldErrors = getAuthFieldErrors(err, ['currentPassword', 'newPassword']);
        setPwFieldErrors(apiFieldErrors);
        if (Object.keys(apiFieldErrors).length === 0) setPwError(getAuthErrorMessage(err));
      }
    } finally {
      pwSavingRef.current = false;
      if (mountedRef.current) setPwSaving(false);
    }
  };

  // --- email verification: does NOT gate login or any feature — this is an
  // honest status readout plus a real resend action, nothing more. The
  // backend's resend-verification response is deliberately generic (identical
  // for eligible/ineligible), so this never learns or shows anything beyond
  // "a link was requested" — it cannot report send failure or ineligibility.
  const [resendState, setResendState] = useState('idle'); // idle | sending | sent
  const [resendError, setResendError] = useState(null);

  const handleResendVerification = async () => {
    if (resendState === 'sending' || !user?.email) return;
    setResendError(null);
    setResendState('sending');
    try {
      await authService.resendVerification(user.email);
      if (mountedRef.current) setResendState('sent');
    } catch (err) {
      if (mountedRef.current) {
        setResendState('idle');
        setResendError(getAuthErrorMessage(err));
      }
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
        <Text style={styles.groupTitle}>EMAIL CHANGE</Text>
        <View style={styles.card}>
          <View style={styles.formCard}>
            <Text style={styles.rowLabel}>Current email</Text>
            <Text style={styles.rowSub}>{user?.email}</Text>
            <Text style={styles.rowSub}>
              Email changes require your current WeCooked password. Accounts that sign in only
              with Google cannot change their email in WeCooked.
            </Text>
            {user?.pendingEmailChange ? (
              <View style={styles.pendingRow}>
                <Text style={styles.rowSub}>Pending: {user.pendingEmailChange.email}</Text>
                <Pressable onPress={handleCancelEmailChange} disabled={emailChangeBusy} accessibilityRole="button" accessibilityLabel="Cancel email change request">
                  <Text style={styles.linkAction}>Cancel request</Text>
                </Pressable>
              </View>
            ) : null}
            <Input label="New Email" icon="mail-outline" value={newEmail} onChangeText={setNewEmail} autoCapitalize="none" keyboardType="email-address" editable={!emailChangeBusy} />
            <Input label="Current Password" icon="lock-closed-outline" value={emailPassword} onChangeText={setEmailPassword} secureTextEntry editable={!emailChangeBusy} />
            {emailChangeError ? <Text style={styles.fieldError}>{emailChangeError}</Text> : null}
            <Button title="Send verification link" onPress={handleEmailChange} loading={emailChangeBusy} disabled={emailChangeBusy} />
          </View>
        </View>

        <Text style={[styles.groupTitle, styles.sectionAfterCard]}>CHANGE PASSWORD</Text>
        <Input
          label="Current Password"
          required
          icon="lock-closed-outline"
          value={currentPassword}
          onChangeText={(value) => {
            setCurrentPassword(value);
            setPwFieldErrors((current) => ({ ...current, currentPassword: null }));
          }}
          secureTextEntry
          placeholder="Enter current password"
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          autoComplete="current-password"
          textContentType="password"
          editable={!pwSaving}
          error={pwFieldErrors.currentPassword}
        />
        <Input
          label="New Password"
          required
          icon="lock-closed-outline"
          value={newPassword}
          onChangeText={(value) => {
            setNewPassword(value);
            setPwFieldErrors((current) => ({ ...current, newPassword: null }));
          }}
          secureTextEntry
          placeholder="At least 8 characters"
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          autoComplete="new-password"
          textContentType="newPassword"
          editable={!pwSaving}
          error={pwFieldErrors.newPassword}
        />
        <PasswordRequirements value={newPassword} />
        <Input
          label="Confirm New Password"
          required
          icon="lock-closed-outline"
          value={confirmPassword}
          onChangeText={(value) => {
            setConfirmPassword(value);
            setPwFieldErrors((current) => ({ ...current, confirmPassword: null }));
          }}
          secureTextEntry
          placeholder="Re-enter new password"
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          autoComplete="new-password"
          textContentType="newPassword"
          editable={!pwSaving}
          error={pwFieldErrors.confirmPassword}
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

        <Text style={[styles.groupTitle, { marginTop: spacing.xl }]}>EMAIL VERIFICATION</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>{user?.email}</Text>
              <Text style={styles.rowSub}>
                {user?.emailVerified ? 'Verified.' : 'Not verified yet.'}
              </Text>
            </View>
            {user?.emailVerified ? (
              <Ionicons name="checkmark-circle" size={20} color={colors.sageDeep} />
            ) : resendState === 'sending' ? (
              <ActivityIndicator size="small" color={colors.sageDeep} />
            ) : (
              <Pressable onPress={handleResendVerification} hitSlop={8} accessibilityRole="button" accessibilityLabel="Resend email verification">
                <Text style={styles.linkAction}>
                  {resendState === 'sent' ? 'Link sent' : 'Resend'}
                </Text>
              </Pressable>
            )}
          </View>
        </View>
        {resendError ? <Text style={styles.fieldError}>{resendError}</Text> : null}
        {!user?.emailVerified && resendState === 'sent' ? (
          <Text style={styles.caption}>
            If that address can receive mail, a verification link is on its way.
          </Text>
        ) : null}

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
              <Pressable onPress={handleLinkGoogle} disabled={!googleAvailable} hitSlop={8} accessibilityRole="button" accessibilityLabel="Link Google account">
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
          <Pressable style={styles.row} onPress={handleSignOutEverywhere} accessibilityRole="button" accessibilityLabel="Sign out of all devices">
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

        <Text style={[styles.groupTitle, { marginTop: spacing.xl }]}>DEACTIVATE ACCOUNT</Text>
        <View style={styles.card}>
          <View style={styles.formCard}>
            <Text style={styles.rowSub}>Deactivation is reversible. Sign in normally to reactivate your account. Type DEACTIVATE to continue.</Text>
            <Input label="Confirmation" value={deactivateConfirmation} onChangeText={setDeactivateConfirmation} autoCapitalize="characters" editable={!deactivateBusy} />
            {deactivateError ? <Text style={styles.fieldError}>{deactivateError}</Text> : null}
            <Button title="Deactivate Account" variant="outline" onPress={handleDeactivate} loading={deactivateBusy} disabled={deactivateBusy || deactivateConfirmation !== 'DEACTIVATE'} />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function makeStyles(colors, isDark) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
    sectionAfterCard: { marginTop: spacing.xl },
    groupTitle: {
      fontFamily: typography.body.semibold,
      fontSize: 10,
      color: colors.inkSoft,
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
    formCard: { padding: spacing.md, gap: spacing.sm },
    pendingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
    rowLabel: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.base,
      color: colors.ink,
    },
    rowSub: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.xs,
      color: colors.inkSoft,
      marginTop: 1,
    },
    linkAction: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.sm,
      color: isDark ? colors.inkSoft : colors.sageDeep,
    },
    linkActionDisabled: { color: colors.inkSoft },
    fieldError: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.sm,
      color: colors.error,
      marginTop: spacing.xs,
      marginBottom: spacing.sm,
    },
    caption: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.xs,
      color: colors.inkSoft,
      marginTop: spacing.xs,
    },
  });
}
