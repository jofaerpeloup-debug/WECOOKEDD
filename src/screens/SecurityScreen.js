import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Switch } from 'react-native';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import TopBar from '../components/TopBar';
import Input from '../components/Input';
import Button from '../components/Button';
import { notify } from '../utils/alert';
import { loadJSON, saveJSON } from '../utils/storage';

const TFA_KEY = 'wecooked:twoFactor';

export default function SecurityScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [twoFactor, setTwoFactor] = useState(false);
  const hydrated = useRef(false);

  useEffect(() => {
    (async () => {
      setTwoFactor(await loadJSON(TFA_KEY, false));
      hydrated.current = true;
    })();
  }, []);
  useEffect(() => {
    if (hydrated.current) saveJSON(TFA_KEY, twoFactor);
  }, [twoFactor]);

  const save = () => {
    if (newPassword && newPassword !== confirmPassword) {
      notify("Passwords don't match", 'Double-check your new password and try again.');
      return;
    }
    notify('Security updated', 'Your preferences have been saved.', () => navigation.goBack());
  };

  return (
    <View style={styles.root}>
      <TopBar mode="back" title="Security" onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.demoNote}>
          WeCooked is a demo — sign-in doesn't check a real password. These settings are saved to
          your device.
        </Text>
        <Text style={styles.groupTitle}>CHANGE PASSWORD</Text>
        <Input
          label="Current Password"
          icon="lock-closed-outline"
          value={currentPassword}
          onChangeText={setCurrentPassword}
          secureTextEntry
          placeholder="Enter current password"
        />
        <Input
          label="New Password"
          icon="lock-closed-outline"
          value={newPassword}
          onChangeText={setNewPassword}
          secureTextEntry
          placeholder="At least 8 characters"
        />
        <Input
          label="Confirm New Password"
          icon="lock-closed-outline"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry
          placeholder="Re-enter new password"
        />

        <Text style={[styles.groupTitle, { marginTop: spacing.md }]}>TWO-FACTOR AUTHENTICATION</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Enable 2FA</Text>
              <Text style={styles.rowSub}>Require a code from your authenticator app at login</Text>
            </View>
            <Switch
              value={twoFactor}
              onValueChange={setTwoFactor}
              trackColor={{ false: colors.hairline, true: colors.sageDeep }}
              thumbColor={colors.onAccent}
            />
          </View>
        </View>

        <Button title="Save Changes" variant="primary" onPress={save} style={{ marginTop: spacing.xxl }} />
      </ScrollView>
    </View>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
    demoNote: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.xs,
      color: colors.inkFaint,
      lineHeight: 17,
      marginBottom: spacing.lg,
    },
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
  });
}
