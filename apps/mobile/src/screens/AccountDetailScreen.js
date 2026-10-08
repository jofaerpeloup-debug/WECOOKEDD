import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import TopBar from '../components/TopBar';
import Input from '../components/Input';
import Button from '../components/Button';
import { useAuth } from '../context/AuthContext';
import { resetAvatar, updateProfile, uploadAvatar } from '../api/profileService';
import { getAuthErrorMessage } from '../api/errorMessages';
import {
  ALLERGY_PRESETS,
  DIETARY_PRESETS,
  addPreference,
  editPreference,
  isPresetSelected,
  normalizePreferenceValues,
  togglePreset,
} from '../account/accountPreferences';

const MAX_NAME_LENGTH = 100;
const MAX_BIO_LENGTH = 500;
const MAX_ENTRY_LENGTH = 50;
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const AVATAR_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const COOKING_LEVELS = [['beginner', 'Beginner'], ['intermediate', 'Intermediate'], ['advanced', 'Advanced']];

function PreferenceSection({ title, placeholder, presets, items, error, onAdd, onEdit, onRemove, onTogglePreset, colors, styles, disabled }) {
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(null);
  const [editDraft, setEditDraft] = useState('');
  const submit = () => { if (onAdd(draft)) setDraft(''); };
  const presetKeys = new Set(presets.map((item) => item.toLowerCase()));
  const customItems = items.filter((item) => !presetKeys.has(item.trim().toLowerCase()));
  return <View style={styles.section}>
    <Text style={styles.label}>{title}</Text>
    <View style={styles.chipRow}>
      {presets.map((preset) => {
        const selected = isPresetSelected(items, preset);
        return <Pressable key={preset} style={[styles.chip, selected && styles.chipSelected]} onPress={() => onTogglePreset(preset)} disabled={disabled} accessibilityRole="checkbox" accessibilityState={{ checked: selected, disabled }}>
          <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{preset}</Text>
        </Pressable>;
      })}
    </View>
    <Text style={styles.subLabel}>Custom and legacy values</Text>
    <View style={styles.chipRow}>
      {customItems.map((item) => editing === item ? <View key={item} style={styles.editRow}>
        <TextInput style={styles.addInput} value={editDraft} onChangeText={setEditDraft} editable={!disabled} autoFocus accessibilityLabel={`Edit ${item}`} />
        <Pressable style={styles.addBtn} onPress={() => { if (onEdit(item, editDraft)) setEditing(null); }} disabled={disabled} accessibilityRole="button" accessibilityLabel={`Save edit for ${item}`}><Ionicons name="checkmark" size={18} color={colors.onAccent} /></Pressable>
      </View> : <View key={item} style={styles.chip}>
        <Text style={styles.chipText}>{item}</Text>
        <Pressable onPress={() => { setEditing(item); setEditDraft(item); }} disabled={disabled} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Edit ${item}`}><Ionicons name="pencil" size={13} color={colors.sageDeep} /></Pressable>
        <Pressable onPress={() => onRemove(item)} disabled={disabled} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove ${item}`}><Ionicons name="close" size={13} color={colors.sageDeep} /></Pressable>
      </View>)}
      {customItems.length === 0 && <Text style={styles.emptyHint}>None yet.</Text>}
    </View>
    <View style={styles.addRow}>
      <TextInput style={styles.addInput} value={draft} onChangeText={setDraft} placeholder={placeholder} placeholderTextColor={colors.inkFaint} returnKeyType="done" onSubmitEditing={submit} maxLength={MAX_ENTRY_LENGTH * 2} editable={!disabled} />
      <Pressable style={[styles.addBtn, (!draft.trim() || disabled) && styles.addBtnDisabled]} onPress={submit} disabled={!draft.trim() || disabled} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Add ${title}`}><Ionicons name="add" size={18} color={colors.onAccent} /></Pressable>
    </View>
    {error ? <Text style={styles.fieldError}>{error}</Text> : null}
  </View>;
}

export default function AccountDetailsScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { user, syncUser } = useAuth();
  const ownerId = user?.id || null;
  const [name, setName] = useState(user?.name ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [cookingLevel, setCookingLevel] = useState(user?.cookingLevel ?? 'beginner');
  const [dietary, setDietary] = useState(() => normalizePreferenceValues(user?.preferences?.dietaryPreferences ?? []));
  const [allergies, setAllergies] = useState(() => normalizePreferenceValues(user?.preferences?.allergies ?? []));
  const [dietaryError, setDietaryError] = useState(null);
  const [allergyError, setAllergyError] = useState(null);
  const [formError, setFormError] = useState(null);
  const [avatarError, setAvatarError] = useState(null);
  const [pendingKind, setPendingKind] = useState(null);
  const ownerRef = useRef(ownerId);
  const generationRef = useRef(0);
  const operationRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      operationRef.current = null;
    };
  }, []);
  useEffect(() => {
    if (ownerRef.current === ownerId) return;
    ownerRef.current = ownerId;
    generationRef.current += 1;
    operationRef.current = null;
    setPendingKind(null);
    setName(user?.name ?? ''); setBio(user?.bio ?? '');
    setCookingLevel(user?.cookingLevel ?? 'beginner');
    setDietary(normalizePreferenceValues(user?.preferences?.dietaryPreferences ?? []));
    setAllergies(normalizePreferenceValues(user?.preferences?.allergies ?? []));
    setFormError(null); setAvatarError(null);
  }, [ownerId, user]);

  const beginOperation = (kind) => {
    if (!ownerId || operationRef.current) return null;
    const operation = { kind, ownerId, generation: generationRef.current };
    operationRef.current = operation; setPendingKind(kind); return operation;
  };
  const isCurrent = (operation) => operationRef.current === operation && generationRef.current === operation.generation && ownerRef.current === operation.ownerId;
  const finishOperation = (operation) => { if (isCurrent(operation)) { operationRef.current = null; setPendingKind(null); } };
  const trimmedName = name.trim();
  const nameInvalid = trimmedName.length === 0;
  const initial = (trimmedName || user?.name || 'A').charAt(0).toUpperCase();
  const busy = pendingKind !== null;

  const makeAdd = (list, setList, setError) => (raw) => {
    if (busy) return false;
    const result = addPreference(list, raw);
    setError(result.error); if (result.error) return false;
    setList(result.values); return true;
  };
  const makeEdit = (list, setList, setError) => (oldValue, raw) => {
    if (busy) return false;
    const result = editPreference(list, oldValue, raw);
    setError(result.error); if (result.error) return false;
    setList(result.values); return true;
  };
  const makeToggle = (list, setList, setError) => (preset) => {
    if (busy) return;
    const result = togglePreset(list, preset);
    setError(result.error); if (!result.error) setList(result.values);
  };
  const makeRemove = (list, setList, setError) => (item) => { if (!busy) { setList(list.filter((entry) => entry !== item)); setError(null); } };

  const handleSave = async () => {
    setFormError(null); if (nameInvalid) return;
    const operation = beginOperation('save'); if (!operation) return;
    try {
      const updated = await updateProfile({
        name: trimmedName,
        bio,
        cookingLevel,
        preferences: {
          dietaryPreferences: normalizePreferenceValues(dietary),
          allergies: normalizePreferenceValues(allergies),
        },
      });
      if (!isCurrent(operation)) return;
      syncUser(updated); navigation.goBack();
    } catch (error) { if (isCurrent(operation)) setFormError(getAuthErrorMessage(error)); }
    finally { finishOperation(operation); }
  };

  const handleAvatarPick = async () => {
    setAvatarError(null);
    const operation = beginOperation('upload'); if (!operation) return;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 1 });
      if (!isCurrent(operation) || result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset) { setAvatarError('Choose a JPEG, PNG, or WebP image and try again.'); return; }
      if (asset.fileSize && asset.fileSize > MAX_AVATAR_BYTES) { setAvatarError('Choose an image no larger than 5 MiB.'); return; }
      if (asset.mimeType && !AVATAR_TYPES.has(asset.mimeType)) { setAvatarError('Choose a JPEG, PNG, or WebP image.'); return; }
      const updated = await uploadAvatar(asset);
      if (!isCurrent(operation)) return;
      syncUser(updated); setAvatarError(null);
    } catch (error) { if (isCurrent(operation)) setAvatarError(`${getAuthErrorMessage(error)} You can retry.`); }
    finally { finishOperation(operation); }
  };

  const confirmAvatarReset = () => {
    if (!user?.avatarUrl || busy) return;
    const confirmation = { ownerId, generation: generationRef.current };
    Alert.alert('Reset profile photo?', 'Your current profile photo will be removed.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: async () => {
        if (!mountedRef.current
          || ownerRef.current !== confirmation.ownerId
          || generationRef.current !== confirmation.generation) return;
        setAvatarError(null);
        const operation = beginOperation('reset'); if (!operation) return;
        try { const updated = await resetAvatar(); if (isCurrent(operation)) syncUser(updated); }
        catch (error) { if (isCurrent(operation)) setAvatarError(`${getAuthErrorMessage(error)} You can retry.`); }
        finally { finishOperation(operation); }
      } },
    ]);
  };

  return <View style={styles.root}>
    <TopBar mode="back" title="Account Details" onBack={() => navigation.goBack()} />
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <View style={styles.avatarSection}>
        {user?.avatarUrl ? <Image source={{ uri: user.avatarUrl }} style={styles.avatar} accessible accessibilityLabel={`${user?.name || 'Account'} avatar`} /> : <View style={styles.avatar} accessible accessibilityLabel={`${user?.name || 'Account'} initial`}><Text style={styles.avatarInitial}>{initial}</Text></View>}
        <Text style={styles.chefName}>{trimmedName || user?.name}</Text>
        <View style={styles.avatarActions}>
          <Pressable style={styles.avatarButton} onPress={handleAvatarPick} disabled={busy} accessibilityRole="button" accessibilityLabel={user?.avatarUrl ? 'Replace profile photo' : 'Upload profile photo'}>{pendingKind === 'upload' ? <ActivityIndicator size="small" color={colors.sageDeep} /> : <Text style={styles.avatarButtonText}>{user?.avatarUrl ? 'Replace photo' : 'Upload photo'}</Text>}</Pressable>
          {user?.avatarUrl ? <Pressable style={styles.avatarButton} onPress={confirmAvatarReset} disabled={busy} accessibilityRole="button" accessibilityLabel="Reset profile photo">{pendingKind === 'reset' ? <ActivityIndicator size="small" color={colors.error} /> : <Text style={styles.resetText}>Reset</Text>}</Pressable> : null}
        </View>
        {avatarError ? <Text style={styles.formError}>{avatarError}</Text> : null}
      </View>
      <Input label="Name" icon="person-outline" value={name} onChangeText={setName} maxLength={MAX_NAME_LENGTH} editable={!busy} />
      {nameInvalid ? <Text style={styles.fieldError}>Name is required.</Text> : null}
      <Text style={styles.label}>Email</Text><View style={styles.readonlyRow}><Ionicons name="mail-outline" size={17} color={colors.inkFaint} /><Text style={styles.readonlyValue}>{user?.email}</Text></View><Pressable onPress={() => navigation.navigate('Security')} accessibilityRole="button"><Text style={styles.caption}>Manage email changes in Security.</Text></Pressable>
      <Text style={styles.label}>Bio</Text><TextInput style={styles.bioInput} value={bio} onChangeText={setBio} maxLength={MAX_BIO_LENGTH} multiline editable={!busy} accessibilityLabel="Bio" /><Text style={styles.count}>{bio.length}/{MAX_BIO_LENGTH}</Text>
      <Text style={styles.label}>Cooking level</Text><View style={styles.levelRow} accessibilityRole="radiogroup">{COOKING_LEVELS.map(([value, label]) => <Pressable key={value} style={[styles.levelButton, cookingLevel === value && styles.levelButtonSelected]} onPress={() => setCookingLevel(value)} disabled={busy} accessibilityRole="radio" accessibilityState={{ checked: cookingLevel === value }} accessibilityLabel={label}><Text style={[styles.levelText, cookingLevel === value && styles.levelTextSelected]}>{label}</Text></Pressable>)}</View>
      <Input label="Password" icon="lock-closed-outline" value="••••••••••" secureTextEntry editable={false} rightAction="Change Password" onRightActionPress={() => navigation.navigate('Security')} />
      <PreferenceSection title="Dietary Preferences" placeholder="Add a dietary preference" presets={DIETARY_PRESETS} items={dietary} error={dietaryError} onAdd={makeAdd(dietary, setDietary, setDietaryError)} onEdit={makeEdit(dietary, setDietary, setDietaryError)} onRemove={makeRemove(dietary, setDietary, setDietaryError)} onTogglePreset={makeToggle(dietary, setDietary, setDietaryError)} colors={colors} styles={styles} disabled={busy} />
      <PreferenceSection title="Allergies & Ingredients to Avoid" placeholder="Add an allergy or ingredient" presets={ALLERGY_PRESETS} items={allergies} error={allergyError} onAdd={makeAdd(allergies, setAllergies, setAllergyError)} onEdit={makeEdit(allergies, setAllergies, setAllergyError)} onRemove={makeRemove(allergies, setAllergies, setAllergyError)} onTogglePreset={makeToggle(allergies, setAllergies, setAllergyError)} colors={colors} styles={styles} disabled={busy} />
      {formError ? <Text style={styles.formError}>{formError}</Text> : null}
      <Button title="Save Changes" variant="primary" onPress={handleSave} loading={pendingKind === 'save'} disabled={busy || nameInvalid} style={{ marginTop: spacing.lg }} />
    </ScrollView>
  </View>;
}

function makeStyles(colors) { return StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream }, scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl }, avatarSection: { alignItems: 'center', marginBottom: spacing.xxl, gap: spacing.sm },
  avatar: { width: 84, height: 84, borderRadius: 42, backgroundColor: colors.sageDeep, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: colors.paper }, avatarInitial: { fontFamily: typography.display.fontFamily, fontSize: 30, color: colors.onAccent }, chefName: { fontFamily: typography.display.fontFamily, fontSize: 19, color: colors.ink, marginTop: spacing.xs },
  avatarActions: { flexDirection: 'row', gap: spacing.sm }, avatarButton: { minHeight: 40, minWidth: 96, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.hairline, alignItems: 'center', justifyContent: 'center' }, avatarButtonText: { fontFamily: typography.body.semibold, fontSize: typography.sizes.xs, color: colors.sageDeep }, resetText: { fontFamily: typography.body.semibold, fontSize: typography.sizes.xs, color: colors.error },
  label: { fontFamily: typography.body.medium, fontSize: typography.sizes.sm, color: colors.inkSoft, marginBottom: spacing.sm }, readonlyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.creamDeep, borderRadius: radius.md, borderWidth: 1, borderColor: colors.hairline, paddingHorizontal: spacing.md, height: 48 }, readonlyValue: { flex: 1, fontFamily: typography.body.fontFamily, fontSize: typography.sizes.base, color: colors.inkSoft }, caption: { fontFamily: typography.body.fontFamily, fontSize: typography.sizes.xs, color: colors.inkFaint, marginTop: spacing.xs, marginBottom: spacing.lg },
  bioInput: { minHeight: 104, textAlignVertical: 'top', fontFamily: typography.body.fontFamily, fontSize: typography.sizes.base, color: colors.ink, backgroundColor: colors.paper, borderRadius: radius.md, borderWidth: 1, borderColor: colors.hairline, padding: spacing.md }, count: { textAlign: 'right', fontFamily: typography.body.fontFamily, fontSize: typography.sizes.xs, color: colors.inkFaint, marginTop: spacing.xs, marginBottom: spacing.lg }, levelRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg }, levelButton: { flex: 1, minHeight: 42, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.hairline, alignItems: 'center', justifyContent: 'center' }, levelButtonSelected: { backgroundColor: colors.sageDeep, borderColor: colors.sageDeep }, levelText: { fontFamily: typography.body.medium, fontSize: typography.sizes.xs, color: colors.inkSoft }, levelTextSelected: { color: colors.onAccent },
  section: { marginBottom: spacing.lg }, chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm }, chip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.sagePale, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 8 }, chipSelected: { backgroundColor: colors.sageDeep }, chipText: { fontFamily: typography.body.medium, fontSize: typography.sizes.sm, color: colors.sageDeep }, chipTextSelected: { color: colors.onAccent }, subLabel: { fontFamily: typography.body.medium, fontSize: typography.sizes.xs, color: colors.inkFaint, marginBottom: spacing.xs }, emptyHint: { fontFamily: typography.body.fontFamily, fontSize: typography.sizes.sm, color: colors.inkFaint, paddingVertical: 8 }, addRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, editRow: { width: '100%', flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, addInput: { flex: 1, fontFamily: typography.body.fontFamily, fontSize: typography.sizes.base, color: colors.ink, backgroundColor: colors.paper, borderRadius: radius.md, borderWidth: 1, borderColor: colors.hairline, paddingHorizontal: spacing.md, height: 44, outlineStyle: 'none' }, addBtn: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.sageDeep, alignItems: 'center', justifyContent: 'center' }, addBtnDisabled: { opacity: 0.4 }, fieldError: { fontFamily: typography.body.fontFamily, fontSize: typography.sizes.xs, color: colors.error, marginTop: spacing.xs }, formError: { fontFamily: typography.body.medium, fontSize: typography.sizes.sm, color: colors.error, marginTop: spacing.sm, textAlign: 'center' },
}); }
