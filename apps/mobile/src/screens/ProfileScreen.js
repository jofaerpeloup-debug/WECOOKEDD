import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import TopBar from '../components/TopBar';
import Input from '../components/Input';
import Button from '../components/Button';
import Badge from '../components/Badge';
import { chef } from '../data/mockData';
import { loadJSON, saveJSON } from '../utils/storage';

const STORAGE_KEY = 'wecooked:profile';

export default function ProfileScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [username, setUsername] = useState(chef.name);
  const [email, setEmail] = useState(chef.email);
  const [dietary, setDietary] = useState(chef.dietary);

  useEffect(() => {
    (async () => {
      const stored = await loadJSON(STORAGE_KEY, null);
      if (stored) {
        setUsername(stored.username);
        setEmail(stored.email);
        setDietary(stored.dietary);
      }
    })();
  }, []);

  const removeChip = (item) => setDietary((prev) => prev.filter((d) => d !== item));

  const saveChanges = async () => {
    await saveJSON(STORAGE_KEY, { username, email, dietary });
    navigation.goBack();
  };

  return (
    <View style={styles.root}>
      <TopBar
        mode="back"
        title=""
        onBack={() => navigation.goBack()}
        onRightPress={() => navigation.navigate('Settings')}
        rightIcon="settings-outline"
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Profile Settings</Text>
        <Text style={styles.subtitle}>Manage your culinary identity</Text>

        <View style={styles.avatarSection}>
          <Image source={{ uri: chef.avatar }} style={styles.avatar} />
          <Text style={styles.chefName}>{username}</Text>
          <Badge label={chef.title.toUpperCase()} tone="sage" />
        </View>

        <Input label="Username" icon="person-outline" value={username} onChangeText={setUsername} />
        <Input
          label="Email"
          icon="mail-outline"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <Input
          label="Password"
          icon="lock-closed-outline"
          value="••••••••••"
          secureTextEntry
          editable={false}
          rightAction="Change Password"
          onRightActionPress={() => navigation.navigate('Security')}
        />

        <Text style={styles.label}>Dietary Preferences</Text>
        <View style={styles.chipRow}>
          {dietary.map((item) => (
            <Pressable key={item} style={styles.chip} onPress={() => removeChip(item)}>
              <Text style={styles.chipText}>{item}</Text>
              <Ionicons name="close" size={13} color={colors.sageDeep} />
            </Pressable>
          ))}
          <Pressable style={styles.chipAdd}>
            <Ionicons name="add" size={16} color={colors.inkSoft} />
          </Pressable>
        </View>

        <Button
          title="Save Changes"
          variant="primary"
          onPress={saveChanges}
          style={{ marginTop: spacing.xxl }}
        />
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
    },
    avatarSection: { alignItems: 'center', marginBottom: spacing.xxl, gap: spacing.sm },
    avatar: { width: 84, height: 84, borderRadius: 42, borderWidth: 3, borderColor: colors.paper },
    chefName: {
      fontFamily: typography.display.fontFamily,
      fontSize: 19,
      color: colors.ink,
      marginTop: spacing.xs,
    },
    label: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.sm,
      color: colors.inkSoft,
      marginBottom: spacing.sm,
    },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.sagePale,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.md,
      paddingVertical: 8,
    },
    chipText: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.sm,
      color: colors.sageDeep,
    },
    chipAdd: {
      width: 32,
      height: 32,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.hairline,
      borderStyle: 'dashed',
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
}
