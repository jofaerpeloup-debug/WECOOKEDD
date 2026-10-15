import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';

export default function AssistantHistoryPanel({ state, onOpen, onDelete, onRefresh, onMore }) {
  const { colors } = useTheme();
  const [confirmId, setConfirmId] = useState(null);
  const styles = StyleSheet.create({
    panel: { maxHeight: 250, padding: spacing.md, backgroundColor: colors.creamDeep, gap: spacing.sm },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    text: { fontFamily: typography.body.fontFamily, color: colors.ink, fontSize: 13 },
    button: { padding: spacing.sm, borderRadius: radius.md, minHeight: 44, justifyContent: 'center' },
  });
  const button = (label, onPress, disabled = false, text = label) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
      disabled={disabled} accessibilityState={{ disabled }} style={styles.button}>
      <Text style={styles.text}>{text}</Text>
    </Pressable>
  );
  return (
    <View style={styles.panel} accessibilityLabel="Saved conversation history">
      <Text style={styles.text}>History</Text>
      {state.listStatus === 'loading' ? <ActivityIndicator accessibilityLabel="Loading history" /> : null}
      {state.listError ? <Text accessibilityRole="alert" style={styles.text}>{state.listError}</Text> : null}
      {button(state.listError ? 'Retry history' : 'Refresh history', onRefresh, state.listStatus === 'loading')}
      {!state.conversations.length && state.listStatus !== 'loading' && !state.listError
        ? <Text style={styles.text}>No saved conversations yet.</Text> : null}
      <ScrollView keyboardShouldPersistTaps="handled">
        {state.conversations.map((row) => (
          <View key={row.id}>
            <Text style={styles.text}>{new Date(row.createdAt).toLocaleString()}</Text>
            <View style={styles.row}>
              {button(`Open chat ${new Date(row.createdAt).toLocaleString()}`, () => onOpen(row.id), false, 'Open')}
              {button(`Delete chat ${new Date(row.createdAt).toLocaleString()}`, () => setConfirmId(row.id), state.deleteStatus === 'loading', 'Delete')}
            </View>
            {confirmId === row.id ? <View>
              <Text style={styles.text}>Delete this saved conversation?</Text>
              {button('Confirm delete conversation', () => { setConfirmId(null); onDelete(row.id); }, state.deleteStatus === 'loading')}
              {button('Cancel delete', () => setConfirmId(null))}
            </View> : null}
          </View>
        ))}
      </ScrollView>
      {state.listPage.hasMore ? button('Load more history', onMore, state.listStatus === 'loading') : null}
      {state.deleteStatus === 'loading' ? <ActivityIndicator accessibilityLabel="Deleting conversation" /> : null}
      {state.deleteError ? <Text accessibilityRole="alert" style={styles.text}>{state.deleteError}</Text> : null}
    </View>
  );
}
