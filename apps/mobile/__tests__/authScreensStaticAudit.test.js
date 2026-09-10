// M1 — static source validation of the auth & onboarding screens.
//
// M1 is a presentation migration on top of an auth architecture that must not
// move. These screens are not rendered here (M1 adds no rendering dependency),
// so the invariants that matter are encoded as source assertions: the shapes a
// UI-only pass could plausibly reintroduce from an older/demo frontend, and the
// real wiring that must still be there underneath.
//
// "Forbidden" checks run against a comment-stripped copy, so a phrase appearing
// only in an explanatory comment (e.g. "never navigate to MainTabs") does not
// trip them; "must contain" checks run against the raw source.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SRC = path.join(__dirname, '../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

// Strip // line comments and /* */ block comments (good enough for source
// audit; none of these files' string literals contain `//` or `/*`).
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

// Landing is now a clean port of the teammate OnboardingScreen and composes
// only shared.js + previewMocks.js. WelcomePage / DiscoverPage / StepsPage /
// FavoritesPage are no longer imported by anything — they are retirement
// candidates, restored to their HEAD (pre-M1) content and intentionally OUT
// OF SCOPE for this audit. They are dead code on disk, not part of the M1
// frontend surface, so M1-wide sweeps below (auth/security/theme hygiene)
// must not read them: HEAD's own content (e.g. the pre-R2 orange literal)
// would otherwise fail a sweep that exists to catch M1 regressions, not to
// re-audit an unrelated file nobody imports. If/when these files are
// actually deleted, or ported forward and re-imported, they belong back in
// this map under their own review.
const FILES = {
  Landing: 'screens/LandingScreen.js',
  Login: 'screens/LoginScreen.js',
  Register: 'screens/RegisterScreen.js',
  shared: 'screens/onboarding/shared.js',
  Previews: 'screens/onboarding/previewMocks.js',
};

const raw = {};
const code = {};
for (const [name, rel] of Object.entries(FILES)) {
  raw[name] = read(rel);
  code[name] = stripComments(raw[name]);
}

const NAMES = Object.keys(FILES);

// The five onboarding photos, in slide order, as Landing require()s them
// (paths are relative to src/screens/).
const ONBOARDING_ASSETS = [
  '../assets/onboarding/discover.jpg',
  '../assets/onboarding/cook-mode.jpg',
  '../assets/onboarding/swaps.jpg',
  '../assets/onboarding/meal-plan.jpg',
  '../assets/onboarding/community.jpg',
];

const authServiceRaw = read('api/authService.js');
const authServiceCode = stripComments(authServiceRaw);

