import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import { recipes } from '../data/mockData';
import { metaLine, scaleQty } from '../utils/recipe';
import { loadJSON, saveJSON } from '../utils/storage';

const CHAT_KEY = 'wecooked:assistantChat';
const GREETING = { id: 'g', from: 'ai', text: "Hi! I'm your kitchen assistant. What are you in the mood to cook?" };

const SWAPS = {
  'soy sauce': 'Use tamari or coconut aminos 1:1, or a mix of Worcestershire + water in a pinch.',
  vinegar: 'Calamansi or lemon juice works, or rice vinegar for something milder.',
  'coconut milk': 'Evaporated milk thinned with a little water, or blended cashews with water.',
  'shrimp paste': 'Anchovy paste or a splash of fish sauce gives similar salty depth.',
  'fish sauce': 'Soy sauce with a pinch of salt, or a mashed anchovy.',
  calamansi: 'Equal parts lime and orange juice, or just lime.',
  butter: 'Neutral oil or margarine 1:1 for cooking.',
  garlic: 'Garlic powder — about 1/8 tsp per clove.',
};

const QUICK_PROMPTS = [
  'What can I cook fast?',
  'Substitute for coconut milk',
  'Something cozy for dinner',
  'I have chicken and garlic',
];

// Words too generic to identify a dish on their own.
const COMMON_TITLE_WORDS = new Set([
  'chicken', 'pork', 'beef', 'fish', 'rice', 'soup', 'stew', 'fried', 'grilled',
  'with', 'and', 'the', 'classic', 'filipino', 'pinoy', 'style', 'special',
]);

// Anything that signals "I want the actual ingredients / steps", not just a suggestion.
const WANTS_FULL = /\b(recipe|recipes|steps|step|instructions?|directions?|method|ingredients?|how do|how to|make it|make this|cook it|walk me|show me)\b/;

function findRecipe(q) {
  const direct = recipes.find((r) => q.includes(r.title.toLowerCase()));
  if (direct) return direct;
  // fall back to a distinctive keyword from the title ("adobo", "sisig", "bihon"…)
  for (const r of recipes) {
    const words = r.title
      .toLowerCase()
      .split(/[\s-]+/)
      .filter((w) => w.length > 3 && !COMMON_TITLE_WORDS.has(w));
    if (words.some((w) => new RegExp(`\\b${w}\\b`).test(q))) return r;
  }
  return null;
}

// The dish we were last talking about — so "give me the recipe" has context.
function lastSingleRecipe(msgs) {
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].recipes && msgs[i].recipes.length === 1) return msgs[i].recipes[0];
  }
  return null;
}

// Pull a serving count out of "...for 6 people", "serves 8", "double it", etc.
function parseServings(q) {
  if (/\b(double|twice)\b/.test(q)) return { mult: 2 };
  if (/\btriple\b/.test(q)) return { mult: 3 };
  if (/\b(half|halve)\b/.test(q)) return { mult: 0.5 };
  let m = q.match(/\b(\d{1,2})\s*(?:person|persons|people|ppl|pax|servings?|heads|guests|mouths)\b/);
  if (!m) m = q.match(/\b(?:serves?|serving|feed|feeds|family of|party of|group of)\s*(\d{1,2})\b/);
  if (!m) m = q.match(/\bfor\s+(\d{1,2})\b(?!\s*(?:min|minute|hour|hr|day|week|piece|pcs|pieces|g\b|kg|cups?|tbsp|tsp))/);
  if (m) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 50) return { count: n };
  }
  return null;
}

function fullRecipeReply(r, servings) {
  const base = r.servings || 4;
  const want = servings && servings > 0 ? servings : base;
  const ratio = want / base;
  const ing = r.ingredients
    .map((i) => {
      const qty = i.qty ? scaleQty(i.qty, ratio) : '';
      return `•  ${i.name}${qty ? `  —  ${qty}` : ''}`;
    })
    .join('\n');
  const steps = r.steps
    .map((s, i) => {
      const mins = s.seconds ? `  (~${Math.max(1, Math.round(s.seconds / 60))} min)` : '';
      return `${i + 1}.  ${s.instruction}${mins}`;
    })
    .join('\n\n');
  const note = ratio !== 1 ? `  ·  scaled from ${base}` : '';
  return {
    text: `${r.title}\n${metaLine(r)}  ·  serves ${want}${note}\n\nINGREDIENTS\n${ing}\n\nSTEPS\n${steps}`,
    recipes: [r],
    wide: true,
  };
}

