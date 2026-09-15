import { recipes } from '../data/mockData';

// Real-AI backend for "Ask the Chef". The app ships with a rule-based assistant;
// if a cook supplies an OpenAI API key (EXPO_PUBLIC_OPENAI_API_KEY in .env,
// or pasted in Settings → Intelligence) we call the Chat Completions API directly.
//
// Uses raw `fetch` against the REST endpoint (no `openai` SDK dependency) —
// same reasoning as before: fine for a personal demo, but a real app would
// proxy through a backend so the key never ships in the bundle. Note: OpenAI's
// API does not send permissive CORS headers for arbitrary browser origins, so
// this may fail with a CORS error on the web build even when it works fine on
// native (Expo Go) — native `fetch` isn't subject to CORS at all.

const API_URL = 'https://api.openai.com/v1/chat/completions';
export const DEFAULT_MODEL = process.env.EXPO_PUBLIC_OPENAI_MODEL || 'gpt-4o-mini';

function buildCatalog() {
  return recipes
    .map((r) => {
      const ings = (r.ingredients || []).map((i) => i.name).join(', ');
      return `- ${r.title} — ${r.cuisine}, ${r.minutes} min, ${r.difficulty}, serves ${r.servings}. Ingredients: ${ings}.`;
    })
    .join('\n');
}

function systemPrompt(profile) {
  const diet =
    profile?.dietary && profile.dietary.length ? profile.dietary.join(', ') : 'none noted';
  return [
    'You are the WeCooked kitchen assistant — warm, concise, and practical. You help home cooks choose a recipe, scale servings, and swap ingredients.',
    'Only recommend dishes from the CATALOG below. Whenever you name one, write its title exactly as shown so the app can link it.',
    `The cook’s dietary notes: ${diet}. Respect them.`,
    'Keep answers to 2–5 sentences unless the cook asks for the full ingredients or steps. Never invent nutrition numbers.',
    '',
    'CATALOG:',
    buildCatalog(),
  ].join('\n');
}

// Chat Completions is far less strict than some other chat APIs about turn
// order (no forced user/assistant alternation), but we still merge
// consecutive same-role turns and drop a stray leading assistant turn for a
// clean, predictable transcript.
function toApiMessages(history) {
  const mapped = (history || [])
    .filter((m) => m && m.text && (m.from === 'user' || m.from === 'ai'))
    .map((m) => ({ role: m.from === 'user' ? 'user' : 'assistant', content: String(m.text) }));

  const merged = [];
  for (const m of mapped) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) last.content += `\n\n${m.content}`;
    else merged.push({ ...m });
  }
  while (merged.length && merged[0].role !== 'user') merged.shift();
  return merged.slice(-12);
}

export async function askChef({ history, apiKey, model, profile, signal }) {
  if (!apiKey) {
    const err = new Error('No API key set.');
    err.status = 0;
    throw err;
  }

  const turns = toApiMessages(history);
  if (!turns.length || turns[turns.length - 1].role !== 'user') {
    throw new Error('Nothing to send.');
  }

  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        max_tokens: 600,
        messages: [{ role: 'system', content: systemPrompt(profile) }, ...turns],
      }),
    });
  } catch (e) {
    const err = new Error(e?.message || 'Network request failed.');
    err.status = 0;
    throw err;
  }

  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json())?.error?.message || '';
    } catch {
      // body wasn't JSON
    }
    const err = new Error(detail || `Request failed (${res.status}).`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const choice = data.choices?.[0];
  if (choice?.finish_reason === 'content_filter') {
    return { text: 'I can’t help with that one — ask me about a recipe, a swap, or scaling a dish.' };
  }
  const text = (choice?.message?.content || '').trim();
  return { text: text || 'Hmm, I didn’t catch that — try asking another way.' };
}

// Catalog recipes the reply names, so the screen can show tappable cards.
export function recipesMentioned(text) {
  if (!text) return [];
  const lower = text.toLowerCase();
  return recipes.filter((r) => lower.includes(r.title.toLowerCase())).slice(0, 3);
}
