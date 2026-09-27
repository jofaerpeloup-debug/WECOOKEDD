import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import TopBar from '../components/TopBar';
import { useAuth } from '../context/AuthContext';

const SETTINGS_GROUPS = [
  {
    title: 'Account',
    items: [
      { id: 'personal', icon: 'person-outline', label: 'Personal Info', sub: 'Name and preferences' },
      { id: 'security', icon: 'shield-checkmark-outline', label: 'Security', sub: 'Password, verification, sessions' },
    ],
  },
  {
    title: 'Preferences',
    items: [
      { id: 'notifications', icon: 'notifications-outline', label: 'Notifications', sub: 'Account-wide on or off' },
    ],
  },
  {
    title: 'Support',
    items: [
      { id: 'help', icon: 'help-circle-outline', label: 'Help Center' },
      { id: 'about', icon: 'information-circle-outline', label: 'About' },
    ],
  },
  {
    title: 'Legal',
    items: [
      { id: 'terms', icon: 'document-text-outline', label: 'Terms of Service' },
      { id: 'privacy', icon: 'lock-closed-outline', label: 'Privacy Policy' },
      { id: 'licenses', icon: 'code-slash-outline', label: 'Open Source Licenses' },
    ],
  },
];

const ROUTES = {
  personal: 'AccountDetails',
  security: 'Security',
  notifications: 'Notifications',
  help: 'HelpCenter',
  about: 'About',
  terms: 'Terms',
  privacy: 'Privacy',
  licenses: 'Licenses',
};

const APPEARANCE_OPTIONS = [
  { id: 'light', label: 'Light', icon: 'sunny-outline' },
  { id: 'dark', label: 'Dark', icon: 'moon-outline' },
  { id: 'system', label: 'System', icon: 'phone-portrait-outline' },
];

export default function SettingsScreen({ navigation }) {
  const { colors, mode, setMode } = useTheme();
  const styles = makeStyles(colors);
  const { signOut } = useAuth();

  const handleLogout = () => {
    Alert.alert('Log Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log Out',
        style: 'destructive',
        // signOut() revokes the backend session, clears the tokens, and flips
        // auth state — RootNavigator then swaps back to the Landing stack.
        onPress: () => signOut(),
      },
    ]);
  };

  return (
    <View style={styles.root}>
      <TopBar mode="back" title="" onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.title} accessibilityRole="header">Settings</Text>
        <Text style={styles.subtitle}>
          Manage appearance, account details, and supported preferences.
        </Text>

        <View style={styles.group}>
          <Text style={styles.groupTitle}>APPEARANCE</Text>
          <View style={styles.segmentRow}>
            {APPEARANCE_OPTIONS.map((opt) => {
              const active = mode === opt.id;
              return (
                <Pressable
                  key={opt.id}
                  style={[styles.segment, active && styles.segmentActive]}
                  onPress={() => setMode(opt.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`${opt.label} appearance`}
                  accessibilityState={{ selected: active }}
                >
                  <Ionicons
                    name={opt.icon}
                    size={16}
                    color={active ? colors.onAccent : colors.inkSoft}
                  />
                  <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {SETTINGS_GROUPS.map((group) => (
          <View key={group.title} style={styles.group}>
            <Text style={styles.groupTitle}>{group.title.toUpperCase()}</Text>
            <View style={styles.card}>
              {group.items.map((item, i) => (
                <Pressable
                  key={item.id}
                  style={[
                    styles.row,
                    i < group.items.length - 1 && styles.rowBorder,
                  ]}
                  onPress={() => navigation.navigate(ROUTES[item.id])}
                  accessibilityRole="button"
                  accessibilityLabel={item.label}
                >
                  <View style={styles.iconWrap}>
                    <Ionicons name={item.icon} size={17} color={colors.sageDeep} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowLabel}>{item.label}</Text>
                    {item.sub && <Text style={styles.rowSub}>{item.sub}</Text>}
                  </View>
                  <Ionicons name="chevron-forward" size={17} color={colors.inkFaint} />
                </Pressable>
              ))}
            </View>
          </View>
        ))}

        <Pressable
          style={styles.logoutBtn}
          onPress={handleLogout}
          accessibilityRole="button"
          accessibilityLabel="Log out"
        >
          <Text style={styles.logoutText}>Log Out</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
    title: {
      fontFamily: typography.display.fontFamily,
      fontSize: 26,
      color: colors.ink,
      marginBottom: 4,
    },
    subtitle: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.inkSoft,
      marginBottom: spacing.xl,
      lineHeight: 19,
    },
    group: { marginBottom: spacing.xl },
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
    segmentRow: {
      flexDirection: 'row',
      backgroundColor: colors.paper,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.hairline,
      padding: 4,
      gap: 4,
    },
    segment: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: spacing.sm,
      borderRadius: radius.md,
    },
    segmentActive: { backgroundColor: colors.sageDeep },
    segmentLabel: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.sm,
      color: colors.inkSoft,
    },
    segmentLabelActive: { color: colors.onAccent },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      padding: spacing.md,
    },
    rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.hairline },
    iconWrap: {
      width: 34,
      height: 34,
      borderRadius: 10,
      backgroundColor: colors.sagePale,
      alignItems: 'center',
      justifyContent: 'center',
    },
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
    logoutBtn: { minHeight: 52, alignItems: 'center', justifyContent: 'center' },
    logoutText: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.md,
      color: colors.error,
    },
  });
}
