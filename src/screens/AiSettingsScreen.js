import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import TopBar from '../components/TopBar';
import { useAi, looksLikeApiKey } from '../context/AiContext';
import { notify } from '../utils/alert';
import { tapMedium } from '../utils/haptics';

const CONSOLE_URL = 'https://platform.openai.com/api-keys';

export default function AiSettingsScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { deviceKey, hasKey, keySource, hasEnvKey, setApiKey } = useAi();
  const [draft, setDraft] = useState(deviceKey);
  const [show, setShow] = useState(false);

  const dirty = draft.trim() !== deviceKey;
  const draftLooksWrong = draft.trim().length > 0 && !looksLikeApiKey(draft);

  const save = async () => {
    const trimmed = draft.trim();
    if (trimmed && !looksLikeApiKey(trimmed)) {
      notify(
        "That doesn't look like a key",
        'An OpenAI API key starts with "sk-". Paste the full key, or clear the field to use the built-in assistant.'
      );
      return;
    }
    await setApiKey(trimmed);
    tapMedium();
    notify(
      trimmed ? 'Connected' : 'Disconnected',
      trimmed
        ? 'Ask the Chef will now answer with ChatGPT.'
        : 'Ask the Chef is back to its built-in assistant.'
    );
    navigation.goBack();
  };

  const clear = async () => {
    setDraft('');
    await setApiKey('');
  };

  return (
    <View style={styles.root}>
      <TopBar title="Intelligence" onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Ionicons name="sparkles" size={20} color={colors.sageDeep} />
          </View>
          <Text style={styles.title}>Connect a real AI chef</Text>
          <Text style={styles.body}>
            By default, Ask the Chef uses a built-in rule-based assistant. Add your own OpenAI
            API key to have it answer with ChatGPT instead — recipe ideas, substitutions, and
            scaling, grounded in this app’s recipe catalog.
          </Text>
        </View>

        <View style={[styles.statusPill, hasKey ? styles.statusOn : styles.statusOff]}>
          <Ionicons
            name={hasKey ? 'checkmark-circle' : 'ellipse-outline'}
            size={15}
            color={hasKey ? colors.success : colors.inkFaint}
          />
          <Text style={[styles.statusText, hasKey && { color: colors.success }]}>
            {keySource === 'env'
              ? 'Connected via .env — using ChatGPT'
              : keySource === 'device'
                ? 'Connected — using ChatGPT'
                : 'Not connected — using built-in assistant'}
          </Text>
        </View>

        <Text style={styles.label}>
          {hasEnvKey ? 'Override the .env key on this device' : 'OpenAI API key'}
        </Text>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="sk-..."
            placeholderTextColor={colors.inkFaint}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry={!show}
            accessibilityLabel="OpenAI API key"
          />
          <Pressable
            onPress={() => setShow((v) => !v)}
            hitSlop={8}
            style={styles.eye}
            accessibilityRole="button"
            accessibilityLabel={show ? 'Hide key' : 'Show key'}
          >
            <Ionicons
              name={show ? 'eye-off-outline' : 'eye-outline'}
              size={18}
              color={colors.inkFaint}
            />
          </Pressable>
        </View>

        {draftLooksWrong && (
          <Text style={styles.warnText}>
            This doesn’t look like a full key — it should start with “sk-”.
          </Text>
        )}

        <Pressable
          style={styles.linkRow}
          onPress={() => Linking.openURL(CONSOLE_URL)}
          accessibilityRole="link"
        >
          <Ionicons name="open-outline" size={14} color={colors.sageDeep} />
          <Text style={styles.linkText}>Get a key at platform.openai.com</Text>
        </Pressable>

        <Pressable
          style={[styles.saveBtn, !dirty && styles.saveBtnOff]}
          onPress={save}
          disabled={!dirty}
        >
          <Text style={styles.saveText}>{draft.trim() ? 'Save & connect' : 'Save'}</Text>
        </Pressable>

        {!!deviceKey && (
          <Pressable style={styles.clearBtn} onPress={clear}>
            <Text style={styles.clearText}>
              {hasEnvKey ? 'Remove device override' : 'Remove key'}
            </Text>
          </Pressable>
        )}

        <Text style={styles.fineprint}>
          A key you paste here is stored only on this device. Either way it’s sent directly to
          OpenAI when you chat, and usage is billed to your own OpenAI account.
        </Text>
      </ScrollView>
    </View>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    scroll: { padding: spacing.xl, paddingBottom: spacing.xxxl },
    hero: { alignItems: 'center', marginBottom: spacing.xl },
    heroIcon: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: colors.sagePale,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.md,
    },
    title: {
      fontFamily: typography.display.fontFamily,
      fontSize: 21,
      color: colors.ink,
      textAlign: 'center',
      marginBottom: spacing.sm,
    },
    body: {
      fontFamily: typography.body.fontFamily,
      fontSize: typography.sizes.sm,
      color: colors.inkSoft,
      textAlign: 'center',
      lineHeight: 20,
    },
    statusPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      alignSelf: 'center',
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: radius.pill,
      borderWidth: 1,
      marginBottom: spacing.xl,
    },
    statusOn: { borderColor: colors.success, backgroundColor: colors.sagePale },
    statusOff: { borderColor: colors.hairline, backgroundColor: colors.paper },
    statusText: {
      fontFamily: typography.body.medium,
      fontSize: typography.sizes.xs,
      color: colors.inkSoft,
    },
    label: {
      fontFamily: typography.body.bold,
      fontSize: 11.5,
      letterSpacing: 1,
      textTransform: 'uppercase',
      color: colors.inkFaint,
      marginBottom: spacing.sm,
    },
    inputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.paper,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.hairline,
      paddingHorizontal: 14,
    },
    input: {
      flex: 1,
      height: 48,
      fontFamily: typography.body.fontFamily,
      fontSize: 14,
      color: colors.ink,
      outlineStyle: 'none',
    },
    eye: { padding: 6 },
    warnText: {
      fontFamily: typography.body.medium,
      fontSize: 11.5,
      color: colors.clay || colors.error,
      marginTop: spacing.xs,
      lineHeight: 16,
    },
    linkRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm },
    linkText: { fontFamily: typography.body.semibold, fontSize: 12.5, color: colors.sageDeep },
    saveBtn: {
      marginTop: spacing.xl,
      height: 50,
      borderRadius: radius.pill,
      backgroundColor: colors.sageDeep,
      alignItems: 'center',
      justifyContent: 'center',
    },
    saveBtnOff: { backgroundColor: colors.hairline },
    saveText: { fontFamily: typography.body.semibold, fontSize: 14, color: colors.onAccent },
    clearBtn: { marginTop: spacing.md, height: 44, alignItems: 'center', justifyContent: 'center' },
    clearText: { fontFamily: typography.body.semibold, fontSize: 13, color: colors.error },
    fineprint: {
      fontFamily: typography.body.fontFamily,
      fontSize: 11.5,
      color: colors.inkFaint,
      lineHeight: 17,
      marginTop: spacing.xl,
    },
  });
}
