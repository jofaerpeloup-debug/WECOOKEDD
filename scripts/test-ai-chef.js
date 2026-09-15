// Verifies your OpenAI API key + model work, without launching the app.
//   node scripts/test-ai-chef.js      (or: npm run ai:test)
// Reads EXPO_PUBLIC_OPENAI_API_KEY / EXPO_PUBLIC_OPENAI_MODEL from .env.

const fs = require('fs');
const path = require('path');

function loadDotenv() {
  for (const name of ['.env.local', '.env']) {
    try {
      const txt = fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
      for (const line of txt.split('\n')) {
        const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
        if (m && process.env[m[1]] === undefined) {
          process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
        }
      }
    } catch {
      // file not present — fine
    }
  }
}

loadDotenv();

const apiKey = (process.env.EXPO_PUBLIC_OPENAI_API_KEY || '').trim();
const model = process.env.EXPO_PUBLIC_OPENAI_MODEL || 'gpt-4o-mini';

if (!apiKey) {
  console.error('✗ No EXPO_PUBLIC_OPENAI_API_KEY found in .env');
  console.error('  Add it (get one at https://platform.openai.com/api-keys) and retry.');
  console.error('  Or leave it blank — the app works fine on the built-in assistant.');
  process.exit(1);
}

if (!/^sk-\S{20,}$/.test(apiKey)) {
  console.error(`✗ That key doesn't look right: "${apiKey.slice(0, 10)}…" (${apiKey.length} chars)`);
  console.error('  A real key starts with "sk-". Paste the whole thing.');
  process.exit(1);
}

(async () => {
  console.log(`→ testing model "${model}" …`);
  let res;
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 16,
        messages: [{ role: 'user', content: 'Reply with exactly one word: working' }],
      }),
    });
  } catch (e) {
    console.error('✗ Network error:', e.message);
    process.exit(1);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`✗ API error ${res.status}:`, data?.error?.message || JSON.stringify(data));
    if (res.status === 401) console.error('  → the key was rejected.');
    if (res.status === 404) console.error('  → model not found; set EXPO_PUBLIC_OPENAI_MODEL.');
    process.exit(1);
  }

  const text = data.choices?.[0]?.message?.content || '';
  console.log(`✓ OK — ${model} replied: "${text.trim()}"`);
  console.log('  Ask the Chef will use ChatGPT when you run the app.');
})();
