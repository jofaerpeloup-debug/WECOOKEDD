import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';
import { typography, spacing, radius } from '../theme/theme';

export default function MealPlanReminderSheet({ entry, visible, pending, error, status, onSave, onCancelReminder, onClose, onRetry, onManualRetry, onRequestPermission, onOpenSettings }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors);
  const [localTime, setLocalTime] = useState('09:00');
  const [timeZone, setTimeZone] = useState('UTC');
  useEffect(() => {
    if (!visible || !entry) return;
    setLocalTime(entry.reminder?.localTime || '09:00');
    setTimeZone(entry.reminder?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  }, [visible, entry?.id]);
  if (!entry) return null;
  const stateText = entry.reminder && status?.kind === 'scheduled' && !status?.selectedIds?.has(entry.id)
    ? 'Saved; awaiting device capacity' : entry.reminder ? {
    scheduled: 'Scheduled on this device', pending: 'Saved; synchronization pending',
    unavailable: 'Saved; device alerts unavailable', degraded: 'Synchronization unavailable; manual retry or support needed',
  }[status?.kind] || 'Saved; synchronization pending' : 'Off';
  const note = status?.permission === 'quiet' ? 'iOS will deliver this quietly.'
    : status?.permission === 'temporary' ? 'iOS permission is temporary.' : null;
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
    <Pressable style={styles.backdrop} onPress={onClose} disabled={pending} />
    <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.xl) }]} accessibilityViewIsModal>
      <Text style={styles.title} accessibilityRole="header">Meal reminder</Text>
      <Text style={styles.copy}>One alert for {entry.dateKey}. Time uses the zone shown below.</Text>
      <Text style={styles.label}>Time (24 hour HH:mm)</Text>
      <TextInput value={localTime} onChangeText={setLocalTime} maxLength={5} placeholder="09:00" keyboardType="numbers-and-punctuation" style={styles.input} accessibilityLabel="Reminder time" />
      <Text style={styles.label}>Time zone: {timeZone}</Text>
      <Pressable onPress={() => setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')} disabled={pending}><Text style={styles.link}>Use current device zone</Text></Pressable>
      <Text style={styles.copy}>{stateText}</Text>
      {note ? <Text style={styles.copy}>{note}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable style={styles.primary} disabled={pending || !/^([01]\d|2[0-3]):[0-5]\d$/.test(localTime)} onPress={() => onSave(localTime, timeZone)} accessibilityRole="button"><Text style={styles.primaryText}>{pending ? 'Saving…' : 'Save reminder'}</Text></Pressable>
      {entry.reminder ? <Pressable onPress={onCancelReminder} disabled={pending}><Text style={styles.link}>Turn reminder off</Text></Pressable> : null}
      <Pressable onPress={onRequestPermission} disabled={pending}><Text style={styles.link}>Enable device alerts</Text></Pressable>
      <Pressable onPress={onOpenSettings} disabled={pending}><Text style={styles.link}>Open device settings</Text></Pressable>
      <Pressable onPress={onRetry} disabled={pending}><Text style={styles.link}>Retry synchronization</Text></Pressable>
      {status?.kind === 'degraded' ? <Pressable onPress={onManualRetry} disabled={pending}><Text style={styles.link}>Manual recovery retry</Text></Pressable> : null}
      <Pressable onPress={onClose} disabled={pending}><Text style={styles.link}>Close</Text></Pressable>
      {pending ? <ActivityIndicator /> : null}
    </View>
  </Modal>;
}

function makeStyles(colors) { return StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#0007' },
  sheet: { backgroundColor: colors.paper, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.xl, gap: spacing.sm },
  title: { fontFamily: typography.display.fontFamily, color: colors.ink, fontSize: 22 },
  copy: { fontFamily: typography.body.fontFamily, color: colors.inkSoft, fontSize: 13 },
  label: { fontFamily: typography.body.semibold, color: colors.ink, fontSize: 13 },
  input: { borderWidth: 1, borderColor: colors.hairline, borderRadius: radius.md, padding: spacing.md, color: colors.ink },
  primary: { backgroundColor: colors.sageDeep, borderRadius: radius.pill, padding: spacing.md, alignItems: 'center' },
  primaryText: { color: colors.onAccent, fontFamily: typography.body.semibold },
  link: { color: colors.sageDeep, fontFamily: typography.body.semibold, paddingVertical: spacing.xs },
  error: { color: colors.error, fontFamily: typography.body.fontFamily },
}); }
