import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import TopBar from '../components/TopBar';
import { chatMessages } from '../data/mockData';

function SuggestionCard({ suggestion }) {
  const { colors, shadow } = useTheme();
  const styles = makeStyles(colors, shadow);
  return (
    <View style={styles.suggestionCard}>
      <View style={styles.suggestionHeader}>
        <View style={styles.checkBadge}>
          <Ionicons name="checkmark" size={11} color={colors.onAccent} />
        </View>
        <Text style={styles.suggestionEyebrow}>{suggestion.badge}</Text>
      </View>
      <Text style={styles.suggestionName}>{suggestion.name}</Text>
      <Text style={styles.suggestionDesc}>{suggestion.description}</Text>
      <Pressable style={styles.suggestionCta}>
        <Ionicons name="add" size={15} color={colors.onAccent} />
        <Text style={styles.suggestionCtaText}>{suggestion.cta}</Text>
      </Pressable>
    </View>
  );
}

export default function AssistantScreen({ navigation }) {
  const { colors, shadow } = useTheme();
  const styles = makeStyles(colors, shadow);
  const [messages, setMessages] = useState(chatMessages);
  const [input, setInput] = useState('');
  const scrollRef = useRef(null);

  const send = () => {
    if (!input.trim()) return;
    const userMsg = {
      id: `u-${Date.now()}`,
      from: 'user',
      text: input.trim(),
      time: 'Just now',
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          from: 'assistant',
          text: "Great question! Let me look into the best swap for that — I'll factor in flavor, texture, and how it holds up to heat.",
          time: 'Just now',
        },
      ]);
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 700);
    scrollRef.current?.scrollToEnd({ animated: true });
  };

  return (
    <View style={styles.root}>
      <TopBar mode="brand" onMenuPress={() => {}} />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.introWrap}>
            <View style={styles.introIcon}>
              <Ionicons name="restaurant-outline" size={22} color={colors.sageDeep} />
            </View>
            <Text style={styles.introTitle}>How can I assist?</Text>
            <Text style={styles.introSub}>
              I can help you swap ingredients, find recipes, or plan meals.
            </Text>
          </View>

          <Text style={styles.dateLabel}>TODAY</Text>

          {messages.map((msg) => (
            <View
              key={msg.id}
              style={[
                styles.msgRow,
                msg.from === 'user' ? styles.msgRowUser : styles.msgRowAssistant,
              ]}
            >
              {msg.from === 'assistant' && (
                <View style={styles.avatarSmall}>
                  <Ionicons name="leaf" size={11} color={colors.onAccent} />
                </View>
              )}
              <View style={{ flex: 1, alignItems: msg.from === 'user' ? 'flex-end' : 'flex-start' }}>
                {msg.from === 'assistant' && (
                  <Text style={styles.senderLabel}>WeCooked Assistant</Text>
                )}
                <View
                  style={[
                    styles.bubble,
                    msg.from === 'user' ? styles.bubbleUser : styles.bubbleAssistant,
                  ]}
                >
                  <Text
                    style={[
                      styles.bubbleText,
                      msg.from === 'user' && styles.bubbleTextUser,
                    ]}
                  >
                    {msg.text}
                  </Text>
                </View>
                {msg.suggestion && <SuggestionCard suggestion={msg.suggestion} />}
                <Text style={styles.timeLabel}>{msg.time}</Text>
              </View>
            </View>
          ))}
        </ScrollView>

        <View style={styles.inputBar}>
          <TextInput
            style={styles.input}
            placeholder="Ask anything..."
            placeholderTextColor={colors.inkFaint}
            value={input}
            onChangeText={setInput}
            onSubmitEditing={send}
            returnKeyType="send"
          />
          <Pressable style={styles.sendBtn} onPress={send}>
            <Ionicons name="arrow-up" size={18} color={colors.onAccent} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function makeStyles(colors, shadow) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    scroll: { padding: spacing.lg, paddingBottom: spacing.xl },
    introWrap: { alignItems: 'center', marginBottom: spacing.xl, marginTop: spacing.md },
    introIcon: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.sagePale,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.md,
    },
    introTitle: {
      fontFamily: typography.display.fontFamily,
      fontSize: 22,
      color: colors.ink,
      marginBottom: spacing.sm,
    },
    introSub: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.inkSoft,
      textAlign: 'center',
      maxWidth: '80%',
    },
    dateLabel: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.xs,
      color: colors.inkFaint,
      textAlign: 'center',
      marginBottom: spacing.lg,
      letterSpacing: 1,
    },
    msgRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
    msgRowAssistant: { justifyContent: 'flex-start' },
    msgRowUser: { justifyContent: 'flex-end' },
    avatarSmall: {
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: colors.sageDeep,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 16,
    },
    senderLabel: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.xs,
      color: colors.inkFaint,
      marginBottom: 4,
    },
    bubble: {
      borderRadius: radius.lg,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      maxWidth: '86%',
    },
    bubbleAssistant: {
      backgroundColor: colors.paper,
      borderWidth: 1,
      borderColor: colors.hairline,
      borderTopLeftRadius: 4,
    },
    bubbleUser: {
      backgroundColor: colors.sageDeep,
      borderTopRightRadius: 4,
    },
    bubbleText: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      lineHeight: 20,
      color: colors.ink,
    },
    bubbleTextUser: { color: colors.onAccent },
    timeLabel: {
      fontFamily: typography.body.fontFamily,
      fontSize: 10,
      color: colors.inkFaint,
      marginTop: 4,
    },
    suggestionCard: {
      backgroundColor: colors.paper,
      borderWidth: 1,
      borderColor: colors.hairline,
      borderRadius: radius.md,
      padding: spacing.md,
      marginTop: spacing.sm,
      maxWidth: '90%',
      ...shadow.soft,
    },
    suggestionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.sm },
    checkBadge: {
      width: 16,
      height: 16,
      borderRadius: 8,
      backgroundColor: colors.sageDeep,
      alignItems: 'center',
      justifyContent: 'center',
    },
    suggestionEyebrow: {
      fontFamily: typography.body.semibold,
      fontSize: 10,
      color: colors.sageDeep,
      letterSpacing: 0.5,
    },
    suggestionName: {
      fontFamily: typography.display.fontFamily,
      fontSize: 17,
      color: colors.ink,
      marginBottom: 4,
    },
    suggestionDesc: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.inkSoft,
      lineHeight: 18,
      marginBottom: spacing.md,
    },
    suggestionCta: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      backgroundColor: colors.sageDeep,
      borderRadius: radius.pill,
      paddingVertical: 10,
    },
    suggestionCtaText: {
      fontFamily: typography.body.semibold,
      fontSize: typography.sizes.sm,
      color: colors.onAccent,
    },
    inputBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      padding: spacing.lg,
      borderTopWidth: 1,
      borderTopColor: colors.hairline,
      backgroundColor: colors.paper,
    },
    input: {
      flex: 1,
      height: 44,
      borderRadius: radius.pill,
      backgroundColor: colors.creamDeep,
      paddingHorizontal: spacing.lg,
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.ink,
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
