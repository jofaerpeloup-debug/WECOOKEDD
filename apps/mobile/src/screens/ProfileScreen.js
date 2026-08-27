import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, Pressable, Alert, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { typography, spacing } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import TopBar from '../components/TopBar';
import { chef } from '../data/mockData';
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
  const insets = useSafeAreaInsets();
  const { signOut } = useAuth();
  const [viewerOpen, setViewerOpen] = useState(false);

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
          <Pressable onPress={() => setViewerOpen(true)}>
            <Image source={{ uri: chef.avatar }} style={styles.avatar} />
          </Pressable>
          <View>
            <Text style={styles.chefName}>{chef.name}</Text>
            <Text style={styles.chefSub}>{chef.email}</Text>
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

      <Modal visible={viewerOpen} transparent animationType="fade" onRequestClose={() => setViewerOpen(false)}>
        <Pressable style={styles.viewerBackdrop} onPress={() => setViewerOpen(false)}>
          <Pressable
            style={[styles.viewerClose, { top: insets.top + spacing.md }]}
            onPress={() => setViewerOpen(false)}
            hitSlop={10}
          >
            <Ionicons name="close" size={24} color="#fff" />
          </Pressable>
          <Image source={{ uri: chef.avatar }} style={styles.viewerImage} resizeMode="cover" />
        </Pressable>
      </Modal>
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
    avatar: { width: 56, height: 56, borderRadius: 28, borderWidth: 2, borderColor: colors.paper },
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
    viewerBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.92)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    viewerClose: {
      position: 'absolute',
      right: spacing.lg,
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: 'rgba(255,255,255,0.15)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    viewerImage: {
      width: 280,
      height: 280,
      borderRadius: 140,
      borderWidth: 4,
      borderColor: 'rgba(255,255,255,0.15)',
    },
  });
}