function respond(text, lastRecipe) {
  const q = text.toLowerCase();

  // 1) explicit ingredient substitution
  for (const key of Object.keys(SWAPS)) {
    if (q.includes(key)) return { text: `Swap for ${key}: ${SWAPS[key]}` };
  }
  if (q.includes('swap') || q.includes('substitute') || q.includes('instead of')) {
    return { text: 'Tell me which ingredient you\'re missing — e.g. "substitute for soy sauce" — and I\'ll suggest one.' };
  }

  const named = findRecipe(q);
  const serv = parseServings(q);
  const scalingFollowUp = serv && lastRecipe && !q.includes('i have') && !q.includes('i got');

  // 2) they want the full recipe — for a named dish, the one we were just
  //    discussing, or a bare "make it for 6" follow-up. Scale to any serving
  //    count mentioned ("for 6 people", "double it").
  if (WANTS_FULL.test(q) || scalingFollowUp) {
    const target = named || lastRecipe;
    if (target) {
      const count =
        serv?.count ??
        (serv?.mult ? Math.round((target.servings || 4) * serv.mult) : null);
      return fullRecipeReply(target, count);
    }
  }

  // 3) they named a dish — quick intro + offer the full recipe
  if (named) {
    return {
      text: `${named.title} — ${metaLine(named)}, serves ${named.servings}.\n\n${named.description}\n\nSay "give me the recipe" (add "for 6 people" to scale it).`,
      recipes: [named],
    };
  }

  // 4) quick / fast
  if (q.includes('fast') || q.includes('quick') || q.includes('hurry') || q.includes('20 min') || q.includes('15 min')) {
    const picks = recipes.filter((r) => r.minutes <= 30).slice(0, 3);
    return { text: 'Here are the fastest dishes:', recipes: picks };
  }

  // 5) vibe
  for (const vibe of ['cozy', 'fresh', 'quick', 'impress']) {
    if (q.includes(vibe)) {
      const picks = recipes.filter((r) => r.vibe.includes(vibe)).slice(0, 3);
      return { text: `${vibe[0].toUpperCase() + vibe.slice(1)} picks:`, recipes: picks };
    }
  }

  // 6) "I have X" — match ingredient names
  const byIngredient = recipes
    .map((r) => ({
      r,
      hits: r.ingredients.filter((ing) => q.includes(ing.name.toLowerCase().split(' ')[0])).length,
    }))
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits);
  if (byIngredient.length) {
    return { text: 'With those, you could make:', recipes: byIngredient.slice(0, 3).map((x) => x.r) };
  }

  // 7) generic meal ask
  if (
    q.includes('dinner') || q.includes('lunch') || q.includes('breakfast') ||
    q.includes('cook') || q.includes('meal') || q.includes('eat') || q.includes('hungry')
  ) {
    return { text: 'A few crowd-pleasers:', recipes: recipes.slice(0, 3) };
  }

  return {
    text: 'I can suggest recipes, give you the full ingredients and steps (scaled to any serving count), or swap an ingredient. Try "chicken adobo recipe for 6" or "substitute for fish sauce".',
  };
}

