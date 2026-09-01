import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { typography, spacing } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import TopBar from '../components/TopBar';
import { useAuth } from '../context/AuthContext';

const ITEMS = [
  { id: 'account', icon: 'person-outline', label: 'My Account', route: 'AccountDetails' },
  { id: 'community', icon: 'people-outline', label: 'Community', route: 'Community' },
  { id: 'settings', icon: 'settings-outline', label: 'Settings', route: 'Settings' },
  { id: 'terms', icon: 'document-text-outline', label: 'Terms & Conditions', route: 'Terms' },
  { id: 'privacy', icon: 'shield-checkmark-outline', label: 'Privacy Policy', route: 'Privacy' },
  { id: 'help', icon: 'help-circle-outline', label: 'Help Center', route: 'HelpCenter' },
  { id: 'logout', icon: 'log-out-outline', label: 'Log out', danger: true },
];

export default function ProfileScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { user, signOut } = useAuth();

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

  const pressItem = (item) => {
    if (item.id === 'logout') handleLogout();
    else if (item.route) navigation.navigate(item.route);
  };

  return (
    <View style={styles.root}>
      <TopBar mode="brand" />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          {/* Backend has no avatar field — a neutral glyph, not a photo or an
              editable affordance. */}
          <View style={styles.avatar}>
            <Ionicons name="person" size={26} color={colors.sageDeep} />
          </View>
          <View>
            <Text style={styles.chefName}>{user?.name}</Text>
            <Text style={styles.chefSub}>{user?.email}</Text>
          </View>
        </View>
        <View style={styles.headerDivider} />

        {ITEMS.map((item, i) => (
          <Pressable
            key={item.id}
            style={[styles.row, i < ITEMS.length - 1 && styles.rowBorder]}
            onPress={() => pressItem(item)}
          >
            <View style={[styles.iconWrap, item.danger && styles.iconWrapDanger]}>
              <Ionicons
                name={item.icon}
                size={17}
                color={item.danger ? colors.error : colors.sageDeep}
              />
            </View>
            <Text style={[styles.rowLabel, item.danger && { color: colors.error }]}>
              {item.label}
            </Text>
            <Ionicons name="chevron-forward" size={17} color={colors.inkFaint} />
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      marginBottom: spacing.lg,
    },
    avatar: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.sagePale,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: colors.paper,
    },
    chefName: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.lg,
      color: colors.ink,
    },
    chefSub: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.inkFaint,
      marginTop: 2,
    },
    headerDivider: {
      height: 1,
      backgroundColor: colors.hairline,
      marginBottom: spacing.sm,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing.md,
    },
    rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.hairline },
    iconWrap: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.sagePale,
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconWrapDanger: { backgroundColor: colors.errorBg },
    rowLabel: {
      flex: 1,
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.base,
      color: colors.ink,
    },
  });
}
