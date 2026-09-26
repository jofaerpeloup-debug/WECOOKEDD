// Regression coverage for a physical-device bug, in two stages.
//
// V1 bug (signed-in reset): a device signed in when it opened a
// wecooked://reset-password?token=... link would, after the reset succeeded
// and the user signed back in, land back on ResetPasswordScreen's stale
// "Password reset" success screen — because RootNavigator's single
// Stack.Navigator swapped its authenticated/unauthenticated screen sets
// WITHOUT remounting, and "ResetPassword" (and "VerifyEmail") are registered
// under the SAME name in both sets, so React Navigation matched the route by
// name across the swap and kept it mounted/active.
//
// V1 fix (reverted): keying the whole <Stack.Navigator> off isLoggedIn to
// force a full remount on every auth flip.
//
// V2 bug: the V1 fix did not actually solve it, including for the more
// common SIGNED-OUT reset flow (Login -> Forgot password -> open the email
// link -> reset -> "Go to Login" -> log in -> back on ResetPassword). Two
// compounding causes, both provable from @react-navigation/routers'
// StackRouter source (v7, vendored under
// node_modules/@react-navigation/native/node_modules/@react-navigation/core/node_modules/@react-navigation/routers):
//
//   A. navigate(name) in v7 only reuses an EXISTING route in the stack when
//      `name` is the CURRENTLY FOCUSED route (StackRouter's NAVIGATE handler
//      checks `action.payload.name === currentRoute.name`); otherwise it
//      PUSHES a new instance. ResetPasswordScreen's old goContinue() called
//      `navigation.navigate(isLoggedIn ? 'MainTabs' : 'Login')` from
//      ResetPassword itself (always the focused route), so it always pushed
//      Login on top instead of popping back to an existing one — leaving
//      ResetPassword in the history underneath Login.
//   B. The V1 remount-on-flip "fix" didn't clean that up either: remounting
//      makes useNavigationBuilder treat the previous state as stale and call
//      router.getRehydratedState(), which FILTERS the old routes by name
//      against the NEW branch's routeNames — dropping 'Login'/'Landing'
//      (authenticated routeNames don't include them) but KEEPING
//      'ResetPassword' (present in both), so it survived as the sole — and
//      therefore focused — route in the freshly-mounted authenticated stack.
//
// V2 fix: RootNavigator no longer keys the Stack.Navigator at all (so a
// branch swap goes through getStateForRouteNamesChange on the SAME instance,
// not getRehydratedState on a fresh one). That function has an extra escape
// hatch getRehydratedState lacks: it also drops any route whose
// `navigationKey` changed since the last render. ResetPassword and
// VerifyEmail now carry a distinct navigationKey per branch
// ("reset-authed"/"reset-guest", "verify-authed"/"verify-guest"), so an
// isLoggedIn flip always discards them (cause B). Separately,
// ResetPasswordScreen/VerifyEmailScreen's goContinue() now calls
// navigation.reset({ index: 0, routes: [{ name: ... }] }) instead of
// navigate(), which unconditionally replaces the whole stack rather than
// pushing on top of it (cause A).
//
// The mobile workspace has no RN renderer (see jest.config.js — plain Jest,
// react-native mocked down to Platform only, no react-test-renderer / RTL).
// So, like every other *StaticAudit test in this suite, the fix is verified
// as source-code invariants. What this file CANNOT prove is the live runtime
// sequence — that needs the physical retest steps below.
//
// Physical retest (signed-out — the common case, and the one V1 missed):
//   1. Signed out. Login -> Forgot password -> real email arrives.
//   2. Open wecooked://reset-password?token=<valid>. Submit a new password.
//      Reset succeeds.
//   3. Tap "Go to Login". Confirm you land on a CLEAN Login screen — no back
//      gesture reveals ResetPassword underneath it.
//   4. Log in with the new password. Confirm MainTabs appears, with NO
//      ResetPassword screen reachable and no unhandled NAVIGATE error.
//
// Physical retest (signed-in):
//   1. While signed in on a device, open wecooked://reset-password?token=<valid>.
//   2. Submit a new password. Reset succeeds -> local session cleared.
//   3. Confirm the app is now on the SIGNED-OUT stack (Landing/Login) — not
//      stuck on a "Password reset" screen, and ResetPassword is not the
//      active route.
//   4. Log in again. Confirm normal authenticated navigation (MainTabs)
//      appears, with NO ResetPassword screen and no unhandled NAVIGATE error.
//   5. Repeat with wecooked://verify-email?token=<valid> opened while signed
//      in, then sign out and back in: confirm no stale VerifyEmail screen.

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const rootNavRaw = read('navigation/RootNavigator.js');
const rootNav = stripComments(rootNavRaw);
const resetRaw = read('screens/ResetPasswordScreen.js');
const reset = stripComments(resetRaw);
const verifyRaw = read('screens/VerifyEmailScreen.js');
const verify = stripComments(verifyRaw);

