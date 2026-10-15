import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
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
import AssistantHistoryPanel from '../components/AssistantHistoryPanel';
import { historySessionKey, retryableUser, useAssistantHistory } from './assistantHistoryState';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { ASSISTANT_LIMITS } from './assistantState';

const QUICK_PROMPTS = [
  'What can I cook fast?',
  'What can I use instead of coconut milk?',
  'Suggest something cozy for dinner.',
  'What can I make with chicken and garlic?',
];

export default function AssistantScreen({ navigation, route }) {
  const { colors } = useTheme();
  const auth = useAuth();
  const session = historySessionKey(auth);
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors);
  const history = useAssistantHistory(auth);
  const { state: renderedAssistantState, send, retry, reset: resetConversation, updateInput } = history;
  const scrollRef = useRef(null);
  const initialPromptConsumedRef = useRef(false);
  const initialSessionRef = useRef(session);

  useEffect(() => {
    if (initialSessionRef.current !== session) {
      initialPromptConsumedRef.current = true;
      if (route?.params?.initialPrompt) navigation.setParams({ initialPrompt: undefined });
    }
    if (initialPromptConsumedRef.current) return;
    const initialPrompt = typeof route?.params?.initialPrompt === 'string'
      ? route.params.initialPrompt.trim() : '';
    if (!initialPrompt) return;
    initialPromptConsumedRef.current = true;
    navigation.setParams({ initialPrompt: undefined });
    send(initialPrompt.slice(0, ASSISTANT_LIMITS.maxUserLength));
  }, [session, navigation, route?.params?.initialPrompt, send]);

  useEffect(() => navigation.addListener?.('blur', resetConversation), [navigation, resetConversation]);
  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [renderedAssistantState.messages, renderedAssistantState.status, renderedAssistantState.error]);

  const isSending = renderedAssistantState.status === 'sending';
  const isBusy = ['sending', 'creating', 'opening'].includes(renderedAssistantState.status);
  const composerDisabled = isBusy || renderedAssistantState.reviewRequired || auth.status !== 'authenticated';
  const canRetry = renderedAssistantState.failedRequest || retryableUser(renderedAssistantState.messages);

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable
          style={styles.iconBtn}
          hitSlop={8}
          onPress={() => { resetConversation(); navigation.goBack(); }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={16} color={colors.ink} />
        </Pressable>
        <View style={styles.headerMark}>
          <MaterialCommunityIcons name="chef-hat" size={16} color={colors.sageDeep} />
        </View>
        <Text style={styles.headerTitle}>Ask the Chef</Text>
        <Pressable
          style={styles.clearBtn}
          hitSlop={4}
          onPress={resetConversation}
          accessibilityRole="button"
          accessibilityLabel="Clear conversation"
        >
          <Ionicons name="trash-outline" size={16} color={colors.inkFaint} />
          <Text style={styles.clearText}>Clear</Text>
        </Pressable>
      </View>

      <View style={styles.historyControls}>
        <Pressable style={styles.clearBtn} onPress={history.toggleHistory} accessibilityRole="button" accessibilityLabel="History">
          <Text style={styles.clearText}>History</Text>
        </Pressable>
        <Pressable style={styles.clearBtn} onPress={history.newChat} accessibilityRole="button" accessibilityLabel="New Chat">
          <Text style={styles.clearText}>New Chat</Text>
        </Pressable>
      </View>
      {renderedAssistantState.historyVisible ? <AssistantHistoryPanel key={session}
        state={renderedAssistantState} onOpen={history.open} onDelete={history.remove}
        onRefresh={() => history.loadList()}
        onMore={() => history.loadList(renderedAssistantState.listPage.nextCursor)} /> : null}

      <ScrollView
        ref={scrollRef}
        style={styles.scrollFlex}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        {renderedAssistantState.status === 'opening' ? <ActivityIndicator accessibilityLabel="Loading conversation" /> : null}
        {renderedAssistantState.status === 'creating' ? <ActivityIndicator accessibilityLabel="Creating conversation" /> : null}
        {renderedAssistantState.pageInfo.hasMore ? <Pressable onPress={() => history.open(renderedAssistantState.conversation.id, renderedAssistantState.pageInfo.nextCursor)}
          disabled={composerDisabled} accessibilityRole="button" accessibilityLabel="Load older messages">
          <Text style={styles.retryText}>Load older messages</Text>
        </Pressable> : null}
        {renderedAssistantState.messages.length === 0 && !isBusy ? <>
          <View style={styles.introIcon}>
            <MaterialCommunityIcons name="chef-hat" size={20} color={colors.sageDeep} />
          </View>
          <Text style={styles.introText}>
            Ask Chef Assistant for cooking ideas, recipe guidance, or ingredient swaps.
          </Text>
          <View style={styles.prompts}>
            {QUICK_PROMPTS.map((prompt) => (
            <Pressable
              key={prompt}
              style={[styles.prompt, isSending && styles.controlDisabled]}
              onPress={() => send(prompt)}
              disabled={composerDisabled}
              accessibilityRole="button"
              accessibilityLabel={`Ask: ${prompt}`}
              accessibilityState={{ disabled: composerDisabled }}
            >
              <Text style={styles.promptText}>{prompt}</Text>
            </Pressable>
            ))}
          </View>
        </> : null}

        {renderedAssistantState.messages.map((message) => (
          <View
            key={message.id}
            style={[styles.msgRow, message.role === 'user' && styles.msgRowUser]}
          >
            <Text style={styles.sender}>
              {message.role === 'user' ? 'YOU' : 'CHEF ASSISTANT'}
            </Text>
            <View
              style={[
                styles.bubble,
                message.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant,
              ]}
            >
              <Text
                style={[
                  styles.bubbleText,
                  message.role === 'user' && styles.bubbleTextUser,
                ]}
              >
                {message.content}
              </Text>
            </View>
          </View>
        ))}

        {isSending ? (
          <View style={styles.msgRow} accessibilityLabel="Chef Assistant is thinking">
            <Text style={styles.sender}>CHEF ASSISTANT</Text>
            <View style={[styles.bubble, styles.bubbleAssistant, styles.thinkingBubble]}>
              <ActivityIndicator size="small" color={colors.inkSoft} />
              <Text style={styles.thinkingText}>Thinking...</Text>
            </View>
          </View>
        ) : null}

        {renderedAssistantState.error ? (
          <View style={styles.errorCard} accessibilityRole="alert">
            <Text style={styles.errorText}>{renderedAssistantState.error}</Text>
            {renderedAssistantState.failedRequest ? (
              <Pressable
                style={styles.retryBtn}
                onPress={retry}
                accessibilityRole="button"
                accessibilityLabel={renderedAssistantState.failedRequest.kind === 'open' ? 'Review saved conversation' : 'Retry last question'}
              >
                <Text style={styles.retryText}>{renderedAssistantState.failedRequest.kind === 'open' ? 'Review saved conversation' : 'Retry'}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {!renderedAssistantState.failedRequest && canRetry ? <Pressable onPress={retry}
          disabled={composerDisabled} accessibilityRole="button" accessibilityLabel="Retry last question">
          <Text style={styles.retryText}>Retry last question</Text>
        </Pressable> : null}
      </ScrollView>

      <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        <TextInput
          style={styles.input}
          placeholder="Ask anything..."
          placeholderTextColor={colors.inkFaint}
          value={renderedAssistantState.input}
          onChangeText={updateInput}
          onSubmitEditing={() => send()}
          returnKeyType="send"
          maxLength={ASSISTANT_LIMITS.maxUserLength}
          editable={!composerDisabled}
          accessibilityLabel="Question for Chef Assistant"
          accessibilityState={{ disabled: composerDisabled }}
        />
        <Pressable
          style={[styles.sendBtn, isSending && styles.controlDisabled]}
          onPress={() => send()}
          disabled={composerDisabled}
          accessibilityRole="button"
          accessibilityLabel="Send question"
          accessibilityState={{ disabled: composerDisabled }}
        >
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
    clearBtn: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: spacing.sm },
    clearText: {
      fontFamily: typography.body.semibold,
      fontSize: 12,
      color: colors.sageDeep,
    },
    historyControls: { flexDirection: 'row', paddingHorizontal: spacing.xl, gap: spacing.sm },
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
    msgRow: { gap: 4, marginTop: spacing.sm, alignItems: 'flex-start' },
    msgRowUser: { alignItems: 'flex-end' },
    sender: {
      fontFamily: typography.body.fontFamily,
      fontSize: 11,
      color: colors.inkFaint,
      paddingHorizontal: 4,
    },
    bubble: { maxWidth: '84%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 11 },
    bubbleAssistant: { backgroundColor: colors.creamDeep },
    bubbleUser: { backgroundColor: colors.sageDeep },
    bubbleText: {
      fontFamily: typography.body.fontFamily,
      fontSize: 14,
      lineHeight: 20,
      color: colors.ink,
    },
    bubbleTextUser: { color: colors.onAccent },
    thinkingBubble: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    thinkingText: {
      fontFamily: typography.body.medium,
      fontSize: 14,
      color: colors.inkSoft,
      fontStyle: 'italic',
    },
    errorCard: {
      gap: spacing.sm,
      borderRadius: radius.md,
      padding: spacing.md,
      backgroundColor: colors.errorBg,
    },
    errorText: {
      fontFamily: typography.body.fontFamily,
      fontSize: 13,
      lineHeight: 19,
      color: colors.ink,
    },
    retryBtn: { alignSelf: 'flex-start', paddingVertical: spacing.xs },
    retryText: {
      fontFamily: typography.body.semibold,
      fontSize: 13,
      color: colors.error,
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
    controlDisabled: { opacity: 0.45 },
  });
}