describe('no navigation around the auth boundary', () => {
  // RootNavigator swaps stacks off AuthContext state. A screen that pushes
  // itself into MainTabs would put the app "inside" without a real session.
  it.each(NAMES)('%s never replaces or resets into MainTabs', (name) => {
    expect(code[name]).not.toMatch(/\.replace\(\s*['"`]MainTabs/);
    expect(code[name]).not.toMatch(/\.reset\(/);
    expect(code[name]).not.toMatch(/MainTabs/);
  });

  it.each(NAMES)('%s does not navigate on its own after a sign-in call', (name) => {
    // The only navigation these screens may do is between the three
    // unauthenticated routes.
    const targets = [...code[name].matchAll(/navigation\.navigate\(\s*['"`]([^'"`]+)/g)].map(
      (m) => m[1]
    );
    for (const t of targets) {
      expect(['Login', 'Register', 'Landing']).toContain(t);
    }
  });
});

describe('no local authentication or session state', () => {
  it.each(NAMES)('%s stores no auth state of its own', (name) => {
    expect(code[name]).not.toMatch(/AsyncStorage/);
    expect(code[name]).not.toMatch(/async-storage/);
    expect(code[name]).not.toMatch(/SecureStore|expo-secure-store/);
    expect(code[name]).not.toMatch(/tokenStore/);
  });

  it.each(NAMES)('%s never handles tokens itself', (name) => {
    expect(code[name]).not.toMatch(/accessToken|refreshToken|idToken/);
    expect(code[name]).not.toMatch(/setIsLoggedIn|markLoggedIn|fakeLogin|isLoggedIn\s*=/);
  });

  it.each(NAMES)('%s claims no client-side role or status', (name) => {
    expect(code[name]).not.toMatch(/role\s*:\s*['"`]/);
    expect(code[name]).not.toMatch(/status\s*:\s*['"`](active|admin|verified)/i);
  });
});

describe('no OAuth secrets or client-side token exchange', () => {
  it.each(NAMES)('%s carries no Google client secret', (name) => {
    expect(code[name]).not.toMatch(/EXPO_PUBLIC_GOOGLE_CLIENT_SECRET/);
    expect(code[name]).not.toMatch(/client_secret|clientSecret/i);
  });

  it.each(NAMES)('%s performs no OAuth token exchange or device-code flow', (name) => {
    expect(code[name]).not.toMatch(/grant_type|device_code|deviceCode|verificationUrl/i);
    expect(code[name]).not.toMatch(/oauth2\.googleapis\.com|accounts\.google\.com/);
    expect(code[name]).not.toMatch(/\bfetch\s*\(/);
  });
});

describe('no fake or dead identity providers', () => {
  it.each(NAMES)('%s has no Facebook auth control', (name) => {
    expect(code[name]).not.toMatch(/facebook/i);
  });

  it.each(NAMES)('%s has no Apple auth control', (name) => {
    expect(code[name]).not.toMatch(/AppleIcon|apple-?auth|signInWithApple|expo-apple/i);
  });

  it.each(NAMES)('%s has no fake 2FA or provider-profile-as-truth shortcut', (name) => {
    expect(code[name]).not.toMatch(/twoFactor|otpCode|mockUser|demoLogin/i);
    expect(code[name]).not.toMatch(/google\.profile/);
  });

  it('the M1 screens import no provider glyph other than Google', () => {
    for (const name of NAMES) {
      const brandImports = code[name].match(/import\s*\{([^}]*)\}\s*from\s*['"][^'"]*brandKit['"]/);
      if (!brandImports) continue;
      expect(brandImports[1]).not.toMatch(/Facebook/);
    }
  });
});

describe('the real auth wiring is still in place', () => {
  it('Login signs in through useAuth().signIn and lets RootNavigator react', () => {
    expect(raw.Login).toMatch(/const \{ signIn \} = useAuth\(\)/);
    expect(raw.Login).toMatch(/await signIn\(\{ email: trimmedEmail, password \}\)/);
  });

  it('Register registers through useAuth().signUp with only name/email/password', () => {
    expect(raw.Register).toMatch(/const \{ signUp \} = useAuth\(\)/);
    expect(raw.Register).toMatch(
      /await signUp\(\{ name: trimmedName, email: trimmedEmail, password \}\)/
    );
  });

  it('both screens guard against duplicate submissions', () => {
    for (const name of ['Login', 'Register']) {
      expect(code[name]).toMatch(/inFlightRef/);
      expect(code[name]).toMatch(/if \(inFlightRef\.current\) return;/);
    }
  });

  it('both screens wrap Google with the same synchronous action guard', () => {
    for (const name of ['Login', 'Register']) {
      expect(code[name]).toMatch(/const signInWithGoogle = async \(\) =>/);
      expect(code[name]).toMatch(/await google\.signIn\(\)/);
      expect(code[name]).toMatch(/onPress=\{signInWithGoogle\}/);
      expect(code[name]).not.toMatch(/onPress=\{google\.signIn\}/);
    }
  });

  it('both screens map errors through the shared safe mapper', () => {
    for (const name of ['Login', 'Register']) {
      expect(raw[name]).toMatch(/getAuthErrorMessage/);
      expect(code[name]).not.toMatch(/err\.message|error\.response/);
    }
  });

  it('Login and Register share ONE Google implementation — the real hook', () => {
    for (const name of ['Login', 'Register']) {
      expect(raw[name]).toMatch(/import useGoogleSignIn from '\.\.\/hooks\/useGoogleSignIn'/);
      expect(code[name]).toMatch(/useGoogleSignIn\(\)/);
      // The button calls the hook's callback; it does not re-implement a flow.
      expect(code[name]).toMatch(/onPress=\{signInWithGoogle\}/);
      expect(code[name]).not.toMatch(/googleAuthFlow|nativeGoogleSignIn|GoogleSignin\./);
    }
  });
});

describe('Landing stays presentation-only', () => {
  it('holds no authentication of any kind', () => {
    expect(code.Landing).not.toMatch(/useAuth|useGoogleSignIn|signIn|signUp|authService/);
  });

  it('records no onboarding-seen flag (deliberately out of scope for M1)', () => {
    expect(code.Landing).not.toMatch(/markOnboardingSeen|onboardingSeen|hasSeenOnboarding/);
  });

  it('Skip moves the carousel to the final slide instead of leaving the screen', () => {
    const skip = raw.Landing.match(/const skipToEnd = [^;]*;/);
    expect(skip).not.toBeNull();
    expect(skip[0]).toMatch(/goToSlide\(TOTAL - 1\)/);
    expect(skip[0]).not.toMatch(/navigation\./);
  });

  it('the final slide keeps both real destinations', () => {
    // Intentional WeCooked product flow: a primary "Create Account" → Register
    // and a secondary "I already have an account" → Login. The teammate's
    // single "Get Started" CTA is a visual reference only, not our auth flow.
    expect(raw.Landing).toMatch(/navigation\.navigate\('Register'\)/);
    expect(raw.Landing).toMatch(/navigation\.navigate\('Login'\)/);
    expect(raw.Landing).toMatch(/>Create Account</);
    expect(raw.Landing).toMatch(/I already have an account/);
    expect(code.Landing).not.toMatch(/>Get Started</);
  });

  it('never adopts the teammate finish() — no seen-flag, no session read, no MainTabs', () => {
    expect(code.Landing).not.toMatch(/markOnboardingSeen|useAuth|isLoggedIn/);
    expect(code.Landing).not.toMatch(/\.replace\(|\.reset\(|MainTabs/);
    expect(code.Landing).not.toMatch(/AsyncStorage|SecureStore|tokenStore/);
  });
});

describe('Landing is a clean port of the teammate onboarding screen', () => {
  // Landing was rebuilt from the teammate OnboardingScreen at commit c1c86ed.
  // These are STRUCTURAL SOURCE GUARDS ONLY. Jest renders nothing here and
  // measures no layout, so none of them can show that anything is visible on a
  // device — only an on-device retest can. What they do pin down is the shape
  // of the port: five slides, five distinct bundled photos, the photo carried
  // by ImageBackground rather than by a standalone full-screen sibling
  // <Image>, and none of the measured-height / zIndex / global-footer
  // workarounds the earlier experimental Landing accumulated.

  const slidesBlock = raw.Landing.match(/const SLIDES = \[[\s\S]*?\n\];/);

  it('has exactly five slides', () => {
    expect(slidesBlock).not.toBeNull();
    expect(slidesBlock[0].match(/^\s{2}\{$/gm)).toHaveLength(5);
    expect(code.Landing).toMatch(/const TOTAL = SLIDES\.length;/);
  });

  it('carries the five teammate slide tags and headlines, in order', () => {
    const tags = [...slidesBlock[0].matchAll(/tag: '([^']+)'/g)].map((m) => m[1]);
    expect(tags).toEqual([
      'Discover',
      'Cook Mode',
      'Ingredient Swaps',
      'Meal Plan',
      'Community',
    ]);

    const titles = [...slidesBlock[0].matchAll(/title: '([^']+)'/g)].map((m) =>
      m[1].replace(/\\n/g, ' ')
    );
    expect(titles).toEqual([
      'One search, every recipe',
      'Cook it hands-free',
      'Out of something? Swap it',
      'Plan the week, shop once',
      'Cook with everyone',
    ]);
  });

  it('backs each slide with its own bundled onboarding photo, in slide order', () => {
    const required = [...raw.Landing.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1]);
    expect(required).toEqual(ONBOARDING_ASSETS);
  });

  it('ships all five photos as distinct local files', () => {
    const digests = ONBOARDING_ASSETS.map((rel) => {
      const file = path.join(SRC, 'screens', rel);
      expect(fs.existsSync(file)).toBe(true);
      const bytes = fs.readFileSync(file);
      // A real JPEG, not a placeholder or an LFS pointer.
      expect(bytes.length).toBeGreaterThan(1024);
      expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
      return crypto.createHash('sha256').update(bytes).digest('hex');
    });
    expect(new Set(digests).size).toBe(5);
  });

  it('does not reuse the orphan landing-bg / login-bg photos', () => {
    expect(code.Landing).not.toMatch(/landing-bg|login-bg|landing screen ads/);
    expect(code.Landing).not.toMatch(/assets\/landing\//);
  });

  it('paints the photo with ImageBackground, never a standalone full-screen Image', () => {
    const rnImports = raw.Landing.match(/import \{([\s\S]*?)\} from 'react-native';/);
    expect(rnImports).not.toBeNull();
    const imported = rnImports[1].split(',').map((s) => s.trim()).filter(Boolean);
    expect(imported).toContain('ImageBackground');
    // The sibling <Image absoluteFill /> structure that painted over later
    // foreground siblings on the physical Samsung must not come back.
    expect(imported).not.toContain('Image');
    expect(code.Landing).not.toMatch(/<Image[\s/>]/);
    expect(raw.Landing).toMatch(/<ImageBackground/);
    expect(raw.Landing).toMatch(/resizeMode="cover"/);
  });

  it('makes the scrim and the foreground CHILDREN of the ImageBackground', () => {
    const open = raw.Landing.indexOf('<ImageBackground');
    const close = raw.Landing.indexOf('</ImageBackground>');
    const scrim = raw.Landing.indexOf('<SlideScrim');
    const foreground = raw.Landing.indexOf('styles.foreground');
    expect(open).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(open);
    expect(scrim).toBeGreaterThan(open);
    expect(scrim).toBeLessThan(close);
    expect(foreground).toBeGreaterThan(scrim);
    expect(foreground).toBeLessThan(close);
    expect(code.Landing).toMatch(/scrim:\s*\{\s*\.\.\.StyleSheet\.absoluteFillObject/);
  });

  it('paints the scrim with ordinary stacked Views, never expo-linear-gradient', () => {
    // Physical-device testing (Samsung/Fabric) proved LinearGradient does not
    // paint in this composition: an opaque-red LinearGradient canary showed
    // nothing, while an ordinary View/Text style edit in the same file, same
    // reload, did render. The scrim must therefore be built entirely from
    // plain Views — no gradient import, no gradient element, anywhere in
    // Landing.
    expect(code.Landing).not.toMatch(/expo-linear-gradient/);
    expect(code.Landing).not.toMatch(/LinearGradient/);
    expect(raw.Landing).toMatch(/function SlideScrim\(\)/);
    expect(code.Landing).toMatch(/SCRIM_BANDS\.map/);
    // Every band is a plain, non-gradient View painted with the shared base
    // color at its own fixed opacity — not an interpolated/animated color.
    expect(code.Landing).toMatch(/backgroundColor:\s*`rgba\(\$\{SCRIM_BASE\},\$\{band\.opacity\}\)`/);
  });

  it('the scrim bands cover the full height with no gaps and no overlap', () => {
    const bandsBlock = raw.Landing.match(/const SCRIM_BANDS = \[[\s\S]*?\n\];/);
    expect(bandsBlock).not.toBeNull();
    const bands = [...bandsBlock[0].matchAll(/\{ top: ([\d.]+), height: ([\d.]+), opacity: ([\d.]+) \}/g)].map(
      (m) => ({ top: Number(m[1]), height: Number(m[2]), opacity: Number(m[3]) })
    );
    expect(bands.length).toBeGreaterThanOrEqual(6);
    // Bands are sorted and abut exactly (no gap, no overlap), so there is no
    // multiplicative double-darkening anywhere and no uncovered strip either.
    for (let i = 0; i < bands.length; i++) {
      expect(bands[i].opacity).toBeGreaterThan(0);
      expect(bands[i].opacity).toBeLessThanOrEqual(1);
      if (i > 0) {
        // 1-decimal source values (e.g. 8.33 × 3 ≈ 16.66 vs a true-thirds
        // 16.666...) can differ from an exact sum by a couple hundredths —
        // real gaps/overlaps are an order of magnitude bigger than that.
        expect(bands[i].top).toBeCloseTo(bands[i - 1].top + bands[i - 1].height, 1);
      }
    }
    expect(bands[0].top).toBeCloseTo(0, 2);
    expect(bands[bands.length - 1].top + bands[bands.length - 1].height).toBeCloseTo(100, 1);
    // No adjacent-band opacity jump reads as a hard seam.
    for (let i = 1; i < bands.length; i++) {
      expect(Math.abs(bands[i].opacity - bands[i - 1].opacity)).toBeLessThan(0.25);
    }
  });

  it('adds no stacking-order hacks on top of the scrim', () => {
    expect(code.Landing).not.toMatch(/zIndex|elevation/);
    expect(code.Landing).not.toMatch(/blurRadius/);
  });

  it('carries none of the failed measured-layout experiments', () => {
    expect(code.Landing).not.toMatch(/pagerHeight|handlePagerLayout|footerHeight/);
    expect(code.Landing).not.toMatch(/onLayout|nativeEvent\.layout/);
    expect(code.Landing).not.toMatch(/Dimensions\.get\(/);
    expect(code.Landing).not.toMatch(/StatusBar\.currentHeight/);
    expect(code.Landing).not.toMatch(/minHeight:\s*height/);
  });

  it('sizes each page from the window and respects the safe area', () => {
    expect(code.Landing).toMatch(/const \{ width, height \} = useWindowDimensions\(\)/);
    expect(code.Landing).toMatch(/style=\{\{ width, height,/);
    expect(raw.Landing).toMatch(/useSafeAreaInsets\(\)/);
    expect(code.Landing).toMatch(/insets\.top/);
    expect(code.Landing).toMatch(/insets\.bottom/);
  });

  it('keeps the footer a non-shrinking, normal-flow sibling after the body region', () => {
    expect(code.Landing).toMatch(/footer:\s*\{[^}]*flexShrink:\s*0/);
    expect(code.Landing).not.toMatch(/footer:\s*\{[^}]*position:\s*'absolute'/);
    // Source order: the body ScrollView closes before the footer View opens,
    // so the footer is a sibling after it rather than content inside it.
    const scrollClose = raw.Landing.indexOf('</ScrollView>');
    const footerOpen = raw.Landing.indexOf('<View style={styles.footer}>');
    expect(scrollClose).toBeGreaterThan(-1);
    expect(footerOpen).toBeGreaterThan(scrollClose);
  });

  it('lets the body region scroll when the composition outgrows the screen', () => {
    expect(code.Landing).toMatch(/<ScrollView[\s\S]*?nestedScrollEnabled[\s\S]*?>/);
    expect(code.Landing).toMatch(/body:\s*\{\s*flex:\s*1\s*\}/);
    expect(code.Landing).toMatch(/bodyContent:\s*\{\s*flexGrow:\s*1\s*\}/);
  });

  it('draws its preview panels offline, with no remote image or mock-data source', () => {
    for (const name of ['Landing', 'Previews']) {
      expect(code[name]).not.toMatch(/https?:\/\//);
      expect(code[name]).not.toMatch(/\buri:/);
      expect(code[name]).not.toMatch(/unsplash|picsum|placeholder\.com/i);
      expect(code[name]).not.toMatch(/mockData|mocks\/|fixtures\//);
      expect(code[name]).not.toMatch(/imageSource\(/);
    }
    // The sketches are geometry, not photography.
    expect(code.Previews).not.toMatch(/<Image[\s/>]/);
    expect(code.Previews).not.toMatch(/require\(/);
  });

  it('wires one preview sketch per slide, from the five ported teammate mocks', () => {
    const mockKeys = [...slidesBlock[0].matchAll(/mock: '([^']+)'/g)].map((m) => m[1]);
    expect(mockKeys).toEqual(['search', 'cook', 'swap', 'plan', 'community']);
    for (const key of mockKeys) {
      expect(code.Previews).toMatch(new RegExp(`\\b${key}:\\s*\\w+Mock`));
    }
    expect(code.Landing).toMatch(/PREVIEW_MOCKS\[slide\.mock\]/);
  });

  it('advances with a per-slide chevron and ends on the two real destinations', () => {
    expect(code.Landing).toMatch(/goToSlide\(i \+ 1\)/);
    expect(raw.Landing).toMatch(/name="chevron-forward"/);
    expect(raw.Landing).toMatch(/navigation\.navigate\('Register'\)/);
    expect(raw.Landing).toMatch(/navigation\.navigate\('Login'\)/);
  });

  it('composes from the shared Sage & Stone onboarding kit, not a second palette', () => {
    expect(raw.Landing).toMatch(/from '\.\/onboarding\/shared'/);
    expect(code.Landing).toMatch(/ONBOARD_C/);
    expect(code.Previews).toMatch(/ONBOARD_C/);
    // The teammate's literal fixed palette is not reintroduced.
    for (const name of ['Landing', 'Previews']) {
      expect(code[name]).not.toMatch(/#15180F|#26332B/i);
    }
  });
});

describe('theme and asset hygiene', () => {
  it('Login and Register are theme-aware (both Sage & Stone modes)', () => {
    for (const name of ['Login', 'Register']) {
      expect(raw[name]).toMatch(/useTheme\(\)/);
      expect(code[name]).toMatch(/const \{ colors, isDark \} = useTheme\(\)/);
    }
  });

  it('no M1 file reintroduces the stale pre-R2 orange', () => {
    for (const name of NAMES) {
      expect(code[name]).not.toMatch(/#F5821F/i);
      expect(code[name]).not.toMatch(/rgba\(\s*245\s*,\s*130\s*,\s*31/);
    }
  });

  it('no M1 file wraps a require() in a { uri } object (SDK57 image sources)', () => {
    for (const name of NAMES) {
      expect(code[name]).not.toMatch(/\{\s*uri:\s*require\(/);
    }
  });

  // The "route mixed mock-data images through imageSource()" check that used
  // to live here applied only to DiscoverPage/StepsPage/FavoritesPage — the
  // retired onboarding pages, now out of NAMES (see the FILES comment
  // above). Landing's own previews are covered instead by "draws its preview
  // panels offline..." above, which already asserts previewMocks.js uses no
  // require()/<Image> at all.
});

describe('forgot-password request step', () => {
  const forgotFn = authServiceCode.match(/export function forgotPassword\([\s\S]*?\n\}/);

  it('exists as an additive public request on authService', () => {
    expect(forgotFn).not.toBeNull();
    expect(forgotFn[0]).toMatch(/api\.post\('\/auth\/forgot-password'/);
    expect(forgotFn[0]).toMatch(/auth:\s*false/);
  });

  it('never joins a session path', () => {
    expect(forgotFn[0]).not.toMatch(/establishSession|applyTokens|endSession/);
    expect(forgotFn[0]).not.toMatch(/tokenStore|accessToken|refreshToken/);
  });

  it('Login asks for a reset without revealing whether the account exists', () => {
    expect(raw.Login).toMatch(/authService\.forgotPassword\(trimmedEmail\)/);
    // One fixed confirmation string, and no branch that could vary it.
    expect(raw.Login).toMatch(/If an account exists for that email/);
    expect(code.Login).not.toMatch(/(no|not) account|unknown email|never registered/i);
  });

  it('Login requires an email before sending the request', () => {
    const reset = raw.Login.match(
      /const requestPasswordReset = async \(\) => \{[\s\S]*?\n  \};/
    );
    expect(reset).not.toBeNull();
    expect(reset[0]).toMatch(/if \(!trimmedEmail\)/);
    // The guard returns before any request goes out.
    const guardIndex = reset[0].indexOf('if (!trimmedEmail)');
    const callIndex = reset[0].indexOf('authService.forgotPassword');
    expect(guardIndex).toBeGreaterThan(-1);
    expect(callIndex).toBeGreaterThan(guardIndex);
  });

  it('adds no password-reset completion route or token handling on device', () => {
    expect(code.Login).not.toMatch(/resetPassword|reset-password|resetToken/);
  });
});

describe('M1 adds no password-manager integration to the auth fields', () => {
  // M1 is a presentation migration. Password-manager integration is deferred to
  // its own slice, so these fields stay exactly where HEAD left them: no
  // autofill hints of any kind. These assertions describe that absence and
  // nothing about how the deferred slice should eventually be built.
  //
  // What the migration DOES keep is input hardening that stands on its own,
  // independent of autofill: the email keyboard, and the IME transforms pinned
  // off on both fields.
  const inputBlocks = (name) => [...raw[name].matchAll(/<Input\b[\s\S]*?\/>/g)].map((m) => m[0]);

  const emailField = (name) => {
    const fields = inputBlocks(name).filter((block) => /value=\{email\}/.test(block));
    expect(fields).toHaveLength(1);
    return fields[0];
  };

  const passwordField = (name) => {
    const secure = inputBlocks(name).filter((block) => /\bsecureTextEntry\b/.test(block));
    expect(secure).toHaveLength(1);
    return secure[0];
  };

  it.each(['Login', 'Register'])('%s introduces no autoComplete on any field', (name) => {
    for (const block of inputBlocks(name)) {
      expect(block).not.toMatch(/autoComplete/);
    }
  });

  it.each(['Login', 'Register'])('%s introduces no importantForAutofill on any field', (name) => {
    for (const block of inputBlocks(name)) {
      expect(block).not.toMatch(/importantForAutofill/);
    }
  });

  it('Register introduces no credential-pairing textContentType', () => {
    expect(emailField('Register')).not.toMatch(/textContentType/);
    expect(passwordField('Register')).not.toMatch(/textContentType/);
  });

  it.each(['Login', 'Register'])(
    '%s email field keeps the email keyboard and the IME transforms off',
    (name) => {
      const field = emailField(name);
      expect(field).toMatch(/keyboardType="email-address"/);
      expect(field).toMatch(/autoCapitalize="none"/);
      expect(field).toMatch(/autoCorrect=\{false\}/);
      expect(field).toMatch(/spellCheck=\{false\}/);
    }
  );

  it.each(['Login', 'Register'])('%s email field stays controlled', (name) => {
    const field = emailField(name);
    expect(field).toMatch(/value=\{email\}/);
    expect(field).toMatch(/onChangeText=\{setEmail\}/);
  });

  it.each(['Login', 'Register'])('%s password input stays masked and controlled', (name) => {
    const field = passwordField(name);
    expect(field).toMatch(/\bsecureTextEntry\b/);
    expect(field).toMatch(/value=\{password\}/);
    expect(field).toMatch(/onChangeText=\{setPassword\}/);
  });

  it.each(['Login', 'Register'])('%s password input pins the IME transforms off', (name) => {
    // Kept for its own sake, not as autofill support: the eye toggle unmasks
    // the field, and a plain TYPE_CLASS_TEXT field would otherwise get sentence
    // capitalisation and IME suggestions applied to a typed password.
    const field = passwordField(name);
    expect(field).toMatch(/autoCapitalize="none"/);
    expect(field).toMatch(/autoCorrect=\{false\}/);
    expect(field).toMatch(/spellCheck=\{false\}/);
  });

  it('neither screen transforms the password before submitting it', () => {
    // name/email are trimmed by design; the password must reach the API
    // byte-for-byte or bcrypt.compare can never match at login.
    expect(raw.Register).toMatch(
      /await signUp\(\{ name: trimmedName, email: trimmedEmail, password \}\)/
    );
    expect(raw.Login).toMatch(/await signIn\(\{ email: trimmedEmail, password \}\)/);
    for (const name of ['Login', 'Register']) {
      expect(code[name]).not.toMatch(
        /password\.(trim|toLowerCase|toUpperCase|normalize|replace)\(/
      );
    }
  });

  it('the shared Input still owns masking and adds no autofill of its own', () => {
    const input = read('components/Input.js');
    expect(input).toMatch(/secureTextEntry=\{hidden\}/);
    expect(input).not.toMatch(/importantForAutofill/);
    expect(input).not.toMatch(/autoComplete/);
  });
});
