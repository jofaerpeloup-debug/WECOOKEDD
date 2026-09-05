import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import TopBar from '../components/TopBar';
import { settingsGroups } from '../data/mockData';

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

  return (
    <View style={styles.root}>
      <TopBar mode="back" title="" onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Settings</Text>
        <Text style={styles.subtitle}>
          Manage your account preferences and culinary profile.
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
  });
}
