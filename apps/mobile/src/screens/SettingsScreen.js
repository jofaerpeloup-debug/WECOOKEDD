import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import TopBar from '../components/TopBar';
import { settingsGroups } from '../data/mockData';
import { useAuth } from '../context/AuthContext';

const ROUTES = {
  personal: 'Profile',
  security: 'Security',
  notifications: 'Notifications',
  dietary: 'Profile',
  help: 'HelpCenter',
  about: 'About',
};

export default function SettingsScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { logout } = useAuth();

  const handleLogout = () => {
    Alert.alert('Log Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log Out',
        style: 'destructive',
        onPress: async () => {
          await logout();
          navigation.reset({ index: 0, routes: [{ name: 'Landing' }] });
        },
      },
    ]);
  };

  return (
    <View style={styles.root}>
      <TopBar mode="back" title="" onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Settings</Text>
        <Text style={styles.subtitle}>
          Manage your account preferences and culinary profile.
        </Text>

        {settingsGroups.map((group) => (
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
                  onPress={() => {
                    if (ROUTES[item.id]) navigation.navigate(ROUTES[item.id]);
                  }}
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

        <Pressable style={styles.logoutBtn} onPress={handleLogout}>
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
    logoutBtn: { alignItems: 'center', paddingVertical: spacing.lg },
    logoutText: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.md,
      color: colors.error,
    },
  });
}