describe('RootNavigator — no whole-Navigator remount (it does not discard shared-name routes)', () => {
  it('the single Stack.Navigator carries no React `key` prop', () => {
    // A `key` here would force a remount on every isLoggedIn flip, which goes
    // through getRehydratedState — that function keeps any route whose NAME
    // is still valid in the new branch, so ResetPassword/VerifyEmail (shared
    // by name across both branches) would survive it. See file header.
    const navigatorOpen = rootNavRaw.match(/<Stack\.Navigator\b[^>]*>/);
    expect(navigatorOpen).not.toBeNull();
    expect(navigatorOpen[0]).not.toMatch(/\bkey\s*=/);
  });

  it('still renders exactly one Stack.Navigator (no parallel/duplicate navigator introduced)', () => {
    expect((rootNav.match(/<Stack\.Navigator\b/g) || []).length).toBe(1);
  });

  it('does not introduce a third auth state — RootNavigator still branches on the same boolean', () => {
    expect(rootNav).toMatch(/const \{ isLoggedIn \} = useAuth\(\)/);
    expect(rootNav).toMatch(/\{isLoggedIn \? \(/);
  });
});

describe('RootNavigator — ResetPassword/VerifyEmail use navigationKey to get discarded on auth flip', () => {
  function navigationKeysFor(screenName) {
    const re = new RegExp(
      `<Stack\\.Screen\\s+name="${screenName}"[\\s\\S]*?navigationKey="([^"]+)"`,
      'g'
    );
    return [...rootNav.matchAll(re)].map((m) => m[1]);
  }

  it.each(['ResetPassword', 'VerifyEmail'])(
    '%s has a distinct navigationKey in each of the two branches',
    (name) => {
      const keys = navigationKeysFor(name);
      expect(keys).toHaveLength(2);
      expect(keys[0]).not.toEqual(keys[1]);
    }
  );

  it('registers ResetPassword and VerifyEmail in BOTH the authenticated and unauthenticated stacks', () => {
    const counts = {};
    for (const m of rootNav.matchAll(/<Stack\.Screen\s+name="([^"]+)"/g)) {
      counts[m[1]] = (counts[m[1]] || 0) + 1;
    }
    expect(counts.ResetPassword).toBe(2);
    expect(counts.VerifyEmail).toBe(2);
  });
});

describe('ResetPasswordScreen — goContinue replaces history instead of pushing on top of it', () => {
  it('has no navigate() call left in the file at all (reset() only)', () => {
    // navigate(name) in v7 only pops to an EXISTING route when `name` is the
    // currently-focused one; called from this screen (always the focused
    // route when goContinue fires) it would push a new instance and leave
    // ResetPassword in the history underneath it.
    expect(reset).not.toMatch(/navigation\.navigate\(/);
  });

  it('goContinue resets the stack to a single route, conditioned on isLoggedIn', () => {
    expect(reset).toMatch(
      /const goContinue = \(\) => \{\s*navigation\.reset\(\{\s*index:\s*0,\s*routes:\s*\[\{\s*name:\s*isLoggedIn \? 'MainTabs' : 'Login'\s*\}\]\s*,?\s*\}\);\s*\}/
    );
    expect(reset).toMatch(/const \{ isLoggedIn, endLocalSession \} = useAuth\(\)/);
  });

  it('both buttons (missing-token and succeeded states) call goContinue, not a stale goLogin', () => {
    expect(reset).not.toMatch(/goLogin/);
    const onPressTargets = [...reset.matchAll(/onPress=\{(goContinue|goLogin|submit)\}/g)].map(
      (m) => m[1]
    );
    expect(onPressTargets.filter((t) => t === 'goContinue')).toHaveLength(2);
  });

  it('button labels reflect the conditional destination (no "Login" copy shown while authenticated)', () => {
    expect(reset).toMatch(/title=\{isLoggedIn \? 'Back to app' : 'Back to Login'\}/);
    expect(reset).toMatch(/title=\{isLoggedIn \? 'Continue' : 'Go to Login'\}/);
  });

  it('still clears the local session unconditionally on success before showing the result', () => {
    // The bug fix must not weaken the existing security invariant: any local
    // session this device held is always dropped after a successful reset.
    const tryBlock = resetRaw.match(/try \{[\s\S]*?\n {4}\} catch/);
    expect(tryBlock).not.toBeNull();
    expect(tryBlock[0]).toMatch(/await authService\.resetPassword\(\{ token, newPassword \}\)/);
    expect(tryBlock[0]).toMatch(/await endLocalSession\(\)/);
    // endLocalSession must run before setSucceeded, not after / in parallel.
    const order = tryBlock[0];
    expect(order.indexOf('await endLocalSession()')).toBeLessThan(
      order.indexOf('setSucceeded(true)')
    );
  });

  it('guards post-await state updates with a mounted ref (safe against unmount mid-submit)', () => {
    expect(reset).toMatch(/const mountedRef = useRef\(true\)/);
    expect(reset).toMatch(/mountedRef\.current = false/);
    expect(reset).toMatch(/if \(mountedRef\.current\) setSucceeded\(true\)/);
    expect(reset).toMatch(/if \(mountedRef\.current\) \{/);
    expect(reset).toMatch(/setError\(getAuthErrorMessage\(err\)\)/);
  });

  it('failed reset still leaves session-clearing untouched (no endLocalSession call in the catch branch)', () => {
    const catchBlock = resetRaw.match(/\} catch \(err\) \{[\s\S]*?\n {4}\} finally/);
    expect(catchBlock).not.toBeNull();
    expect(catchBlock[0]).not.toMatch(/endLocalSession/);
  });
});

describe('VerifyEmailScreen — carries the identical reset()-based fix (same v7 push bug, same screen shape)', () => {
  it('has no navigate() call left in the file at all (reset() only)', () => {
    expect(verify).not.toMatch(/navigation\.navigate\(/);
  });

  it('goContinue resets the stack to a single route, conditioned on isLoggedIn', () => {
    expect(verify).toMatch(
      /const goContinue = \(\) => \{\s*navigation\.reset\(\{\s*index:\s*0,\s*routes:\s*\[\{\s*name:\s*isLoggedIn \? 'MainTabs' : 'Login'\s*\}\]\s*,?\s*\}\);\s*\}/
    );
  });

  it('is registered in both RootNavigator stacks (still reachable regardless of auth state)', () => {
    const counts = {};
    for (const m of rootNav.matchAll(/<Stack\.Screen\s+name="([^"]+)"/g)) {
      counts[m[1]] = (counts[m[1]] || 0) + 1;
    }
    expect(counts.VerifyEmail).toBe(2);
    expect(counts.ResetPassword).toBe(2);
  });
});