export default function AssistantScreen({ navigation }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors);
  const scrollRef = useRef(null);
  const [messages, setMessages] = useState([GREETING]);
  const [input, setInput] = useState('');
  const [kbVisible, setKbVisible] = useState(false);
  const hydrated = useRef(false);

  useEffect(() => {
    (async () => {
      const stored = await loadJSON(CHAT_KEY, null);
      if (Array.isArray(stored) && stored.length) setMessages(stored);
      hydrated.current = true;
    })();
  }, []);
  useEffect(() => {
    if (hydrated.current) saveJSON(CHAT_KEY, messages.slice(-40));
  }, [messages]);

  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s = Keyboard.addListener(showEvt, () => {
      setKbVisible(true);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    });
    const h = Keyboard.addListener(hideEvt, () => setKbVisible(false));
    return () => {
      s.remove();
      h.remove();
    };
  }, []);

  const clearChat = () => setMessages([GREETING]);

  const send = (raw) => {
    const text = (raw ?? input).trim();
    if (!text) return;
    setInput('');
    const userMsg = { id: `u${Date.now()}`, from: 'user', text };
    setMessages((m) => [...m, userMsg]);
    setTimeout(() => {
      setMessages((m) => {
        const r = respond(text, lastSingleRecipe(m));
        return [...m, { id: `a${Date.now()}`, from: 'ai', ...r }];
      });
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    }, 450);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
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
        {messages.length > 1 && (
          <Pressable hitSlop={8} onPress={clearChat}>
            <Ionicons name="trash-outline" size={16} color={colors.inkFaint} />
          </Pressable>
        )}
      </View>

      <ScrollView
        ref={scrollRef}
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
          I can help you swap ingredients, find recipes, or plan a meal.
        </Text>

        {messages.length <= 1 && (
          <View style={styles.prompts}>
            {QUICK_PROMPTS.map((p) => (
              <Pressable key={p} style={styles.prompt} onPress={() => send(p)}>
                <Text style={styles.promptText}>{p}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {messages.map((m) => {
          const isUser = m.from === 'user';
          return (
            <View key={m.id} style={[styles.msgRow, { alignItems: isUser ? 'flex-end' : 'flex-start' }]}>
              {!isUser && <Text style={styles.sender}>Chef Assistant</Text>}
              <View
                style={[
                  styles.bubble,
                  isUser ? styles.bubbleUser : styles.bubbleAi,
                  m.wide && styles.bubbleWide,
                ]}
              >
                <Text style={[styles.bubbleText, isUser && { color: colors.onAccent }]}>{m.text}</Text>
              </View>
              {m.recipes?.map((r) => (
                <Pressable
                  key={r.id}
                  style={styles.recCard}
                  onPress={() => navigation.navigate('RecipeDetail', { recipe: r })}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.recTitle}>{r.title}</Text>
                    <Text style={styles.recMeta}>{metaLine(r)}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={15} color={colors.inkFaint} />
                </Pressable>
              ))}
            </View>
          );
        })}
      </ScrollView>

      <View style={[styles.composer, { paddingBottom: kbVisible ? spacing.sm : Math.max(insets.bottom, spacing.md) }]}>
        <TextInput
          style={styles.input}
          placeholder="Ask anything..."
          placeholderTextColor={colors.inkFaint}
          value={input}
          onChangeText={setInput}
          onSubmitEditing={() => send()}
          returnKeyType="send"
          blurOnSubmit={false}
        />
        <Pressable style={styles.sendBtn} onPress={() => send()}>
          <Ionicons name="arrow-up" size={18} color={colors.onAccent} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.cream },
    header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: spacing.xl, paddingBottom: spacing.sm },
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
    headerTitle: { flex: 1, fontFamily: typography.display.fontFamily, fontSize: 19, color: colors.ink },
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
    promptText: { fontFamily: typography.body.medium, fontSize: 12, color: colors.inkSoft },
    msgRow: { gap: 4 },
    sender: { fontFamily: typography.body.fontFamily, fontSize: 11, color: colors.inkFaint, paddingHorizontal: 4 },
    bubble: { maxWidth: '84%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 11 },
    bubbleWide: { maxWidth: '100%', alignSelf: 'stretch' },
    bubbleAi: { backgroundColor: colors.creamDeep },
    bubbleUser: { backgroundColor: colors.sageDeep },
    bubbleText: { fontFamily: typography.body.fontFamily, fontSize: 14, lineHeight: 20, color: colors.ink },
    recCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: colors.warningBg,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 10,
      maxWidth: '84%',
    },
    recTitle: { fontFamily: typography.display.fontFamily, fontSize: 14, color: colors.ink },
    recMeta: { fontFamily: typography.body.fontFamily, fontSize: 11.5, color: colors.inkSoft, marginTop: 3 },
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
