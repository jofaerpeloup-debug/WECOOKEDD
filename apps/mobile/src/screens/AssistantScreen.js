import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';

const QUICK_PROMPTS = [
  'What can I cook fast?',
  'Substitute for coconut milk',
  'Something cozy for dinner',
  'I have chicken and garlic',
];

// The teammate-final Assistant composition remains intact while its backend is
// deferred. Draft text is transient; submitting never creates a user bubble,
// generates a reply, or writes conversation state to device storage.
export default function AssistantScreen({ navigation }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors);
  const [input, setInput] = useState('');

  const send = () => {
    if (!input.trim()) return;
    Alert.alert(
      'Chef Assistant unavailable',
      'Conversational cooking help is not connected yet. Your message was not sent or saved.'
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable style={styles.iconBtn} hitSlop={8} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={16} color={colors.ink} />
        </Pressable>
        <View style={styles.headerMark}>
          <MaterialCommunityIcons name="chef-hat" size={16} color={colors.sageDeep} />
        </View>
        <Text style={styles.headerTitle}>Ask the Chef</Text>
      </View>

      <ScrollView
        style={styles.scrollFlex}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <View style={styles.introIcon}>
          <MaterialCommunityIcons name="chef-hat" size={20} color={colors.sageDeep} />
        </View>
        <Text style={styles.introText}>
          Ask about recipes, ingredient swaps, or meal ideas when Chef Assistant becomes
          available.
        </Text>

        <View style={styles.prompts}>
          {QUICK_PROMPTS.map((prompt) => (
            <Pressable key={prompt} style={styles.prompt} onPress={() => setInput(prompt)}>
              <Text style={styles.promptText}>{prompt}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.msgRow}>
          <Text style={styles.sender}>AVAILABILITY</Text>
          <View style={[styles.bubble, styles.bubbleAi]}>
            <Text style={styles.bubbleText}>
              Chef Assistant isn&apos;t connected yet. You can compose a question below, but it
              won&apos;t be sent or saved.
            </Text>
          </View>
        </View>
      </ScrollView>

      <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        <TextInput
          style={styles.input}
          placeholder="Ask anything..."
          placeholderTextColor={colors.inkFaint}
          value={input}
          onChangeText={setInput}
          onSubmitEditing={send}
          returnKeyType="send"
        />
        <Pressable style={styles.sendBtn} onPress={send} accessibilityLabel="Send question">
          <Ionicons name="arrow-up" size={18} color={colors.onAccent} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: spacing.xl,
      paddingBottom: spacing.sm,
    },
    iconBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.creamDeep,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerMark: {
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: colors.sagePale,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerTitle: {
      flex: 1,
      fontFamily: typography.display.fontFamily,
      fontSize: 19,
      color: colors.ink,
    },
    scrollFlex: { flex: 1 },
    scroll: { padding: spacing.xl, paddingBottom: spacing.lg, gap: 14 },
    introIcon: {
      alignSelf: 'center',
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.sagePale,
      alignItems: 'center',
      justifyContent: 'center',
    },
    introText: {
      fontFamily: typography.body.fontFamily,
      fontSize: 13.5,
      color: colors.inkSoft,
      textAlign: 'center',
      lineHeight: 20,
      marginBottom: spacing.sm,
    },
    prompts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
    prompt: {
      paddingHorizontal: 13,
      paddingVertical: 9,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.hairline,
    },
    promptText: {
      fontFamily: typography.body.medium,
      fontSize: 12,
      color: colors.inkSoft,
    },
    msgRow: { gap: 4, marginTop: spacing.sm },
    sender: {
      fontFamily: typography.body.fontFamily,
      fontSize: 11,
      color: colors.inkFaint,
      paddingHorizontal: 4,
    },
    bubble: { maxWidth: '84%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 11 },
    bubbleAi: { backgroundColor: colors.creamDeep },
    bubbleText: {
      fontFamily: typography.body.fontFamily,
      fontSize: 14,
      lineHeight: 20,
      color: colors.ink,
    },
    composer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.md,
      borderTopWidth: 1,
      borderTopColor: colors.hairline,
      backgroundColor: colors.cream,
    },
    input: {
      flex: 1,
      height: 46,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.hairline,
      backgroundColor: colors.paper,
      paddingHorizontal: 18,
      fontFamily: typography.body.fontFamily,
      fontSize: 14,
      color: colors.ink,
      outlineStyle: 'none',
    },
    sendBtn: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.sageDeep,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
}
