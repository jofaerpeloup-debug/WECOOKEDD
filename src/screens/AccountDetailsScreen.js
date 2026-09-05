import React, { useState } from 'react';
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
import { useProfile } from '../context/ProfileContext';

const ALLERGY_CHOICES = ['Vegetarian', 'Vegan', 'Gluten-Free', 'Dairy-Free', 'Nut Allergy', 'Shellfish Allergy'];

const AVATAR_CHOICES = [
  chef.avatar,
  'https://i.pravatar.cc/240?img=5',
  'https://i.pravatar.cc/240?img=13',
  'https://i.pravatar.cc/240?img=32',
  'https://i.pravatar.cc/240?img=47',
  'https://i.pravatar.cc/240?img=53',
];

export default function AccountDetailsScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { profile, updateProfile } = useProfile();
  const [username, setUsername] = useState(profile.name);
  const [email, setEmail] = useState(profile.email);
  const [bio, setBio] = useState(profile.bio || '');
  const [avatar, setAvatar] = useState(profile.avatar || '');
  const [dietary, setDietary] = useState(profile.dietary || []);
  const [addingChip, setAddingChip] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);

  const initial = (username || 'A').trim().charAt(0).toUpperCase();

  const removeChip = (item) => setDietary((prev) => prev.filter((d) => d !== item));
  const addChip = (item) => {
    setDietary((prev) => (prev.includes(item) ? prev : [...prev, item]));
    setAddingChip(false);
  };

  const saveChanges = () => {
    updateProfile({
      name: username.trim() || profile.name,
      email: email.trim(),
      bio: bio.trim(),
      avatar,
      dietary,
    });
    navigation.goBack();
  };

  return (
    <View style={styles.root}>
      <TopBar mode="back" title="Account Details" onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.avatarSection}>
          <Pressable onPress={() => setAvatarOpen((v) => !v)}>
            {avatar ? (
              <Image source={{ uri: avatar }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarInitialWrap]}>
                <Text style={styles.avatarInitial}>{initial}</Text>
              </View>
            )}
            <View style={styles.avatarEditBadge}>
              <Ionicons name="camera" size={13} color={colors.onAccent} />
            </View>
          </Pressable>
          <Text style={styles.chefName}>{username}</Text>
          <Badge label={(chef.title || 'Home Cook').toUpperCase()} tone="sage" />
        </View>

        {avatarOpen && (
          <View style={styles.avatarPicker}>
            {AVATAR_CHOICES.map((uri) => (
              <Pressable
                key={uri}
                onPress={() => {
                  setAvatar(uri);
                  setAvatarOpen(false);
                }}
              >
                <Image
                  source={{ uri }}
                  style={[styles.avatarOption, avatar === uri && styles.avatarOptionOn]}
                />
              </Pressable>
            ))}
            <Pressable
              style={[styles.avatarOption, styles.avatarNone, !avatar && styles.avatarOptionOn]}
              onPress={() => {
                setAvatar('');
                setAvatarOpen(false);
              }}
            >
              <Text style={styles.avatarNoneText}>{initial}</Text>
            </Pressable>
          </View>
        )}

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
          label="Bio"
          icon="create-outline"
          value={bio}
          onChangeText={setBio}
          placeholder="A line about how you cook"
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

        <Text style={styles.label}>Dietary Preferences & Allergies</Text>
        <View style={styles.chipRow}>
          {dietary.map((item) => (
            <Pressable key={item} style={styles.chip} onPress={() => removeChip(item)}>
              <Text style={styles.chipText}>{item}</Text>
              <Ionicons name="close" size={13} color={colors.sageDeep} />
            </Pressable>
          ))}
          <Pressable style={styles.chipAdd} onPress={() => setAddingChip((v) => !v)}>
            <Ionicons name={addingChip ? 'close' : 'add'} size={16} color={colors.inkSoft} />
          </Pressable>
        </View>
        {addingChip && (
          <View style={styles.chipRow}>
            {ALLERGY_CHOICES.filter((c) => !dietary.includes(c)).map((c) => (
              <Pressable key={c} style={styles.chipChoice} onPress={() => addChip(c)}>
                <Text style={styles.chipChoiceText}>{c}</Text>
              </Pressable>
            ))}
          </View>
        )}

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
    avatarSection: { alignItems: 'center', marginBottom: spacing.xxl, gap: spacing.sm },
    avatar: { width: 84, height: 84, borderRadius: 42, borderWidth: 3, borderColor: colors.paper },
    avatarInitialWrap: { backgroundColor: colors.sageDeep, alignItems: 'center', justifyContent: 'center' },
    avatarInitial: { fontFamily: typography.display.fontFamily, fontSize: 30, color: colors.onAccent },
    avatarEditBadge: {
      position: 'absolute',
      right: 0,
      bottom: 0,
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: colors.sageDeep,
      borderWidth: 2,
      borderColor: colors.cream,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarPicker: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      gap: spacing.md,
      marginTop: -spacing.md,
      marginBottom: spacing.xl,
    },
    avatarOption: {
      width: 52,
      height: 52,
      borderRadius: 26,
      borderWidth: 2,
      borderColor: 'transparent',
      backgroundColor: colors.creamDeep,
    },
    avatarOptionOn: { borderColor: colors.sageDeep },
    avatarNone: { alignItems: 'center', justifyContent: 'center' },
    avatarNoneText: { fontFamily: typography.display.fontFamily, fontSize: 18, color: colors.inkSoft },
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
    chipChoice: {
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.hairline,
      paddingHorizontal: spacing.md,
      paddingVertical: 8,
    },
    chipChoiceText: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.sm,
      color: colors.inkSoft,
    },
  });
}
