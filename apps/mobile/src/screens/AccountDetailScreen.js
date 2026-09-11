import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import TopBar from '../components/TopBar';
import Input from '../components/Input';
import Button from '../components/Button';
import { useAuth } from '../context/AuthContext';
import { updateProfile } from '../api/profileService';
import { getAuthErrorMessage } from '../api/errorMessages';

// UX-only mirrors of the backend's API-boundary caps (self-profile-backend-api.md).
// The backend stays authoritative; these just give immediate feedback.
const MAX_NAME_LENGTH = 100;
const MAX_ENTRIES = 20;
const MAX_ENTRY_LENGTH = 50;

// One free-form string array editor (Dietary Preferences / Allergies). Local to
// this screen — the two instances are identical and used nowhere else.
function PreferenceSection({ title, placeholder, items, error, onAdd, onRemove, colors, styles }) {
  const [draft, setDraft] = useState('');

  const submit = () => {
    if (onAdd(draft)) setDraft('');
  };

  return (
    <View style={styles.section}>
      <Text style={styles.label}>{title}</Text>
      <View style={styles.chipRow}>
        {items.map((item) => (
          <Pressable key={item} style={styles.chip} onPress={() => onRemove(item)}>
            <Text style={styles.chipText}>{item}</Text>
            <Ionicons name="close" size={13} color={colors.sageDeep} />
          </Pressable>
        ))}
        {items.length === 0 && <Text style={styles.emptyHint}>None yet.</Text>}
      </View>

      <View style={styles.addRow}>
        <TextInput
          style={styles.addInput}
          value={draft}
          onChangeText={setDraft}
          placeholder={placeholder}
          placeholderTextColor={colors.inkFaint}
          returnKeyType="done"
          onSubmitEditing={submit}
          maxLength={MAX_ENTRY_LENGTH * 2}
        />
        <Pressable
          style={[styles.addBtn, !draft.trim() && styles.addBtnDisabled]}
          onPress={submit}
          disabled={!draft.trim()}
          hitSlop={6}
        >
          <Ionicons name="add" size={18} color={colors.onAccent} />
        </Pressable>
      </View>

      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
}

export default function AccountDetailsScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { user, syncUser } = useAuth();

  // Seeded ONCE from the authenticated user. Deliberately not re-synced from
  // `user` while mounted — that would clobber unsaved edits if the context
  // changes underneath the screen. This screen is pushed fresh each visit.
  const [name, setName] = useState(user?.name ?? '');
  const [dietary, setDietary] = useState(() => [
    ...(user?.preferences?.dietaryPreferences ?? []),
  ]);
  const [allergies, setAllergies] = useState(() => [...(user?.preferences?.allergies ?? [])]);

  const [dietaryError, setDietaryError] = useState(null);
  const [allergyError, setAllergyError] = useState(null);
  const [formError, setFormError] = useState(null);

  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  const trimmedName = name.trim();
  const nameInvalid = trimmedName.length === 0;
  const initial = (trimmedName || user?.name || 'A').charAt(0).toUpperCase();

  const showAvatarUnavailable = () => {
    Alert.alert('Avatar updates unavailable', 'Changing your avatar is not available yet.');
  };

  const makeAdd = (list, setList, setError) => (raw) => {
    const value = raw.trim();
    if (!value) return false;
    if (value.length > MAX_ENTRY_LENGTH) {
      setError('Keep entries under 50 characters');
      return false;
    }
    if (list.length >= MAX_ENTRIES) {
      setError('Up to 20 entries');
      return false;
    }
    // Exact, case-sensitive match — "Vegan" and "vegan" are different entries.
    if (list.includes(value)) {
      setError('Already added');
      return false;
    }
    // Functional update + guard so a fast double-tap can't append twice before
    // the re-render.
    setList((cur) => (cur.includes(value) ? cur : [...cur, value]));
    setError(null);
    return true;
  };

  const makeRemove = (list, setList, setError) => (item) => {
    setList(list.filter((entry) => entry !== item));
    setError(null);
  };

  const addDietary = makeAdd(dietary, setDietary, setDietaryError);
  const removeDietary = makeRemove(dietary, setDietary, setDietaryError);
  const addAllergy = makeAdd(allergies, setAllergies, setAllergyError);
  const removeAllergy = makeRemove(allergies, setAllergies, setAllergyError);

  const handleSave = async () => {
    if (savingRef.current) return;
    setFormError(null);
    if (nameInvalid) return;

    savingRef.current = true;
    setSaving(true);
    try {
      // Only the fields this screen owns. `notifications` is deliberately
      // omitted — the backend leaves omitted preference leaves untouched, so
      // sending it here could clobber a change made on the Notifications screen.
      const updated = await updateProfile({
        name: trimmedName,
        preferences: {
          dietaryPreferences: dietary,
          allergies,
        },
      });
      syncUser(updated);
      navigation.goBack();
    } catch (err) {
      setFormError(getAuthErrorMessage(err));
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  };

  return (
    <View style={styles.root}>
      <TopBar mode="back" title="Account Details" onBack={() => navigation.goBack()} />

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.avatarSection}>
          <Pressable
            onPress={showAvatarUnavailable}
            accessibilityRole="button"
            accessibilityLabel="Change avatar"
          >
            <View style={styles.avatar}>
              <Text style={styles.avatarInitial}>{initial}</Text>
            </View>
            <View style={styles.avatarEditBadge}>
              <Ionicons name="camera" size={13} color={colors.onAccent} />
            </View>
          </Pressable>
          <Text style={styles.chefName}>{trimmedName || user?.name}</Text>
        </View>

        <Input
          label="Name"
          icon="person-outline"
          value={name}
          onChangeText={setName}
          maxLength={MAX_NAME_LENGTH}
        />
        {nameInvalid ? <Text style={styles.fieldError}>Name is required.</Text> : null}

        <Text style={styles.label}>Email</Text>
        <View style={styles.readonlyRow}>
          <Ionicons name="mail-outline" size={17} color={colors.inkFaint} />
          <Text style={styles.readonlyValue}>{user?.email}</Text>
        </View>
        <Text style={styles.caption}>Email changes aren't available yet.</Text>

        <Input
          label="Bio"
          icon="create-outline"
          value=""
          editable={false}
          placeholder="Bio isn't available yet"
        />
        <Text style={styles.unsupportedCaption}>Bio editing isn't available yet.</Text>

        {/* Never the real password — a static masked placeholder that hands
            off to the real change-password flow on Security. */}
        <Input
          label="Password"
          icon="lock-closed-outline"
          value="••••••••••"
          secureTextEntry
          editable={false}
          rightAction="Change Password"
          onRightActionPress={() => navigation.navigate('Security')}
        />

        <PreferenceSection
          title="Dietary Preferences"
          placeholder="Add a dietary preference"
          items={dietary}
          error={dietaryError}
          onAdd={addDietary}
          onRemove={removeDietary}
          colors={colors}
          styles={styles}
        />

        <PreferenceSection
          title="Allergies"
          placeholder="Add an allergy"
          items={allergies}
          error={allergyError}
          onAdd={addAllergy}
          onRemove={removeAllergy}
          colors={colors}
          styles={styles}
        />

        {formError ? <Text style={styles.formError}>{formError}</Text> : null}

        <Button
          title="Save Changes"
          variant="primary"
          onPress={handleSave}
          loading={saving}
          disabled={saving || nameInvalid}
          style={{ marginTop: spacing.lg }}
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
    avatar: {
      width: 84,
      height: 84,
      borderRadius: 42,
      backgroundColor: colors.sageDeep,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 3,
      borderColor: colors.paper,
    },
    avatarInitial: {
      fontFamily: typography.display.fontFamily,
      fontSize: 30,
      color: colors.onAccent,
    },
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
    readonlyRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.creamDeep,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.hairline,
      paddingHorizontal: spacing.md,
      height: 48,
    },
    readonlyValue: {
      flex: 1,
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.base,
      color: colors.inkSoft,
    },
    caption: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.xs,
      color: colors.inkFaint,
      marginTop: spacing.xs,
      marginBottom: spacing.lg,
    },
    unsupportedCaption: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.xs,
      color: colors.inkFaint,
      marginTop: -spacing.md,
      marginBottom: spacing.lg,
    },
    section: { marginBottom: spacing.lg },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
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
    emptyHint: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.inkFaint,
      paddingVertical: 8,
    },
    addRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    addInput: {
      flex: 1,
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.base,
      color: colors.ink,
      backgroundColor: colors.paper,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.hairline,
      paddingHorizontal: spacing.md,
      height: 44,
      outlineStyle: 'none',
    },
    addBtn: {
      width: 44,
      height: 44,
      borderRadius: radius.md,
      backgroundColor: colors.sageDeep,
      alignItems: 'center',
      justifyContent: 'center',
    },
    addBtnDisabled: { opacity: 0.4 },
    fieldError: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.xs,
      color: colors.error,
      marginTop: spacing.xs,
    },
    formError: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.sm,
      color: colors.error,
      marginTop: spacing.lg,
      textAlign: 'center',
    },
  });
}
