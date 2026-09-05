import React from 'react';
import { View, Text, StyleSheet, ScrollView, Switch } from 'react-native';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import TopBar from '../components/TopBar';
import { notificationSettings } from '../data/mockData';
import { useNotifications } from '../context/NotificationsContext';

export default function NotificationsScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { prefs, setPref } = useNotifications();

  return (
    <View style={styles.root}>
      <TopBar mode="back" title="Notifications" onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.subtitle}>Choose what WeCooked can notify you about.</Text>

        <View style={styles.card}>
          {notificationSettings.map((item, i) => (
            <View
              key={item.id}
              style={[styles.row, i < notificationSettings.length - 1 && styles.rowBorder]}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>{item.label}</Text>
                <Text style={styles.rowSub}>{item.sub}</Text>
              </View>
              <Switch
                value={!!prefs[item.id]}
                onValueChange={(v) => setPref(item.id, v)}
                trackColor={{ false: colors.hairline, true: colors.sageDeep }}
                thumbColor={colors.onAccent}
              />
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
    subtitle: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.inkSoft,
      marginBottom: spacing.lg,
      lineHeight: 19,
    },
    card: {
      backgroundColor: colors.paper,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.hairline,
      overflow: 'hidden',
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
    rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.hairline },
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
