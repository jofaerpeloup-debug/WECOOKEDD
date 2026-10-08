const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../src');
const raw = fs.readFileSync(path.join(SRC, 'screens/ProfileScreen.js'), 'utf8');
const code = raw
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');
const navigator = fs.readFileSync(path.join(SRC, 'navigation/RootNavigator.js'), 'utf8');

function occurrences(source, anchor) {
  return source.split(anchor).length - 1;
}

function extractUniqueRegion(source, start, end) {
  expect(occurrences(source, start)).toBe(1);
  expect(occurrences(source, end)).toBe(1);
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to + end.length);
}

function normalizeJsx(node) {
  return node.replace(/\s+/g, ' ').trim();
}

function auditProfileRenderBindings(source) {
  const identity = extractUniqueRegion(
    source,
    '<View style={styles.identity}>',
    '<View style={styles.statsRow}>'
  );
  const identityTextNodes = [...identity.matchAll(/<Text\b[^>]*>[\s\S]*?<\/Text>/g)]
    .map((match) => normalizeJsx(match[0]));
  expect(identityTextNodes).toEqual([
    '<Text style={styles.avatarInitial}>{initial}</Text>',
    "<Text style={styles.name}>{user?.name || 'WeCooked account'}</Text>",
    "<Text style={styles.email}>{user?.email || 'Email unavailable'}</Text>",
    '<Text style={styles.cookingLevel}>{cookingLevel}</Text>',
    "<Text style={styles.bio}>{user?.bio ?? ''}</Text>",
    '<Text style={styles.editText}>Edit profile</Text>',
  ]);
  expect(identity).not.toMatch(/\srole\s*=|\b(role|status)\s*:\s*['"]/i);

  const stats = extractUniqueRegion(
    source,
    '<View style={styles.statsRow}>',
    '<Text style={styles.eyebrow}>Preferences</Text>'
  );
  const statNodes = [...stats.matchAll(/<Stat\b[\s\S]*?\/>/g)]
    .map((match) => normalizeJsx(match[0]));
  expect(statNodes).toEqual([
    '<Stat n={savedCount} label="Recipes saved" styles={styles} />',
    '<Stat n={collectionsCount} label="Collections" styles={styles} />',
    "<Stat n={cookedCount} label=\"Cooked\" styles={styles} onPress={() => navigation.navigate('CookingHistory')} accessibilityLabel={`Cooked: ${cookedCount}. Open cooking history`} />",
  ]);

  const preferences = extractUniqueRegion(
    source,
    '<View style={styles.prefList}>',
    'style={styles.logout}'
  );
  const preferenceRows = [...preferences.matchAll(/<PreferenceRow\b[\s\S]*?\/>/g)]
    .map((match) => normalizeJsx(match[0]));
  expect(preferenceRows).toHaveLength(4);
  const dietaryRows = preferenceRows.filter((row) => row.includes('label="Dietary Preferences"'));
  const allergyRows = preferenceRows.filter((row) => row.includes('label="Allergies & Ingredients to Avoid"'));
  expect(dietaryRows).toHaveLength(1);
  expect(allergyRows).toHaveLength(1);
  expect(dietaryRows[0]).toContain("value={dietaryPreferences.join(', ') || 'None'}");
  expect(allergyRows[0]).toContain("value={allergies.join(', ') || 'None'}");

  return { identity, stats, preferences };
}

function assignment(name) {
  const matches = [...code.matchAll(new RegExp(`const ${name} =([\\s\\S]*?);`, 'g'))];
  expect(matches).toHaveLength(1);
  return matches[0][1].trim();
}

describe('Profile uses authoritative account and domain sources', () => {
  it('renders identity and preferences from AuthContext user', () => {
    expect(raw).toMatch(/useAuth.*AuthContext/);
    expect(code).toMatch(/const \{ user, signOut \} = useAuth\(\)/);
    expect(code).toMatch(/user\?\.name/);
    expect(code).toMatch(/user\?\.email/);
    expect(code).toMatch(/user\?\.preferences\?\.dietaryPreferences/);
    expect(code).toMatch(/user\?\.preferences\?\.allergies/);
  });

  it('binds all three displayed counts to real identity-guarded contexts', () => {
    expect(raw).toMatch(/useFavorites.*FavoritesContext/);
    expect(raw).toMatch(/useCollections.*CollectionsContext/);
    expect(raw).toMatch(/useCookHistory.*CookHistoryContext/);
    expect(code).toMatch(/favoriteIds\.size/);
    expect(code).toMatch(/collections\.length/);
    expect(code).toMatch(/cookStats\.uniqueRecipesCooked/);
    expect(code).not.toMatch(/cookStats\.totalCooks|COLLECTIONS\.length/);
  });

  it('preserves unknown, loaded zero, and loaded positive semantics using the production expressions', () => {
    const unavailable = '—';
    const saved = new Function(
      'favoritesInitializing', 'favoritesError', 'favoriteIds', 'UNAVAILABLE_STAT',
      `return (${assignment('savedCount')});`
    );
    const collections = new Function(
      'collectionsInitializing', 'collectionsError', 'collections', 'UNAVAILABLE_STAT',
      `return (${assignment('collectionsCount')});`
    );
    const cooked = new Function(
      'cookStatsInitializing', 'cookStatsError', 'cookStats', 'UNAVAILABLE_STAT',
      `return (${assignment('cookedCount')});`
    );

    expect(saved(true, null, new Set(), unavailable)).toBe(unavailable);
    expect(saved(false, new Error('failed'), new Set(), unavailable)).toBe(unavailable);
    expect(String(saved(false, null, new Set(), unavailable))).toBe('0');
    expect(String(saved(false, null, new Set(['a', 'b']), unavailable))).toBe('2');

    expect(collections(true, null, [], unavailable)).toBe(unavailable);
    expect(collections(false, new Error('failed'), [], unavailable)).toBe(unavailable);
    expect(String(collections(false, null, [], unavailable))).toBe('0');
    expect(String(collections(false, null, [{}, {}, {}], unavailable))).toBe('3');

    expect(cooked(true, null, null, unavailable)).toBe(unavailable);
    expect(cooked(false, new Error('failed'), null, unavailable)).toBe(unavailable);
    expect(String(cooked(false, null, { uniqueRecipesCooked: 0 }, unavailable))).toBe('0');
    expect(String(cooked(false, null, { uniqueRecipesCooked: 4 }, unavailable))).toBe('4');

    for (const name of ['savedCount', 'collectionsCount', 'cookedCount']) {
      expect(assignment(name)).not.toMatch(/\b(favoriteIds\.size|collections\.length|uniqueRecipesCooked)\s*\?/);
    }
  });

  it('contains no mock profile, local persistence, or client auth authority', () => {
    expect(code).not.toMatch(/mockData|ProfileContext|useProfile\(|AsyncStorage|loadJSON|saveJSON/);
    expect(code).not.toMatch(/setRole|roleSelector|SecureStore|accessToken|refreshToken/);
  });
});

describe('Profile actions are real and accessible', () => {
  it('routes only to existing supported destinations registered by RootNavigator', () => {
    const targets = [...code.matchAll(/navigation\.navigate\('([^']+)'\)/g)].map((match) => match[1]);
    expect(new Set(targets)).toEqual(new Set(['Settings', 'AccountDetails', 'MealPlan', 'CookingHistory']));
    for (const route of ['Settings', 'AccountDetails', 'MealPlan', 'CookingHistory']) {
      expect(code).toMatch(new RegExp(`navigation\\.navigate\\('${route}'\\)`));
      expect(navigator).toMatch(new RegExp(`<Stack\\.Screen name="${route}" component=\\{[A-Za-z]+Screen\\} \\/>`));
    }
  });

  it('routes both real preference summaries to AccountDetails', () => {
    const { preferences } = auditProfileRenderBindings(code);
    expect(preferences).toMatch(/label="Dietary Preferences"[\s\S]*?navigate\('AccountDetails'\)/);
    expect(preferences).toMatch(/label="Allergies & Ingredients to Avoid"[\s\S]*?navigate\('AccountDetails'\)/);
    expect(preferences).not.toMatch(/Cooking Level|Coming soon|showUnavailable/);
  });

  it('uses real confirmed sign-out without manual navigation or token mutation', () => {
    const logout = extractUniqueRegion(code, 'const handleLogout', 'onPress: () => signOut()');
    expect(logout).toMatch(/Alert\.alert\('Log Out'/);
    expect(logout).toMatch(/onPress: \(\) => signOut\(\)/);
    expect(code).not.toMatch(/navigation\.(reset|replace)\(|setUser\(|tokenStore/);
  });

  it('labels every changed action and the page heading', () => {
    expect(code).toMatch(/accessibilityRole="header">Profile/);
    for (const label of [
      'Settings',
      'Edit profile and preferences',
      'Edit dietary preferences',
      'Edit allergies and ingredients to avoid',
      'Open meal plan',
      'Open settings',
      'Log out',
    ]) {
      expect(code).toContain(`accessibilityLabel="${label}"`);
    }
    expect(code).toMatch(/accessibilityLabel=\{`Notifications, \$\{unreadCount\} unread`\}/);
  });

  it('turns only the authoritative Cooked stat into an accessible Cooking History affordance', () => {
    const { stats } = auditProfileRenderBindings(code);
    const statNodes = [...stats.matchAll(/<Stat\b[\s\S]*?\/>/g)].map((match) => match[0]);
    expect(statNodes[2]).toMatch(/n=\{cookedCount\}[\s\S]*?navigate\('CookingHistory'\)/);
    expect(statNodes[2]).toMatch(/accessibilityLabel=\{`Cooked: \$\{cookedCount\}\. Open cooking history`\}/);
    expect(statNodes[0]).not.toMatch(/navigate\('CookingHistory'\)/);
    expect(statNodes[1]).not.toMatch(/navigate\('CookingHistory'\)/);
    expect(code).not.toMatch(/history\.length|cookHistory\.length|fakeCooked|mockCooked/);
  });
});

describe('Profile render bindings use authoritative values at their actual render sites', () => {
  it('binds identity, preferences, and exactly three stats through the shared structural audit', () => {
    auditProfileRenderBindings(code);
  });

  it('rejects a hard-coded rendered dietary preference', () => {
    const mutated = code.replace(
      "value={dietaryPreferences.join(', ') || 'None'}",
      'value="Vegan"'
    );
    expect(mutated).not.toBe(code);
    expect(() => auditProfileRenderBindings(mutated)).toThrow();
  });

  it('rejects a fake rendered stat binding', () => {
    const mutated = code.replace('n={savedCount}', 'n={fakeCount}');
    expect(mutated).not.toBe(code);
    expect(() => auditProfileRenderBindings(mutated)).toThrow();
  });

  it('rejects extra literal identity or role content in the identity region', () => {
    const emailNode = "<Text style={styles.email}>{user?.email || 'Email unavailable'}</Text>";
    const mutated = code.replace(
      emailNode,
      `${emailNode}\n          <Text style={styles.role}>Administrator</Text>`
    );
    expect(mutated).not.toBe(code);
    expect(() => auditProfileRenderBindings(mutated)).toThrow();
  });
});

describe('Profile omits unsupported teammate semantics', () => {
  it('binds displayed identity and private preferences to AuthContext user without executable fake records', () => {
    const { identity } = auditProfileRenderBindings(code);
    expect(identity).toMatch(/\{user\?\.name \|\| 'WeCooked account'\}/);
    expect(identity).toMatch(/\{user\?\.email \|\| 'Email unavailable'\}/);
    expect(code).toMatch(/const dietaryPreferences = user\?\.preferences\?\.dietaryPreferences \|\| \[\]/);
    expect(code).toMatch(/const allergies = user\?\.preferences\?\.allergies \|\| \[\]/);
    expect(code).not.toMatch(/const\s+(user|profile)\s*=\s*\{|\brole\s*:\s*['"]/);
    expect(code).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    expect(code).not.toMatch(/dietaryPreferences\s*=\s*\[[^\]]+\]|allergies\s*=\s*\[[^\]]+\]/);
    expect(code).not.toMatch(/<Stat\s+n=\{?\d+/);
  });

  it('renders only the frozen profile identity fields and no future social metrics', () => {
    expect(code).toMatch(/user\?\.avatarUrl/);
    expect(code).toMatch(/user\?\.bio \?\? ''/);
    expect(code).toMatch(/COOKING_LEVEL_LABELS\[user\?\.cookingLevel\]/);
    expect(code).not.toMatch(/followers?|following|badge|ranking|streak/i);
  });

  it('does not fabricate social, engagement, nutrition, recommendation, or AI metrics', () => {
    expect(code).not.toMatch(/popularity|reputation|engagement|nutrition|recommendation|AI-generated/i);
  });

  it('keeps Profile in the existing MainTabs shell', () => {
    const tabs = fs.readFileSync(path.join(SRC, 'navigation/MainTabs.js'), 'utf8');
    const nav = fs.readFileSync(path.join(SRC, 'navigation/RootNavigator.js'), 'utf8');
    expect(tabs).toMatch(/ProfileScreen/);
    expect(nav).not.toMatch(/<Stack\.Screen name="Profile"/);
  });
});
