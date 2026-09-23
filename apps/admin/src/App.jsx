import React, { useState, useEffect, useMemo } from 'react';
import {
  LayoutDashboard, ChefHat, Users, X,
  Leaf, Check, CheckCircle2, LogOut, Mail, Lock, Eye, EyeOff,
  AlertCircle, ArrowRight, User, Settings, HelpCircle,
  Accessibility, ChevronDown, Carrot, ShieldAlert, Replace, ShieldCheck, UserCog,
} from 'lucide-react';
import { useCallback, useRef } from 'react';
import { auth } from './firebase.js';
import {
  logIn, logOutUser, requestUserEmailChange, deleteCurrentAccount,
} from './auth.js';
import { useBackendAuth } from './backendAuth.js';
import { listRecipes } from './recipeApi.js';
import { listUsers } from './userApi.js';
import { slugLabel } from './recipeOptions.js';
import IngredientsTab from './IngredientsTab.jsx';
import SubstitutionsTab from './SubstitutionsTab.jsx';
import RecipesTab from './RecipesTab.jsx';
import UsersTab from './UsersTab.jsx';
import StaffManagementTab from './StaffManagementTab.jsx';
import {
  ConsumerScreen,
  FieldErrors,
  PendingState,
  PasswordRequirements,
  RejectedState,
  StaffBootstrapError,
  StaffPortalAuthScreen,
  StaffPortalScreenStyles,
  SupportingAuthFrame,
  VerifyEmailState,
} from './StaffPortalScreens.jsx';
import {
  applyAsModerator,
  changeBackendPassword,
  getStaffState,
  requestBackendPasswordReset,
  resetBackendPassword,
  resendBackendVerification,
  updateBackendName,
} from './staffApi.js';
import { getCatalogPolicy, getPortalDestination, getSafeNavigation } from './portalPolicy.js';
import { staffErrorMessage, staffFieldErrors } from './staffErrorMessage.js';
import { registerModeratorApplicant, retryModeratorApplication } from './staffOnboarding.js';
import {
  backendStaffIdentity,
  hasStaffAuthErrors,
  passwordRequirementState,
  resetTokenFromHash,
  validateCurrentPassword,
  validateStaffName,
} from './staffContracts.js';
import { completeStaffPasswordChange, updateStaffName } from './staffAccountActions.js';

const DISPLAY_PREFS_KEY = 'wecooked-admin-display-prefs';

function authoritativePaginationTotal(pagination) {
  const total = pagination?.total;
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new Error('Dashboard response has an invalid pagination total.');
  }
  return total;
}

export async function loadRecipeDashboardData(request = listRecipes) {
  try {
    const { recipes, pagination } = await request({
      status: 'all', sort: 'newest', page: 1, limit: 100,
    });
    return {
      status: 'ready',
      total: authoritativePaginationTotal(pagination),
      latest: recipes.slice(0, 4),
    };
  } catch {
    return { status: 'error', total: 0, latest: [] };
  }
}

export async function loadUserDashboardData(request = listUsers) {
  try {
    const [all, active, suspended] = await Promise.all([
      request({ limit: 1 }),
      request({ limit: 1, status: 'active' }),
      request({ limit: 1, status: 'suspended' }),
    ]);
    return {
      status: 'ready',
      total: authoritativePaginationTotal(all.pagination),
      active: authoritativePaginationTotal(active.pagination),
      suspended: authoritativePaginationTotal(suspended.pagination),
    };
  } catch {
    return { status: 'error', total: 0, active: 0, suspended: 0 };
  }
}

// Thin wrappers around window.storage that NEVER throw synchronously and never
// reject -- window.storage itself may be missing in some rendering contexts,
// and a raw `window.storage.set(...)` call would throw before `.catch()` can
// even attach. Falling back to "do nothing" here means the app keeps working
// for the current session even if persistence isn't available.
async function safeGet(key, shared = false) {
  try {
    if (!window.storage) return null;
    const r = await window.storage.get(key, shared);
    return r || null;
  } catch (e) {
    return null;
  }
}
async function safeSet(key, value, shared = false) {
  try {
    if (!window.storage) return false;
    await window.storage.set(key, value, shared);
    return true;
  } catch (e) {
    return false;
  }
}
async function safeDelete(key, shared = false) {
  try {
    if (!window.storage) return false;
    await window.storage.delete(key, shared);
    return true;
  } catch (e) {
    return false;
  }
}

function WeCookedAdminApp() {
  // Backend local auth is the authoritative gate for this dashboard and for
  // every WeCooked REST API call. Firebase auth is kept alongside it, best
  // effort, only for the legacy email-change and delete-account surfaces that
  // remain until SP2B.
  const backend = useBackendAuth();

  const [tab, setTab] = useState('overview');
  const [staffState, setStaffState] = useState({ status: 'idle', data: null, error: '' });
  const [applicationNotice, setApplicationNotice] = useState('');
  const staffRequestRef = useRef(0);
  // Recipes and users are fully REST-backed now (zero Firestore). The Overview
  // tab shows a few summary widgets, so it pulls lightweight, best-effort
  // counts from the same REST APIs the Recipes / Users tabs use.
  //
  // The "Cuisines" breakdown widget was removed in M3 when `cuisine` left the
  // Recipe domain. A replacement region/category visualization waits on a
  // content-classification milestone — showing one now would be misleading
  // (no existing recipe is classified yet).
  const [recipeStats, setRecipeStats] = useState({ status: 'idle', total: 0, latest: [] });
  const [userCounts, setUserCounts] = useState({ status: 'idle', total: 0, active: 0, suspended: 0 });

  const [firebaseAccountEmail, setFirebaseAccountEmail] = useState('');
  const [authNotice, setAuthNotice] = useState('');
  const [confirmDeleteAccount, setConfirmDeleteAccount] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [displayPrefs, setDisplayPrefs] = useState({ theme: 'light', reduceMotion: false });
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  const [resetToken, setResetToken] = useState(() => resetTokenFromHash(window.location.hash));

  function removeResetTokenFromUrl() {
    const url = new URL(window.location.href);
    url.hash = '';
    window.history.replaceState({}, '', url.pathname + url.search);
  }

  function clearResetLink() {
    setResetToken(null);
    removeResetTokenFromUrl();
  }

  const refreshStaffState = useCallback(async ({ showLoading = true } = {}) => {
    const requestId = ++staffRequestRef.current;
    if (showLoading) setStaffState((current) => ({ ...current, status: 'loading', error: '' }));
    try {
      const data = await getStaffState();
      if (requestId === staffRequestRef.current) setStaffState({ status: 'ready', data, error: '' });
      return data;
    } catch (error) {
      if (requestId === staffRequestRef.current) {
        setStaffState({ status: 'error', data: null, error: staffErrorMessage(error) });
      }
      throw error;
    }
  }, []);

  useEffect(() => {
    if (backend.status !== 'authenticated') {
      staffRequestRef.current += 1;
      setStaffState({ status: 'idle', data: null, error: '' });
      return undefined;
    }
    let cancelled = false;
    const requestId = ++staffRequestRef.current;
    setStaffState((current) => ({ ...current, status: 'loading', error: '' }));
    getStaffState()
      .then((data) => {
        if (!cancelled && requestId === staffRequestRef.current) {
          setStaffState({ status: 'ready', data, error: '' });
        }
      })
      .catch((error) => {
        if (!cancelled && requestId === staffRequestRef.current) {
          setStaffState({ status: 'error', data: null, error: staffErrorMessage(error) });
        }
      });
    return () => { cancelled = true; };
  }, [backend.status, backend.user?.id]);

  useEffect(() => {
    const mode = staffState.data?.mode;
    if (mode !== 'admin' && mode !== 'moderator') return;
    setTab((current) => getSafeNavigation(mode, current));
  }, [staffState.data?.mode]);

  useEffect(() => {
    // Keep only an availability flag for the SP2B email/delete compatibility
    // surfaces. Displayed identity never derives from this observer.
    const unsub = auth.onAuthStateChanged((user) => {
      setFirebaseAccountEmail(user?.email || '');
    });
    return unsub;
  }, []);

  useEffect(() => {
    // Recipe stats for the Overview tab, straight from the REST API — no
    // Firestore. The Overview keeps loading and failure distinct from real zero values.
    if (backend.status !== 'authenticated' || backend.user?.role !== 'admin') return undefined;
    let cancelled = false;
    setRecipeStats((current) => ({ ...current, status: 'loading' }));
    (async () => {
      const nextState = await loadRecipeDashboardData();
      if (!cancelled) setRecipeStats(nextState);
    })();
    return () => { cancelled = true; };
  }, [backend.status, backend.user?.role]);

  useEffect(() => {
    // User counts for the Overview tab, straight from the REST API — no
    // Firestore. Refetched whenever the admin lands on Overview so a suspend /
    // reactivate done on the Users tab is reflected. Only pagination.total is
    // read (limit: 1 keeps the payload tiny). Best-effort: a failure just
    // leaves the current totals in an explicit unavailable state.
    if (tab !== 'overview') return undefined;
    if (backend.status !== 'authenticated' || backend.user?.role !== 'admin') return undefined;
    let cancelled = false;
    setUserCounts((current) => ({ ...current, status: 'loading' }));
    (async () => {
      const nextState = await loadUserDashboardData();
      if (!cancelled) setUserCounts(nextState);
    })();
    return () => { cancelled = true; };
  }, [tab, backend.status, backend.user?.role]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const p = await safeGet(DISPLAY_PREFS_KEY, false);
      if (p && p.value && !cancelled) {
        try {
          const parsed = JSON.parse(p.value);
          setDisplayPrefs((prev) => ({ ...prev, ...parsed }));
        } catch (e) { /* corrupt data, keep defaults */ }
      }
      if (!cancelled) setPrefsLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!prefsLoaded) return;
    safeSet(DISPLAY_PREFS_KEY, JSON.stringify(displayPrefs), false);
  }, [displayPrefs, prefsLoaded]);

  const metrics = useMemo(() => ({
    totalRecipes: recipeStats.total,
    totalUsers: userCounts.total,
    activeUsers: userCounts.active,
    suspendedUsers: userCounts.suspended,
  }), [recipeStats.total, userCounts]);

  async function registerAndApply({ name, email, password }) {
    setApplicationNotice('');
    const result = await registerModeratorApplicant({
      register: backend.register,
      apply: applyAsModerator,
      refresh: () => refreshStaffState({ showLoading: false }),
    }, { name, email, password });
    if (!result.applicationSubmitted) {
      setApplicationNotice(
        'Your account was created, but the Moderator application was not submitted. Use Retry Application below; you do not need to register again.',
      );
      try {
        await refreshStaffState({ showLoading: false });
      } catch {
        // The authenticated account/session remains valid. The bootstrap error
        // screen offers an explicit retry without repeating registration.
      }
      return;
    }
  }

  async function signIn({ email, password }) {
    // Backend login is authoritative — it throws on bad credentials, a
    // suspended account, or the API being unreachable, and the sign-in form
    // surfaces that message.
    setAuthNotice('');
    await backend.login(email, password);
    // Best effort: mirror the sign-in to Firebase so the SP2B email-change and
    // delete-account compatibility surfaces keep working for admins whose
    // credentials also exist there. A failure here is expected for
    // backend-only admins and must not block.
    try {
      await logIn(email, password);
    } catch (err) {
      console.warn('Firebase sign-in unavailable (account flows will be limited):', err?.code || err);
    }
    return true;
  }

  async function forgotStaffPassword(email) {
    await requestBackendPasswordReset(email);
  }

  async function signOut() {
    await backend.logout();
    try {
      await logOutUser();
    } catch {
      // No Firebase session to end — fine.
    }
    setProfileMenuOpen(false);
    setApplicationNotice('');
    setStaffState({ status: 'idle', data: null, error: '' });
  }

  async function submitModeratorApplication() {
    const state = await retryModeratorApplication({
      apply: applyAsModerator,
      refresh: () => refreshStaffState({ showLoading: false }),
    });
    setApplicationNotice('');
    return state;
  }

  async function resendModeratorVerification() {
    if (!backend.user?.email) throw new Error('The current account email is unavailable.');
    return resendBackendVerification(backend.user.email);
  }

  const refreshAuthority = useCallback(() => {
    backend.refreshUser().catch(() => {});
    refreshStaffState({ showLoading: false }).catch(() => {});
  }, [backend.refreshUser, refreshStaffState]);

  async function deleteAccount(password) {
    await deleteCurrentAccount(password);
    setConfirmDeleteAccount(false);
    setProfileMenuOpen(false);
  }

  async function updateProfile({ name }) {
    return updateStaffName({
      requestUpdate: updateBackendName,
      refreshUser: backend.refreshUser,
    }, name);
  }

  async function changePassword({ currentPassword, newPassword }) {
    await completeStaffPasswordChange({
      requestChange: changeBackendPassword,
      clearSession: backend.clearSession,
      signOutFirebase: logOutUser,
    }, { currentPassword, newPassword });
    setSettingsOpen(false);
    setAuthNotice('Your password was updated. Sign in again with your new password.');
  }

  async function requestEmailChange(email) {
    await requestUserEmailChange(email);
  }

  function updateDisplayPrefs(patch) {
    setDisplayPrefs((prev) => ({ ...prev, ...patch }));
  }

  // The REST-hydrated backend user is the sole displayed Staff identity.
  const identity = backendStaffIdentity(backend.user);
  const firebaseAccountAvailable = Boolean(
    firebaseAccountEmail
      && identity?.email
      && firebaseAccountEmail.trim().toLowerCase() === identity.email.trim().toLowerCase(),
  );

  const portalDestination = getPortalDestination(staffState.data?.mode);
  const catalogPolicy = getCatalogPolicy(staffState.data?.mode);

  return (
    <div className={`wc-admin ${displayPrefs.theme === 'dark' ? 'wc-dark' : ''} ${displayPrefs.reduceMotion ? 'wc-reduce-motion' : ''}`}>
      <style>{`
        .wc-admin {
          --cream: #FAF9F6;
          --parchment: #F1ECE1;
          --sage-deep: #4A5D4E;
          --sage-mid: #6B8069;
          --sage-light: #C0D5C2;
          --ink: #2A2F28;
          --stone: #8C8577;
          --stone-light: #DAD3C4;
          --saffron: #C9962E;
          --clay: #B15A3E;
          --field-bg: #FFFFFF;
          font-family: 'Inter', -apple-system, sans-serif;
          color: var(--ink);
          background: var(--cream);
          min-height: 100vh;
          display: flex;
          width: 100%;
        }
        .wc-admin.wc-dark {
          --cream: #1E211D;
          --parchment: #262B24;
          --sage-mid: #7C9478;
          --sage-light: #9DBB9C;
          --ink: #EDEAE0;
          --stone: #A39C8C;
          --stone-light: #3A392F;
          --saffron: #D9A64B;
          --clay: #C97558;
          --field-bg: #2F342B;
        }
        .wc-admin.wc-dark .wc-nav-item.active { background: rgba(240,236,225,0.14); color: var(--cream); }
        .wc-admin.wc-dark .wc-auth-panel { background: rgba(38,43,36,0.65); border-color: rgba(255,255,255,0.08); }
        .wc-admin.wc-dark .wc-auth-input-wrap { background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.14); }
        .wc-admin.wc-dark .wc-auth-badge { background: var(--sage-light); }
        .wc-admin.wc-dark .wc-auth-switch button { color: var(--sage-light); }
        .wc-admin.wc-reduce-motion *,
        .wc-admin.wc-reduce-motion *::before,
        .wc-admin.wc-reduce-motion *::after {
          transition: none !important;
          animation: none !important;
        }
        .wc-admin * { box-sizing: border-box; }
        .wc-admin h1, .wc-admin h2, .wc-admin .wc-serif {
          font-family: 'Playfair Display', Georgia, serif;
        }
        .wc-admin button { font-family: inherit; cursor: pointer; }
        .wc-admin input, .wc-admin select, .wc-admin textarea {
          font-family: inherit;
          font-size: 14px;
        }
        .wc-sidebar {
          width: 220px;
          flex-shrink: 0;
          background: var(--sage-deep);
          color: var(--cream);
          display: flex;
          flex-direction: column;
          padding: 24px 16px;
          min-height: 100vh;
        }
        .wc-brand {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 0 8px 28px 8px;
        }
        .wc-brand-badge {
          width: 34px; height: 34px;
          border-radius: 50%;
          background: var(--sage-light);
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0;
        }
        .wc-brand-name {
          font-size: 17px;
          letter-spacing: 0.02em;
        }
        .wc-brand-sub {
          font-size: 10.5px;
          color: var(--sage-light);
          letter-spacing: 0.08em;
          text-transform: uppercase;
          margin-top: 1px;
        }
        .wc-nav {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .wc-nav-item {
          display: flex;
          align-items: center;
          gap: 11px;
          padding: 10px 12px;
          border-radius: 8px;
          background: transparent;
          border: none;
          color: var(--sage-light);
          font-size: 14px;
          font-weight: 500;
          text-align: left;
          transition: background 0.15s ease, color 0.15s ease;
        }
        .wc-nav-item:hover { background: rgba(250,249,246,0.08); color: var(--cream); }
        .wc-nav-item.active { background: var(--cream); color: var(--sage-deep); font-weight: 600; }
        .wc-sidebar-footer {
          margin-top: auto;
          padding-top: 16px;
          border-top: 1px solid rgba(250,249,246,0.15);
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .wc-profile {
          position: relative;
          margin-bottom: 6px;
        }
        .wc-profile-btn {
          display: flex;
          align-items: center;
          gap: 9px;
          width: 100%;
          background: none;
          border: none;
          padding: 6px 8px;
          border-radius: 8px;
          text-align: left;
        }
        .wc-profile-btn:hover { background: rgba(250,249,246,0.08); }
        .wc-profile-avatar {
          width: 30px; height: 30px;
          flex-shrink: 0;
          border-radius: 50%;
          background: var(--saffron);
          color: white;
          display: flex; align-items: center; justify-content: center;
          font-size: 11.5px;
          font-weight: 700;
          letter-spacing: 0.02em;
        }
        .wc-profile-info {
          display: flex;
          flex-direction: column;
          min-width: 0;
          flex: 1;
        }
        .wc-profile-name {
          font-size: 12.5px;
          font-weight: 600;
          color: var(--cream);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .wc-profile-email {
          font-size: 11px;
          color: var(--sage-light);
          opacity: 0.85;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .wc-profile-chevron { color: var(--sage-light); flex-shrink: 0; transition: transform 0.15s ease; }
        .wc-profile-chevron.open { transform: rotate(180deg); }
        .wc-profile-backdrop { position: fixed; inset: 0; z-index: 59; }
        .wc-profile-dropdown {
          position: absolute;
          bottom: calc(100% + 6px);
          left: 0;
          width: 236px;
          background: var(--cream);
          border-radius: 12px;
          box-shadow: 0 12px 32px rgba(42,47,40,0.25);
          padding: 6px;
          z-index: 60;
          display: flex;
          flex-direction: column;
        }
        .wc-dropdown-item {
          display: flex;
          align-items: center;
          gap: 10px;
          width: 100%;
          background: none;
          border: none;
          padding: 9px 10px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 500;
          color: var(--ink);
          text-align: left;
        }
        .wc-dropdown-item:hover { background: var(--parchment); }
        .wc-dropdown-item.danger { color: var(--clay); }
        .wc-dropdown-item.danger:hover { background: #E9D3CB; }
        .wc-dropdown-divider { height: 1px; background: var(--stone-light); margin: 5px 4px; }
        .wc-dropdown-hint {
          font-size: 11.5px;
          color: var(--stone);
          padding: 6px 10px 4px;
          line-height: 1.4;
        }
        .wc-reset-btn {
          background: none; border: none;
          color: var(--sage-light);
          font-size: 12px;
          padding: 6px 8px;
          text-decoration: underline;
          text-underline-offset: 2px;
        }
        .wc-reset-btn:hover { color: var(--cream); }

        .wc-main {
          flex: 1;
          padding: 32px 40px 60px;
          min-width: 0;
        }
        .wc-topbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 28px;
          gap: 16px;
          flex-wrap: wrap;
        }
        .wc-topbar h1 {
          font-size: 26px;
          font-weight: 700;
          margin: 0;
        }
        .wc-topbar-actions { display: flex; gap: 10px; align-items: center; }
        .wc-search {
          position: relative;
        }
        .wc-search input {
          padding: 9px 12px 9px 34px;
          border-radius: 8px;
          border: 1px solid var(--stone-light);
          background: var(--parchment);
          width: 220px;
          color: var(--ink);
        }
        .wc-search input::placeholder { color: var(--stone); }
        .wc-search svg {
          position: absolute; left: 11px; top: 50%; transform: translateY(-50%);
          color: var(--stone);
        }
        .wc-btn-primary {
          display: flex; align-items: center; gap: 6px;
          background: var(--sage-deep);
          color: var(--cream);
          border: none;
          padding: 9px 16px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
        }
        .wc-btn-primary:hover { background: var(--sage-mid); }

        .wc-metric-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 16px;
          margin-bottom: 24px;
        }
        .wc-metric-card {
          background: var(--parchment);
          border-radius: 12px;
          padding: 18px 20px;
          border: 1px solid var(--stone-light);
        }
        .wc-metric-label {
          font-size: 12px;
          color: var(--stone);
          text-transform: uppercase;
          letter-spacing: 0.06em;
          margin-bottom: 8px;
        }
        .wc-metric-value {
          font-size: 30px;
          font-weight: 700;
          line-height: 1;
        }
        .wc-metric-delta {
          font-size: 12px;
          color: var(--sage-mid);
          margin-top: 8px;
          display: flex; align-items: center; gap: 4px;
        }

        .wc-panels {
          display: grid;
          grid-template-columns: 1.6fr 1fr;
          gap: 20px;
        }
        .wc-panels-secondary { margin-top: 20px; }
        .wc-card {
          background: var(--parchment);
          border-radius: 12px;
          border: 1px solid var(--stone-light);
          padding: 20px 22px;
        }
        .wc-card h2 {
          font-size: 17px;
          font-weight: 700;
          margin: 0 0 16px 0;
        }
        .wc-activity-list { list-style: none; margin: 0; padding: 0; }
        .wc-activity-list li {
          display: flex; gap: 10px;
          padding: 10px 0;
          border-bottom: 1px solid var(--stone-light);
          font-size: 13.5px;
        }
        .wc-activity-list li:last-child { border-bottom: none; }
        .wc-activity-list .wc-leaf-dot { color: var(--sage-mid); flex-shrink: 0; margin-top: 2px; }
        .wc-activity-time { color: var(--stone); font-size: 12px; white-space: nowrap; margin-left: auto; padding-left: 8px; }

        .wc-empty-inline { color: var(--stone); font-size: 13.5px; padding: 8px 0; }
        .wc-toprecipe-list { list-style: none; margin: 0; padding: 0; }
        .wc-toprecipe-list li {
          display: flex; align-items: center; justify-content: space-between; gap: 12px;
          padding: 10px 0;
          border-bottom: 1px solid var(--stone-light);
          font-size: 13.5px;
        }
        .wc-toprecipe-list li:last-child { border-bottom: none; }
        .wc-toprecipe-title { font-weight: 600; color: var(--ink); }
        .wc-toprecipe-saves { color: var(--stone); font-size: 12.5px; white-space: nowrap; flex-shrink: 0; }
        .wc-donut-wrap { margin: 0 -8px; }
        .wc-donut-legend {
          display: flex; flex-wrap: wrap; gap: 8px 16px;
          justify-content: center;
          margin-top: 4px;
          font-size: 12.5px; color: var(--ink);
        }
        .wc-donut-legend-item { display: flex; align-items: center; gap: 6px; }
        .wc-donut-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }

        .wc-table-wrap {
          background: var(--parchment);
          border-radius: 12px;
          border: 1px solid var(--stone-light);
          overflow: hidden;
        }
        table.wc-table { width: 100%; border-collapse: collapse; }
        .wc-table th {
          text-align: left;
          font-size: 11.5px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--stone);
          padding: 12px 18px;
          border-bottom: 1px solid var(--stone-light);
          font-weight: 600;
        }
        .wc-table td {
          padding: 13px 18px;
          border-bottom: 1px solid var(--stone-light);
          font-size: 14px;
        }
        .wc-table tr:last-child td { border-bottom: none; }
        .wc-table tr:hover td { background: rgba(74,93,78,0.04); }
        .wc-pill {
          display: inline-block;
          padding: 3px 10px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 600;
        }
        .wc-pill.easy, .wc-pill.active { background: var(--sage-light); color: var(--sage-deep); }
        .wc-pill.medium { background: #EFE0B8; color: #8A6A16; }
        .wc-pill.hard, .wc-pill.inactive { background: #E9D3CB; color: var(--clay); }
        .wc-tag {
          display: inline-block;
          padding: 2px 8px;
          border-radius: 999px;
          font-size: 11px;
          background: var(--sage-light);
          color: var(--sage-deep);
          margin: 2px 4px 2px 0;
        }
        .wc-row-actions { display: flex; gap: 6px; justify-content: flex-end; }
        .wc-icon-btn {
          background: none; border: none;
          padding: 6px;
          border-radius: 6px;
          color: var(--stone);
          display: flex;
        }
        .wc-icon-btn:hover { background: var(--sage-light); color: var(--sage-deep); }
        .wc-icon-btn.danger:hover { background: #E9D3CB; color: var(--clay); }
        .wc-confirm-row { display: flex; gap: 8px; align-items: center; justify-content: flex-end; font-size: 12.5px; }
        .wc-confirm-row button {
          border: none; border-radius: 6px; padding: 5px 10px; font-size: 12px; font-weight: 600;
        }
        .wc-confirm-yes { background: var(--clay); color: white; }
        .wc-confirm-no { background: var(--stone-light); color: var(--ink); }

        .wc-empty {
          padding: 48px 20px;
          text-align: center;
          color: var(--stone);
        }
        .wc-empty svg { margin-bottom: 10px; color: var(--sage-mid); }

        .wc-modal-overlay {
          position: fixed; inset: 0;
          background: rgba(42,47,40,0.45);
          display: flex; align-items: center; justify-content: center;
          z-index: 50;
          padding: 20px;
        }
        .wc-modal {
          background: var(--cream);
          border-radius: 14px;
          width: 100%;
          max-width: 440px;
          padding: 26px 26px 22px;
          max-height: 88vh;
          overflow-y: auto;
        }
        .wc-modal-sm { max-width: 380px; }
        .wc-delete-desc { font-size: 13.5px; color: var(--stone); line-height: 1.5; margin: 10px 0 22px; }
        .wc-modal-header {
          display: flex; align-items: center; justify-content: space-between;
          margin-bottom: 18px;
        }
        .wc-modal-header h2 { font-size: 19px; margin: 0; }
        .wc-modal-close { background: none; border: none; color: var(--stone); padding: 4px; }
        .wc-field { margin-bottom: 14px; }
        .wc-field label {
          display: block; font-size: 12.5px; font-weight: 600;
          color: var(--sage-deep); margin-bottom: 5px;
        }
        .wc-field input, .wc-field select {
          width: 100%;
          padding: 9px 11px;
          border-radius: 8px;
          border: 1px solid var(--stone-light);
          background: var(--field-bg);
          color: var(--ink);
        }
        .wc-field-row { display: flex; gap: 12px; }
        .wc-field-row .wc-field { flex: 1; }
        .wc-chip-group { display: flex; flex-wrap: wrap; gap: 6px; }
        .wc-chip {
          border: 1px solid var(--stone-light);
          background: var(--field-bg);
          padding: 5px 11px;
          border-radius: 999px;
          font-size: 12.5px;
          color: var(--stone);
        }
        .wc-chip.selected {
          background: var(--sage-deep);
          color: var(--cream);
          border-color: var(--sage-deep);
        }
        .wc-status-toggle { display: flex; gap: 8px; }
        .wc-status-toggle button {
          flex: 1;
          padding: 9px;
          border-radius: 8px;
          border: 1px solid var(--stone-light);
          background: var(--field-bg);
          color: var(--stone);
          font-size: 13px;
          font-weight: 600;
        }
        .wc-status-toggle button.selected.active-opt { background: var(--sage-light); color: var(--sage-deep); border-color: var(--sage-light); }
        .wc-status-toggle button.selected.inactive-opt { background: #E9D3CB; color: var(--clay); border-color: #E9D3CB; }
        .wc-modal-actions {
          display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px;
        }
        .wc-btn-secondary {
          background: none; border: 1px solid var(--stone-light);
          padding: 9px 16px; border-radius: 8px; font-size: 14px; color: var(--ink);
        }
        .wc-btn-danger {
          display: flex; align-items: center; gap: 6px;
          background: var(--clay); color: white; border: none;
          padding: 9px 16px; border-radius: 8px; font-size: 14px; font-weight: 600;
        }
        .wc-btn-danger:hover { opacity: 0.9; }

        .wc-settings-divider { height: 1px; background: var(--stone-light); margin: 22px 0 16px; }
        .wc-settings-subhead { font-size: 15px; font-weight: 700; margin: 0 0 12px; }
        .wc-settings-success {
          display: flex; align-items: center; gap: 6px;
          color: var(--sage-deep); font-size: 12.5px; margin-bottom: 12px; font-weight: 600;
        }

        .wc-help-list { display: flex; flex-direction: column; gap: 16px; margin-bottom: 4px; }
        .wc-help-q { font-size: 13.5px; font-weight: 700; color: var(--sage-deep); margin-bottom: 4px; }
        .wc-help-a { font-size: 13px; color: var(--ink); opacity: 0.85; line-height: 1.5; }

        .wc-textarea {
          width: 100%;
          padding: 9px 11px;
          border-radius: 8px;
          border: 1px solid var(--stone-light);
          background: var(--field-bg);
          color: var(--ink);
          font-family: inherit;
          font-size: 14px;
          resize: vertical;
        }

        .wc-display-row {
          display: flex; align-items: center; justify-content: space-between; gap: 16px;
          padding: 14px 0; border-bottom: 1px solid var(--stone-light);
        }
        .wc-display-row:last-of-type { border-bottom: none; }
        .wc-display-label { font-size: 14px; font-weight: 600; color: var(--ink); }
        .wc-display-sub { font-size: 12.5px; color: var(--stone); margin-top: 2px; }
        .wc-toggle {
          width: 42px; height: 24px; border-radius: 999px;
          background: var(--stone-light); border: none; position: relative; flex-shrink: 0; padding: 0;
        }
        .wc-toggle.on { background: var(--sage-deep); }
        .wc-toggle-knob {
          position: absolute; top: 2px; left: 2px;
          width: 20px; height: 20px; border-radius: 50%; background: white;
          transition: transform 0.15s ease;
          box-shadow: 0 1px 3px rgba(0,0,0,0.25);
        }
        .wc-toggle.on .wc-toggle-knob { transform: translateX(18px); }

        .wc-loading {
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          min-height: 100vh; width: 100%; color: var(--stone); gap: 10px;
        }

        .wc-auth-wrap {
          position: relative;
          width: 100%;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          padding: 24px;
        }
        .wc-auth-bg {
          position: absolute; inset: 0;
          background: url('/hero-vegetables.png') center/cover no-repeat;
        }
        .wc-auth-bg::after {
          content: '';
          position: absolute; inset: 0;
          background: linear-gradient(160deg, rgba(20,23,15,0.35) 0%, rgba(15,17,11,0.6) 100%);
        }
        .wc-auth-tagline {
          position: absolute;
          left: 40px; bottom: 32px;
          z-index: 1;
          max-width: 380px;
        }
        .wc-auth-visual-title { font-size: 27px; font-weight: 700; color: #FAF9F6; margin-bottom: 8px; }
        .wc-auth-visual-sub { font-size: 13.5px; color: rgba(250,249,246,0.82); line-height: 1.5; }
        .wc-auth-panel {
          position: relative;
          z-index: 1;
          width: 100%;
          max-width: 380px;
          background: rgba(192, 213, 194, 0.42);
          backdrop-filter: blur(18px);
          -webkit-backdrop-filter: blur(18px);
          border: 1px solid rgba(255,255,255,0.5);
          border-radius: 20px;
          padding: 34px 30px 28px;
          box-shadow: 0 20px 50px rgba(42,47,40,0.14);
        }
        .wc-auth-badge {
          width: 42px; height: 42px;
          border-radius: 50%;
          background: var(--cream);
          display: flex; align-items: center; justify-content: center;
          margin-bottom: 16px;
        }
        .wc-auth-title { font-size: 24px; font-weight: 700; margin-bottom: 4px; }
        .wc-auth-sub { font-size: 13.5px; color: var(--ink); opacity: 0.75; margin-bottom: 22px; line-height: 1.4; }
        .wc-auth-field { margin-bottom: 14px; }
        .wc-auth-field label {
          display: block; font-size: 12px; font-weight: 600; color: var(--sage-deep); margin-bottom: 5px;
        }
        .wc-auth-input-wrap {
          display: flex; align-items: center; gap: 8px;
          background: rgba(255,255,255,0.75);
          border: 1px solid rgba(74,93,78,0.25);
          border-radius: 9px;
          padding: 0 11px;
        }
        .wc-auth-input-wrap svg:first-child { color: var(--sage-deep); flex-shrink: 0; }
        .wc-auth-input-wrap input {
          border: none; background: transparent; outline: none;
          padding: 10px 0; flex: 1; color: var(--ink); font-size: 14px;
        }
        .wc-auth-eye { background: none; border: none; color: var(--stone); display: flex; padding: 4px; }
        .wc-auth-error {
          display: flex; align-items: center; gap: 6px;
          color: var(--clay); font-size: 12.5px; margin-bottom: 12px;
        }
        .wc-auth-submit { width: 100%; justify-content: center; margin-top: 6px; }
        .wc-auth-submit:disabled { opacity: 0.7; cursor: default; }
        .wc-pw-checklist {
          list-style: none; margin: -4px 0 14px; padding: 0;
          display: flex; flex-direction: column; gap: 4px;
        }
        .wc-pw-checklist li {
          display: flex; align-items: center; gap: 7px;
          font-size: 12px; color: var(--ink); opacity: 0.65;
        }
        .wc-pw-checklist li.ok { color: var(--sage-deep); opacity: 1; font-weight: 600; }
        .wc-pw-checklist li svg { flex-shrink: 0; color: var(--sage-deep); }
        .wc-pw-dot {
          width: 13px; height: 13px; flex-shrink: 0;
          border-radius: 50%; border: 1.5px solid var(--stone);
        }
        .wc-auth-switch {
          text-align: center; font-size: 13px; color: var(--ink); opacity: 0.8;
          margin-top: 18px;
        }
        .wc-auth-note {
          font-size: 11.5px; color: var(--stone); text-align: center;
          margin-top: 10px; line-height: 1.4;
        }
        .wc-auth-switch button {
          background: none; border: none; padding: 0;
          color: var(--sage-deep); font-weight: 700; font-size: 13px;
          text-decoration: underline; text-underline-offset: 2px;
        }
        .wc-auth-footnote { text-align: center; font-size: 11.5px; color: var(--stone); margin-top: 16px; }

        @media (max-width: 640px) {
          .wc-auth-tagline { display: none; }
        }

        @media (max-width: 760px) {
          .wc-admin { flex-direction: column; }
          .wc-sidebar { width: 100%; min-height: auto; flex-direction: row; align-items: center; padding: 12px 16px; flex-wrap: wrap; }
          .wc-brand { padding: 0 12px 0 0; }
          .wc-nav { flex-direction: row; }
          .wc-sidebar-footer { flex-direction: row; align-items: center; width: 100%; margin-top: 8px; border-top: none; padding-top: 0; gap: 10px; flex-wrap: wrap; }
          .wc-profile { width: auto; }
          .wc-profile-info { display: none; }
          .wc-main { padding: 22px 18px 40px; }
          .wc-metric-grid { grid-template-columns: 1fr 1fr; }
          .wc-panels { grid-template-columns: 1fr; }
          .wc-table-wrap { overflow-x: auto; }
        }
      `}</style>

      <StaffPortalScreenStyles />

      {resetToken ? (
        <ResetPasswordScreen token={resetToken} onClearToken={removeResetTokenFromUrl} onDone={clearResetLink} />
      ) : backend.status === 'checking' || (backend.status === 'authenticated' && ['idle', 'loading'].includes(staffState.status)) ? (
        <div className="wc-loading">
          <Leaf size={26} />
          <span>Loading Staff Portal…</span>
        </div>
      ) : backend.status !== 'authenticated' ? (
        <StaffPortalAuthScreen
          onRegisterAndApply={registerAndApply}
          onSignIn={signIn}
          onForgotPassword={forgotStaffPassword}
          notice={authNotice}
        />
      ) : staffState.status === 'error' ? (
        <StaffBootstrapError message={staffState.error} onRetry={refreshStaffState} onSignOut={signOut} />
      ) : portalDestination === 'consumer' ? (
        <ConsumerScreen user={backend.user} notice={applicationNotice} onApply={submitModeratorApplication} onSignOut={signOut} />
      ) : portalDestination === 'verify-email' ? (
        <VerifyEmailState user={backend.user} onResend={resendModeratorVerification} onRefresh={() => refreshStaffState({ showLoading: false })} onSignOut={signOut} />
      ) : portalDestination === 'pending' ? (
        <PendingState onRefresh={() => refreshStaffState({ showLoading: false })} onSignOut={signOut} />
      ) : portalDestination === 'rejected' ? (
        <RejectedState reason={staffState.data?.application?.rejectionReason} onApplyAgain={submitModeratorApplication} onSignOut={signOut} />
      ) : portalDestination === 'moderator' ? (
        <ModeratorWorkspace
          tab={tab}
          setTab={setTab}
          identity={identity}
          catalogPolicy={catalogPolicy}
          onSignOut={signOut}
          onAuthorityLost={refreshAuthority}
        />
      ) : portalDestination !== 'admin' ? (
        <StaffBootstrapError message="The Staff Portal returned an unsupported access state." onRetry={() => refreshStaffState()} onSignOut={signOut} />
      ) : (
        <>
          <aside className="wc-sidebar wc-staff-sidebar">
            <div className="wc-brand">
              <div className="wc-brand-badge">
                <Leaf size={18} color="#4A5D4E" />
              </div>
              <div>
                <div className="wc-brand-name">WeCooked</div>
                <div className="wc-brand-sub">Staff Portal</div>
                <div className="wc-role-label">Admin</div>
              </div>
            </div>
            <nav className="wc-nav" aria-label="Admin workspace">
              <button
                className={`wc-nav-item ${tab === 'overview' ? 'active' : ''}`}
                onClick={() => setTab('overview')}
                aria-current={tab === 'overview' ? 'page' : undefined}
              >
                <LayoutDashboard size={17} /> Overview
              </button>
              <button
                className={`wc-nav-item ${tab === 'recipes' ? 'active' : ''}`}
                onClick={() => setTab('recipes')}
                aria-current={tab === 'recipes' ? 'page' : undefined}
              >
                <ChefHat size={17} /> Recipes
              </button>
              <button
                className={`wc-nav-item ${tab === 'ingredients' ? 'active' : ''}`}
                onClick={() => setTab('ingredients')}
                aria-current={tab === 'ingredients' ? 'page' : undefined}
              >
                <Carrot size={17} /> Ingredients
              </button>
              <button
                className={`wc-nav-item ${tab === 'substitutions' ? 'active' : ''}`}
                onClick={() => setTab('substitutions')}
                aria-current={tab === 'substitutions' ? 'page' : undefined}
              >
                <Replace size={17} /> Substitutions
              </button>
              <button
                className={`wc-nav-item ${tab === 'users' ? 'active' : ''}`}
                onClick={() => setTab('users')}
                aria-current={tab === 'users' ? 'page' : undefined}
              >
                <Users size={17} /> Users
              </button>
              <button
                className={`wc-nav-item ${tab === 'staff' ? 'active' : ''}`}
                onClick={() => setTab('staff')}
                aria-current={tab === 'staff' ? 'page' : undefined}
              >
                <UserCog size={17} /> Staff Management
              </button>
            </nav>
            <div className="wc-sidebar-footer">
              <ProfileMenu
                account={identity}
                open={profileMenuOpen}
                onToggle={() => setProfileMenuOpen((o) => !o)}
                onClose={() => setProfileMenuOpen(false)}
                onSignOut={() => { setConfirmLogout(true); setProfileMenuOpen(false); }}
                onOpenSettings={() => { setSettingsOpen(true); setProfileMenuOpen(false); }}
                onOpenHelp={() => { setHelpOpen(true); setProfileMenuOpen(false); }}
                onOpenDisplay={() => { setDisplayOpen(true); setProfileMenuOpen(false); }}
              />
              {firebaseAccountAvailable && (
                <button className="wc-reset-btn" onClick={() => setConfirmDeleteAccount(true)}>
                  Delete admin account
                </button>
              )}
            </div>
          </aside>

          <main className="wc-main wc-staff-main">
            {tab === 'overview' && (
              <OverviewTab
                metrics={metrics}
                latestRecipes={recipeStats.latest}
                recipeStatus={recipeStats.status}
                userStatus={userCounts.status}
                onNavigate={setTab}
              />
            )}

            {tab === 'recipes' && (
              <RecipesTab
                canWrite={catalogPolicy.canWriteCatalog}
                canUploadRecipeImage={catalogPolicy.canUploadRecipeImage}
                onAuthorityLost={refreshAuthority}
              />
            )}

            {tab === 'ingredients' && (
              <IngredientsTab
                canWrite={catalogPolicy.canWriteCatalog}
                onAuthorityLost={refreshAuthority}
              />
            )}

            {tab === 'substitutions' && (
              <SubstitutionsTab
                canWrite={catalogPolicy.canWriteCatalog}
                onAuthorityLost={refreshAuthority}
              />
            )}

            {tab === 'users' && (
              <UsersTab
                currentUserId={backend.user?.id}
                onAuthorityLost={refreshAuthority}
              />
            )}

            {tab === 'staff' && <StaffManagementTab onAuthorityLost={refreshAuthority} />}
          </main>

          {settingsOpen && (
            <SettingsModal
              account={identity}
              onClose={() => setSettingsOpen(false)}
              onUpdateProfile={updateProfile}
              onChangePassword={changePassword}
              onRequestEmailChange={requestEmailChange}
              firebaseAccountAvailable={firebaseAccountAvailable}
            />
          )}
          {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
          {displayOpen && (
            <DisplayModal
              prefs={displayPrefs}
              onChange={updateDisplayPrefs}
              onClose={() => setDisplayOpen(false)}
            />
          )}
          {confirmDeleteAccount && (
            <DeleteAccountModal
              onCancel={() => setConfirmDeleteAccount(false)}
              onConfirm={deleteAccount}
            />
          )}
          {confirmLogout && (
            <LogoutConfirmModal
              onCancel={() => setConfirmLogout(false)}
              onConfirm={() => { setConfirmLogout(false); signOut(); }}
            />
          )}
        </>
      )}
    </div>
  );
}

export function ModeratorWorkspace({
  tab,
  setTab,
  identity,
  catalogPolicy,
  onSignOut,
  onAuthorityLost,
}) {
  const areas = [
    { id: 'recipes', label: 'Recipes', description: 'Author, review, and publish recipes for the shared catalog.', icon: ChefHat },
    { id: 'ingredients', label: 'Ingredients', description: 'Maintain ingredient records and catalog consistency.', icon: Carrot },
    { id: 'substitutions', label: 'Substitutions', description: 'Maintain approved ingredient substitutions.', icon: Replace },
  ];

  return (
    <>
      <aside className="wc-sidebar wc-staff-sidebar">
        <div className="wc-brand">
          <div className="wc-brand-badge"><Leaf size={18} color="#4A5D4E" /></div>
          <div>
            <div className="wc-brand-name">WeCooked</div>
            <div className="wc-brand-sub">Staff Portal</div>
            <div className="wc-role-label">Moderator</div>
          </div>
        </div>
        <nav className="wc-nav" aria-label="Moderator workspace">
          <button className={`wc-nav-item ${tab === 'moderator-home' ? 'active' : ''}`} onClick={() => setTab('moderator-home')} aria-current={tab === 'moderator-home' ? 'page' : undefined}><LayoutDashboard size={17} /> Overview</button>
          {areas.map(({ id, label, icon: Icon }) => (
            <button key={id} className={`wc-nav-item ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)} aria-current={tab === id ? 'page' : undefined}><Icon size={17} /> {label}</button>
          ))}
        </nav>
        <div className="wc-sidebar-footer">
          <div className="wc-staff-identity">
            <span className="wc-profile-avatar" aria-hidden="true">{initials(identity?.name, identity?.email)}</span>
            <span className="wc-profile-info">
              <span className="wc-profile-name">{identity?.name || 'Moderator'}</span>
              <span className="wc-profile-email">{identity?.email}</span>
            </span>
          </div>
          <button className="wc-nav-item wc-signout-item" onClick={onSignOut}><LogOut size={17} /> Sign Out</button>
        </div>
      </aside>
      <main className="wc-main wc-staff-main">
        {tab === 'recipes' && (
          <RecipesTab
            canWrite={catalogPolicy.canWriteCatalog}
            canUploadRecipeImage={catalogPolicy.canUploadRecipeImage}
            onAuthorityLost={onAuthorityLost}
          />
        )}
        {tab === 'ingredients' && (
          <IngredientsTab
            canWrite={catalogPolicy.canWriteCatalog}
            onAuthorityLost={onAuthorityLost}
          />
        )}
        {tab === 'substitutions' && (
          <SubstitutionsTab
            canWrite={catalogPolicy.canWriteCatalog}
            onAuthorityLost={onAuthorityLost}
          />
        )}
        {tab === 'moderator-home' && (
          <div className="wc-dashboard wc-moderator-dashboard">
            <header className="wc-dashboard-header">
              <div>
                <div className="wc-dashboard-eyebrow"><ShieldCheck size={15} /> Catalog operations</div>
                <h1>Moderator Workspace</h1>
                <p>Manage the recipe, ingredient, and substitution records that power the shared catalog.</p>
              </div>
            </header>
            <section className="wc-dashboard-section" aria-labelledby="moderator-work-areas">
              <div className="wc-dashboard-section-heading">
                <div>
                  <p className="wc-dashboard-section-label">Work areas</p>
                  <h2 id="moderator-work-areas">Catalog management</h2>
                </div>
                <p>Choose an area to continue.</p>
              </div>
              <div className="wc-moderator-areas">
                {areas.map(({ id, label, description, icon: Icon }) => (
                  <button
                    type="button"
                    className="wc-moderator-area"
                    key={id}
                    onClick={() => setTab(id)}
                  >
                    <span className="wc-moderator-area-icon"><Icon size={20} /></span>
                    <span className="wc-moderator-area-copy"><strong>{label}</strong><span>{description}</span></span>
                    <ArrowRight size={18} aria-hidden="true" />
                  </button>
                ))}
              </div>
            </section>
          </div>
        )}
      </main>
    </>
  );
}

function initials(name, email) {
  const source = (name || '').trim();
  if (source) {
    const parts = source.split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return (email || '?').trim().slice(0, 2).toUpperCase();
}

export function ProfileMenu({
  account, open, onToggle, onClose, onSignOut,
  onOpenSettings, onOpenHelp, onOpenDisplay,
}) {
  if (!account) return null;

  return (
    <div className="wc-profile">
      <button
        className="wc-profile-btn"
        onClick={onToggle}
        aria-label={open ? 'Close account menu' : 'Open account menu'}
        aria-expanded={open}
        aria-controls={open ? 'wc-account-menu' : undefined}
      >
        <span className="wc-profile-avatar">{initials(account.name, account.email)}</span>
        <span className="wc-profile-info">
          <span className="wc-profile-name">{account.name || 'Admin'}</span>
          <span className="wc-profile-email">{account.email}</span>
        </span>
        <ChevronDown size={15} className={`wc-profile-chevron ${open ? 'open' : ''}`} />
      </button>

      {open && (
        <>
          <div className="wc-profile-backdrop" onClick={onClose} />
          <div className="wc-profile-dropdown" id="wc-account-menu">
            <button className="wc-dropdown-item" onClick={onOpenSettings}>
              <Settings size={15} /> Settings &amp; privacy
            </button>
            <button className="wc-dropdown-item" onClick={onOpenHelp}>
              <HelpCircle size={15} /> Help &amp; support
            </button>
            <button className="wc-dropdown-item" onClick={onOpenDisplay}>
              <Accessibility size={15} /> Display &amp; accessibility
            </button>
            <div className="wc-dropdown-divider" />
            <button className="wc-dropdown-item danger" onClick={onSignOut}>
              <LogOut size={15} /> Log out
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function SettingsModal({
  account,
  onClose,
  onUpdateProfile,
  onChangePassword,
  onRequestEmailChange,
  firebaseAccountAvailable,
}) {
  const [name, setName] = useState(account.name || '');
  const [email, setEmail] = useState(account.email || '');
  const [profileFieldErrors, setProfileFieldErrors] = useState({});
  const [profileError, setProfileError] = useState('');
  const [profileSaved, setProfileSaved] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [emailRequested, setEmailRequested] = useState(false);
  const [requestingEmail, setRequestingEmail] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [passwordFieldErrors, setPasswordFieldErrors] = useState({});
  const [passwordError, setPasswordError] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  async function submitProfile(e) {
    e.preventDefault();
    const fieldErrors = { name: validateStaffName(name) };
    setProfileFieldErrors(fieldErrors);
    setProfileError('');
    setProfileSaved(false);
    if (hasStaffAuthErrors(fieldErrors)) return;
    setSavingProfile(true);
    try {
      await onUpdateProfile({ name });
      setName(name.trim());
      setProfileSaved(true);
    } catch (err) {
      const apiFieldErrors = staffFieldErrors(err, ['name']);
      setProfileFieldErrors(apiFieldErrors);
      if (!hasStaffAuthErrors(apiFieldErrors)) {
        setProfileError(staffErrorMessage(err, 'Unable to update your name.'));
      }
    } finally {
      setSavingProfile(false);
    }
  }

  async function submitEmailChange(e) {
    e.preventDefault();
    setEmailError('');
    setEmailRequested(false);
    if (!email.trim()) {
      setEmailError('Email is required.');
      return;
    }
    if (email.trim().toLowerCase() === (account.email || '').toLowerCase()) {
      setEmailError('Enter a different email address.');
      return;
    }
    setRequestingEmail(true);
    try {
      await onRequestEmailChange(email);
      setEmailRequested(true);
    } catch (err) {
      setEmailError(err && err.message ? err.message : String(err));
    } finally {
      setRequestingEmail(false);
    }
  }

  async function submitPassword(e) {
    e.preventDefault();
    const fieldErrors = {
      currentPassword: validateCurrentPassword(currentPassword),
      newPassword: passwordRequirementState(newPassword).errors,
      confirmNewPassword: newPassword === confirmNewPassword ? [] : ['New passwords don’t match.'],
    };
    setPasswordFieldErrors(fieldErrors);
    setPasswordError('');
    if (hasStaffAuthErrors(fieldErrors)) return;
    setSavingPassword(true);
    try {
      await onChangePassword({ currentPassword, newPassword });
    } catch (err) {
      const apiFieldErrors = staffFieldErrors(err, ['currentPassword', 'newPassword']);
      setPasswordFieldErrors(apiFieldErrors);
      if (!hasStaffAuthErrors(apiFieldErrors)) {
        setPasswordError(staffErrorMessage(err, 'Unable to update your password.'));
      }
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <div className="wc-modal-overlay" onClick={onClose}>
      <div className="wc-modal" onClick={(e) => e.stopPropagation()}>
        <div className="wc-modal-header">
          <h2 className="wc-serif">Settings &amp; privacy</h2>
          <button className="wc-modal-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <form onSubmit={submitProfile}>
          <div className="wc-field">
            <label>Name</label>
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setProfileFieldErrors({});
              }}
              required
              aria-invalid={Boolean(profileFieldErrors.name?.length)}
              aria-describedby={profileFieldErrors.name?.length ? 'settings-name-error' : undefined}
            />
          </div>
          <FieldErrors id="settings-name-error" messages={profileFieldErrors.name} />
          {profileError && (
            <div className="wc-auth-error"><AlertCircle size={14} /> {profileError}</div>
          )}
          {profileSaved && (
            <div className="wc-settings-success"><Check size={14} /> Name updated.</div>
          )}
          <div className="wc-modal-actions">
            <button type="submit" className="wc-btn-primary" disabled={savingProfile}>
              {savingProfile ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>

        <div className="wc-settings-divider" />

        <h3 className="wc-settings-subhead">Change email</h3>
        <p className="wc-auth-note" style={{ textAlign: 'left' }}>
          Email changes remain on the legacy account service until SP2B. Your displayed and sign-in email remains the WeCooked backend email.
        </p>
        <form onSubmit={submitEmailChange}>
          <div className="wc-field">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setEmailError(''); setEmailRequested(false); }}
              required
              disabled={!firebaseAccountAvailable}
            />
          </div>
          {!firebaseAccountAvailable && (
            <div className="wc-auth-note">Legacy email change is unavailable for this backend-only account.</div>
          )}
          {emailError && <div className="wc-auth-error"><AlertCircle size={14} /> {emailError}</div>}
          {emailRequested && (
            <div className="wc-settings-success"><Check size={14} /> Check the new inbox to confirm the legacy email change.</div>
          )}
          <div className="wc-modal-actions">
            <button type="submit" className="wc-btn-secondary" disabled={requestingEmail || !firebaseAccountAvailable}>
              {requestingEmail ? 'Sending…' : 'Request email change'}
            </button>
          </div>
        </form>

        <div className="wc-settings-divider" />

        <h3 className="wc-settings-subhead">Change password</h3>
        <form onSubmit={submitPassword}>
          <div className="wc-field">
            <label>Current password</label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => { setCurrentPassword(e.target.value); setPasswordFieldErrors({}); }}
              autoComplete="current-password"
              required
              aria-invalid={Boolean(passwordFieldErrors.currentPassword?.length)}
              aria-describedby={passwordFieldErrors.currentPassword?.length ? 'settings-current-password-error' : undefined}
            />
          </div>
          <FieldErrors id="settings-current-password-error" messages={passwordFieldErrors.currentPassword} />
          <div className="wc-field">
            <label>New password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => { setNewPassword(e.target.value); setPasswordFieldErrors({}); }}
              autoComplete="new-password"
              required
              aria-invalid={Boolean(passwordFieldErrors.newPassword?.length)}
              aria-describedby="staff-password-requirements settings-new-password-error"
            />
          </div>
          <FieldErrors id="settings-new-password-error" messages={passwordFieldErrors.newPassword} />
          <PasswordRequirements password={newPassword} />
          <div className="wc-field">
            <label>Confirm new password</label>
            <input
              type="password"
              value={confirmNewPassword}
              onChange={(e) => { setConfirmNewPassword(e.target.value); setPasswordFieldErrors({}); }}
              autoComplete="new-password"
              required
              aria-invalid={Boolean(passwordFieldErrors.confirmNewPassword?.length)}
              aria-describedby={passwordFieldErrors.confirmNewPassword?.length ? 'settings-confirm-password-error' : undefined}
            />
          </div>
          <FieldErrors id="settings-confirm-password-error" messages={passwordFieldErrors.confirmNewPassword} />
          {passwordError && (
            <div className="wc-auth-error"><AlertCircle size={14} /> {passwordError}</div>
          )}
          <div className="wc-modal-actions">
            <button type="submit" className="wc-btn-primary" disabled={savingPassword}>
              {savingPassword ? 'Updating…' : 'Update password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const HELP_FAQS = [
  {
    q: 'Where is my data stored?',
    a: 'Ingredients, substitutions, recipes, users, and staff applications live in the WeCooked backend (REST API + MongoDB). Firebase remains only for the legacy email-change/account-delete surfaces and their best-effort sign-in mirror; it does not determine Staff Portal access or displayed identity.',
  },
  {
    q: 'How do I add another admin?',
    a: 'There is no public Admin signup or in-app Admin promotion. Admin provisioning remains an out-of-band operational process. The public Staff Portal application creates only a normal user account and a Moderator application.',
  },
  {
    q: 'I lost my password — now what?',
    a: 'Click “Forgot password?” on the sign-in screen and follow the reset link sent to your email.',
  },
];

function HelpModal({ onClose }) {
  return (
    <div className="wc-modal-overlay" onClick={onClose}>
      <div className="wc-modal" onClick={(e) => e.stopPropagation()}>
        <div className="wc-modal-header">
          <h2 className="wc-serif">Help &amp; support</h2>
          <button className="wc-modal-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="wc-help-list">
          {HELP_FAQS.map((item) => (
            <div className="wc-help-item" key={item.q}>
              <div className="wc-help-q">{item.q}</div>
              <div className="wc-help-a">{item.a}</div>
            </div>
          ))}
        </div>
        <div className="wc-modal-actions">
          <button type="button" className="wc-btn-primary" onClick={onClose}>Got it</button>
        </div>
      </div>
    </div>
  );
}

function DisplayModal({ prefs, onChange, onClose }) {
  return (
    <div className="wc-modal-overlay" onClick={onClose}>
      <div className="wc-modal" onClick={(e) => e.stopPropagation()}>
        <div className="wc-modal-header">
          <h2 className="wc-serif">Display &amp; accessibility</h2>
          <button className="wc-modal-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <div className="wc-display-row">
          <div>
            <div className="wc-display-label">Dark mode</div>
            <div className="wc-display-sub">Switch the dashboard to a low-light color scheme.</div>
          </div>
          <button
            type="button"
            className={`wc-toggle ${prefs.theme === 'dark' ? 'on' : ''}`}
            role="switch"
            aria-checked={prefs.theme === 'dark'}
            onClick={() => onChange({ theme: prefs.theme === 'dark' ? 'light' : 'dark' })}
          >
            <span className="wc-toggle-knob" />
          </button>
        </div>

        <div className="wc-display-row">
          <div>
            <div className="wc-display-label">Reduce motion</div>
            <div className="wc-display-sub">Turn off hover and transition animations.</div>
          </div>
          <button
            type="button"
            className={`wc-toggle ${prefs.reduceMotion ? 'on' : ''}`}
            role="switch"
            aria-checked={prefs.reduceMotion}
            onClick={() => onChange({ reduceMotion: !prefs.reduceMotion })}
          >
            <span className="wc-toggle-knob" />
          </button>
        </div>

        <div className="wc-modal-actions">
          <button type="button" className="wc-btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

function DeleteAccountModal({ onCancel, onConfirm }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleConfirm() {
    if (!password) {
      setError('Enter your password to confirm.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await onConfirm(password);
    } catch (err) {
      setError(err && err.message ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <div className="wc-modal-overlay" onClick={onCancel}>
      <div className="wc-modal wc-modal-sm" onClick={(e) => e.stopPropagation()}>
        <h2 className="wc-serif">Delete admin account?</h2>
        <p className="wc-delete-desc">
          This removes your admin access permanently. Recipes and user data stay intact, but this can’t be undone.
        </p>
        <div className="wc-auth-input-wrap">
          <Lock size={15} />
          <input
            type="password"
            placeholder="Confirm your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
        </div>
        {error && <div className="wc-auth-error"><AlertCircle size={14} /> {error}</div>}
        <div className="wc-modal-actions">
          <button type="button" className="wc-btn-secondary" onClick={onCancel}>Cancel</button>
          <button type="button" className="wc-btn-danger" onClick={handleConfirm} disabled={submitting}>
            {submitting ? 'Deleting…' : 'Delete account'}
          </button>
        </div>
      </div>
    </div>
  );
}

function LogoutConfirmModal({ onCancel, onConfirm }) {
  return (
    <div className="wc-modal-overlay" onClick={onCancel}>
      <div className="wc-modal wc-modal-sm" onClick={(e) => e.stopPropagation()}>
        <h2 className="wc-serif">Log out?</h2>
        <p className="wc-delete-desc">
          You’ll need to sign in again to get back into the dashboard.
        </p>
        <div className="wc-modal-actions">
          <button type="button" className="wc-btn-secondary" onClick={onCancel}>Cancel</button>
          <button type="button" className="wc-btn-primary" onClick={onConfirm}>Log out</button>
        </div>
      </div>
    </div>
  );
}

export function OverviewTab({ metrics, latestRecipes, recipeStatus, userStatus, onNavigate }) {
  const recipeValue = recipeStatus === 'ready' ? metrics.totalRecipes : '—';
  const userValue = (value) => (userStatus === 'ready' ? value : '—');
  const hasLoadError = recipeStatus === 'error' || userStatus === 'error';

  return (
    <div className="wc-dashboard wc-admin-dashboard">
      <header className="wc-dashboard-header">
        <div>
          <p className="wc-dashboard-eyebrow">Staff operations</p>
          <h1>Admin Overview</h1>
          <p>Review current catalog and account totals, then move into the available administration areas.</p>
        </div>
      </header>

      {hasLoadError && (
        <div className="wc-dashboard-notice" role="status">
          Some overview data could not be loaded. Open the related workspace to try again.
        </div>
      )}

      <section
        className="wc-dashboard-summary"
        aria-label="Current totals"
        aria-busy={recipeStatus === 'loading' || userStatus === 'loading'}
      >
        {(recipeStatus === 'loading' || userStatus === 'loading') && (
          <span className="wc-dashboard-sr-only" role="status">Loading current totals…</span>
        )}
        <div className="wc-dashboard-stat">
          <p>Recipes</p><strong>{recipeValue}</strong><span>Current catalog total</span>
        </div>
        <div className="wc-dashboard-stat">
          <p>Users</p><strong>{userValue(metrics.totalUsers)}</strong><span>All user accounts</span>
        </div>
        <div className="wc-dashboard-stat">
          <p>Active users</p><strong>{userValue(metrics.activeUsers)}</strong><span>Accounts with active status</span>
        </div>
        <div className="wc-dashboard-stat">
          <p>Suspended users</p><strong>{userValue(metrics.suspendedUsers)}</strong><span>Accounts with suspended status</span>
        </div>
      </section>

      <div className="wc-dashboard-columns">
        <section className="wc-dashboard-section wc-dashboard-recipes" aria-labelledby="latest-recipes-heading">
          <div className="wc-dashboard-section-heading">
            <div><p className="wc-dashboard-section-label">Catalog</p><h2 id="latest-recipes-heading">Latest recipes</h2></div>
            <button type="button" className="wc-dashboard-text-action" onClick={() => onNavigate('recipes')}>View catalog <ArrowRight size={15} /></button>
          </div>
          {recipeStatus === 'loading' || recipeStatus === 'idle' ? (
            <div className="wc-dashboard-state" role="status">Loading recipe data…</div>
          ) : recipeStatus === 'error' ? (
            <div className="wc-dashboard-state">Recipe data is unavailable.</div>
          ) : latestRecipes.length === 0 ? (
            <div className="wc-dashboard-state">No recipes are currently in the catalog.</div>
          ) : (
            <ul className="wc-dashboard-recipe-list">
              {latestRecipes.map((recipe) => (
                <li key={recipe.id}>
                  <span><strong>{recipe.title}</strong><small>{slugLabel(recipe.category) || slugLabel(recipe.region) || 'Recipe'}</small></span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="wc-dashboard-section" aria-labelledby="quick-access-heading">
          <div className="wc-dashboard-section-heading">
            <div><p className="wc-dashboard-section-label">Navigation</p><h2 id="quick-access-heading">Quick access</h2></div>
          </div>
          <div className="wc-dashboard-shortcuts">
            <button type="button" onClick={() => onNavigate('users')}><Users size={18} /><span><strong>Users</strong><small>Manage account status</small></span><ArrowRight size={16} /></button>
            <button type="button" onClick={() => onNavigate('staff')}><UserCog size={18} /><span><strong>Staff Management</strong><small>Review staff access</small></span><ArrowRight size={16} /></button>
            <button type="button" onClick={() => onNavigate('recipes')}><ChefHat size={18} /><span><strong>Recipe catalog</strong><small>Open read-only catalog access</small></span><ArrowRight size={16} /></button>
          </div>
        </section>
      </div>
    </div>
  );
}

function checkPasswordRules(password, name, email) {
  const lower = password.toLowerCase();
  const namePart = name.trim().toLowerCase();
  const emailPart = email.trim().toLowerCase().split('@')[0];
  return {
    length: password.length >= 8,
    mixedCase: /[a-z]/.test(password) && /[A-Z]/.test(password),
    number: /[0-9]/.test(password),
    symbol: /[^A-Za-z0-9]/.test(password),
    noNameOrEmail:
      (!namePart || !lower.includes(namePart)) &&
      (!emailPart || !lower.includes(emailPart)),
  };
}

function AuthScreen({ onCreateAccount, onSignIn, onForgotPassword }) {
  const [mode, setMode] = useState('signin');
  const isSignUp = mode === 'signup';

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resetStatus, setResetStatus] = useState('');
  const [resetting, setResetting] = useState(false);

  const passwordRules = checkPasswordRules(password, name, email);
  const passwordValid = Object.values(passwordRules).every(Boolean);

  function switchMode(next) {
    setMode(next);
    setError('');
    setConfirmPassword('');
  }

  async function handleSignUpSubmit(e) {
    e.preventDefault();
    setError('');
    if (!name.trim() || !email.trim() || !password) {
      setError('Fill in your name, email, and password.');
      return;
    }
    if (!passwordValid) {
      setError('Your password doesn\u2019t meet all the requirements below.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords don\u2019t match.');
      return;
    }
    setSubmitting(true);
    try {
      await onCreateAccount({ name: name.trim(), email: email.trim(), password });
    } catch (err) {
      setError(err && err.message ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSignInSubmit(e) {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setSubmitting(true);
    try {
      const ok = await onSignIn({ email, password });
      if (!ok) setError('That email or password doesn\u2019t match our records.');
    } catch (err) {
      setError('Error: ' + (err && err.message ? err.message : String(err)));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleForgotPassword() {
    if (!email.trim()) {
      setResetStatus('Enter your email above first, then click "Forgot password?".');
      return;
    }
    setResetting(true);
    setResetStatus('');
    try {
      await onForgotPassword(email.trim());
      setResetStatus('Password reset email sent to ' + email.trim() + '.');
    } catch (err) {
      setResetStatus(err && err.message ? err.message : String(err));
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="wc-auth-wrap">
      <div className="wc-auth-bg" />

      <div className="wc-auth-tagline">
        <div className="wc-auth-visual-title wc-serif">Good food, well organized.</div>
        <div className="wc-auth-visual-sub">Manage WeCooked&rsquo;s recipes and members from one place.</div>
      </div>

      <div className="wc-auth-panel">
        <div className="wc-auth-badge">
          <Leaf size={20} color="#4A5D4E" />
        </div>
        <div className="wc-auth-title wc-serif">
          {isSignUp ? 'Create an account' : 'WeCooked'}
        </div>
        <div className="wc-auth-sub">
          {isSignUp
            ? 'Create the sign-in for this admin dashboard.'
            : 'Sign in to manage WeCooked recipes and users.'}
        </div>

        <form onSubmit={isSignUp ? handleSignUpSubmit : handleSignInSubmit}>
          {isSignUp && (
            <div className="wc-auth-field">
              <label>Name</label>
              <div className="wc-auth-input-wrap">
                <User size={15} />
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  autoComplete="name"
                  required
                />
              </div>
            </div>
          )}

          <div className="wc-auth-field">
            <label>Email</label>
            <div className="wc-auth-input-wrap">
              <Mail size={15} />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="username"
                required
              />
            </div>
          </div>

          <div className="wc-auth-field">
            <label>Password</label>
            <div className="wc-auth-input-wrap">
              <Lock size={15} />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isSignUp ? 'Create a password' : 'Your password'}
                autoComplete={isSignUp ? 'new-password' : 'current-password'}
                required
              />
              <button
                type="button"
                className="wc-auth-eye"
                onClick={() => setShowPassword((s) => !s)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          {!isSignUp && (
            <div className="wc-auth-switch" style={{ textAlign: 'right', marginTop: -6 }}>
              <button type="button" onClick={handleForgotPassword} disabled={resetting}>
                {resetting ? 'Sending…' : 'Forgot password?'}
              </button>
            </div>
          )}
          {!isSignUp && resetStatus && (
            <div className="wc-auth-note">{resetStatus}</div>
          )}

          {isSignUp && (
            <>
              <ul className="wc-pw-checklist">
                <li className={passwordRules.length ? 'ok' : ''}>
                  {passwordRules.length ? <Check size={13} /> : <span className="wc-pw-dot" />}
                  Contains at least 8 characters
                </li>
                <li className={passwordRules.mixedCase ? 'ok' : ''}>
                  {passwordRules.mixedCase ? <Check size={13} /> : <span className="wc-pw-dot" />}
                  Contains both lower (a-z) and upper case letters (A-Z)
                </li>
                <li className={passwordRules.number ? 'ok' : ''}>
                  {passwordRules.number ? <Check size={13} /> : <span className="wc-pw-dot" />}
                  Contains at least one number (0-9)
                </li>
                <li className={passwordRules.symbol ? 'ok' : ''}>
                  {passwordRules.symbol ? <Check size={13} /> : <span className="wc-pw-dot" />}
                  Contains at least one special symbol (!@#$%^&*…)
                </li>
                <li className={passwordRules.noNameOrEmail ? 'ok' : ''}>
                  {passwordRules.noNameOrEmail ? <Check size={13} /> : <span className="wc-pw-dot" />}
                  Does not contain your name or email address
                </li>
              </ul>

              <div className="wc-auth-field">
                <label>Confirm password</label>
                <div className="wc-auth-input-wrap">
                  <Lock size={15} />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repeat password"
                    autoComplete="new-password"
                    required
                  />
                </div>
              </div>
            </>
          )}

          {error && (
            <div className="wc-auth-error"><AlertCircle size={14} /> {error}</div>
          )}

          <button type="submit" className="wc-btn-primary wc-auth-submit" disabled={submitting}>
          {submitting ? 'Please wait…' : isSignUp ? 'Create account' : 'Sign in'}
            <ArrowRight size={15} />
          </button>
        </form>

        <div className="wc-auth-switch">
          {isSignUp ? (
            <>Already have an account? <button type="button" onClick={() => switchMode('signin')}>Sign in</button></>
          ) : (
            <>Don't have an account? <button type="button" onClick={() => switchMode('signup')}>Sign Up</button></>
          )}
        </div>

      </div>
    </div>
  );
}

// Shown when the backend sign-in succeeded but the account's current DB role
// is not "admin". Admin access is derived entirely from backend user data —
// never from a client-supplied value.
function AccessDeniedScreen({ user, onSignOut }) {
  return (
    <div className="wc-auth-wrap">
      <div className="wc-auth-bg" />
      <div className="wc-auth-tagline">
        <div className="wc-auth-visual-title wc-serif">Good food, well organized.</div>
        <div className="wc-auth-visual-sub">Manage WeCooked&rsquo;s catalog and members from one place.</div>
      </div>
      <div className="wc-auth-panel">
        <div className="wc-auth-badge">
          <ShieldAlert size={20} color="#4A5D4E" />
        </div>
        <div className="wc-auth-title wc-serif">Admin access only</div>
        <div className="wc-auth-sub">
          You&rsquo;re signed in as <strong>{user?.email}</strong>, but this dashboard is
          limited to WeCooked administrators. Ask an existing admin to upgrade this
          account, then sign in again.
        </div>
        <button type="button" className="wc-btn-primary wc-auth-submit" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </div>
  );
}

function VerifyEmailScreen({ account, onResend, onCheckAgain, onSignOut }) {
  const [status, setStatus] = useState('');
  const [checking, setChecking] = useState(false);
  const [resending, setResending] = useState(false);

  async function handleCheckAgain() {
    setChecking(true);
    setStatus('');
    try {
      const verified = await onCheckAgain();
      setStatus(verified ? '' : 'Still not verified — check your inbox and click the link, then try again.');
    } catch (err) {
      setStatus(err && err.message ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  }

  async function handleResend() {
    setResending(true);
    setStatus('');
    try {
      await onResend();
      setStatus('Verification email sent to ' + account.email + '.');
    } catch (err) {
      setStatus(err && err.message ? err.message : String(err));
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="wc-auth-wrap">
      <div className="wc-auth-bg" />
      <div className="wc-auth-tagline">
        <div className="wc-auth-visual-title wc-serif">Good food, well organized.</div>
        <div className="wc-auth-visual-sub">Manage WeCooked&rsquo;s recipes and members from one place.</div>
      </div>
      <div className="wc-auth-panel">
        <div className="wc-auth-badge">
          <Mail size={20} color="#4A5D4E" />
        </div>
        <div className="wc-auth-title wc-serif">Verify your email</div>
        <div className="wc-auth-sub">
          We sent a verification link to <strong>{account.email}</strong>. Click it, then come back here.
        </div>
        {status && <div className="wc-auth-error"><AlertCircle size={14} /> {status}</div>}
        <button type="button" className="wc-btn-primary wc-auth-submit" onClick={handleCheckAgain} disabled={checking}>
          {checking ? 'Checking…' : "I've verified, continue"}
        </button>
        <div className="wc-auth-switch">
          Didn&rsquo;t get it?{' '}
          <button type="button" onClick={handleResend} disabled={resending}>
            {resending ? 'Sending…' : 'Resend email'}
          </button>
        </div>
        <div className="wc-auth-switch">
          <button type="button" onClick={onSignOut}>Sign out</button>
        </div>
      </div>
    </div>
  );
}

export function ResetPasswordScreen({ token, onClearToken, onDone, initialStatus = 'ready' }) {
  const [status, setStatus] = useState(initialStatus); // ready | invalid | done
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    const validationErrors = {
      newPassword: passwordRequirementState(newPassword).errors,
      confirmPassword: newPassword === confirmPassword ? [] : ['Passwords don’t match.'],
    };
    setFieldErrors(validationErrors);
    setError('');
    if (hasStaffAuthErrors(validationErrors)) return;
    setSubmitting(true);
    try {
      await resetBackendPassword(token, newPassword);
      onClearToken();
      setStatus('done');
    } catch (err) {
      const apiFieldErrors = staffFieldErrors(err, ['token', 'newPassword']);
      if (err?.code === 'AUTH_PASSWORD_RESET_TOKEN_INVALID' || apiFieldErrors.token?.length) {
        onClearToken();
        setError('This reset link is invalid, expired, or has already been used.');
        setStatus('invalid');
      } else {
        setFieldErrors(apiFieldErrors);
        if (!hasStaffAuthErrors(apiFieldErrors)) {
          setError(staffErrorMessage(err, 'Unable to reset your password.'));
        }
      }
    } finally {
      setSubmitting(false);
    }
  }

  const presentation = status === 'invalid'
    ? {
        icon: <AlertCircle size={20} />,
        title: 'Reset link unavailable',
        subtitle: error || 'This reset link is invalid, expired, or has already been used.',
      }
    : status === 'done'
      ? {
          icon: <CheckCircle2 size={20} />,
          title: 'Password updated',
          subtitle: 'Your password has been updated. You can now sign in with your new password.',
        }
      : {
          icon: <Lock size={20} />,
          title: 'Reset your password',
          subtitle: 'Choose a new password for your WeCooked account.',
        };

  return (
    <SupportingAuthFrame
      icon={presentation.icon}
      eyebrow="Account recovery"
      title={presentation.title}
      subtitle={presentation.subtitle}
    >

        {status === 'invalid' && (
          <>
            <span className="wc-visually-hidden" role="alert">{presentation.subtitle}</span>
            <button type="button" className="wc-btn-primary wc-auth-submit" onClick={onDone}>
              Back to Sign In
            </button>
          </>
        )}

        {status === 'done' && (
          <>
            <span className="wc-visually-hidden" role="status">Password updated successfully.</span>
            <button type="button" className="wc-btn-primary wc-auth-submit" onClick={onDone}>
              Continue to Sign In
            </button>
          </>
        )}

        {status === 'ready' && (
          <>
            <form onSubmit={handleSubmit} aria-busy={submitting}>
              <div className="wc-auth-field">
                <label htmlFor="reset-new-password">New Password <span aria-hidden="true">*</span></label>
                <div className="wc-auth-input-wrap">
                  <Lock size={15} />
                  <input
                    id="reset-new-password"
                    type={showPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => { setNewPassword(e.target.value); setFieldErrors({}); }}
                    placeholder="Create a password"
                    autoComplete="new-password"
                    required
                    aria-invalid={Boolean(fieldErrors.newPassword?.length)}
                    aria-describedby="staff-password-requirements reset-new-password-error"
                  />
                  <button
                    type="button"
                    className="wc-auth-eye"
                    onClick={() => setShowPassword((s) => !s)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
              <FieldErrors id="reset-new-password-error" messages={fieldErrors.newPassword} />
              <PasswordRequirements password={newPassword} />

              <div className="wc-auth-field">
                <label htmlFor="reset-confirm-password">Confirm Password <span aria-hidden="true">*</span></label>
                <div className="wc-auth-input-wrap">
                  <Lock size={15} />
                  <input
                    id="reset-confirm-password"
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => { setConfirmPassword(e.target.value); setFieldErrors({}); }}
                    placeholder="Repeat password"
                    autoComplete="new-password"
                    required
                    aria-invalid={Boolean(fieldErrors.confirmPassword?.length)}
                    aria-describedby={fieldErrors.confirmPassword?.length ? 'reset-confirm-password-error' : undefined}
                  />
                </div>
              </div>
              <FieldErrors id="reset-confirm-password-error" messages={fieldErrors.confirmPassword} />

              {error && <div className="wc-auth-error" role="alert"><AlertCircle size={14} /> {error}</div>}

              <button type="submit" className="wc-btn-primary wc-auth-submit" disabled={submitting}>
                {submitting ? 'Saving…' : 'Save new password'}
              </button>
            </form>
          </>
        )}
    </SupportingAuthFrame>
  );
}

class WeCookedErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, message: error && error.message ? error.message : String(error) };
  }
  componentDidCatch(error, info) {
    console.error('WeCooked Staff Portal crashed:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="wc-admin">
          <style>{`
            .wc-crash-wrap {
              min-height: 100vh; width: 100%;
              display: flex; flex-direction: column; align-items: center; justify-content: center;
              gap: 12px; background: #FAF9F6; color: #2A2F28;
              font-family: 'Inter', -apple-system, sans-serif; text-align: center; padding: 24px;
            }
            .wc-crash-wrap button {
              background: #4A5D4E; color: #FAF9F6; border: none;
              padding: 9px 18px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer;
              margin-top: 4px;
            }
            .wc-crash-detail {
              font-family: 'SFMono-Regular', Consolas, monospace;
              font-size: 12px; color: #B15A3E; background: #F1ECE1;
              padding: 8px 12px; border-radius: 8px; max-width: 420px; word-break: break-word;
            }
          `}</style>
          <div className="wc-crash-wrap">
            <Leaf size={26} color="#4A5D4E" />
            <div style={{ fontWeight: 700, fontSize: 17 }}>Something went wrong loading the dashboard.</div>
            {this.state.message && <div className="wc-crash-detail">{this.state.message}</div>}
            <button onClick={() => this.setState({ hasError: false, message: '' })}>Try again</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function WeCookedAdmin() {
  return (
    <WeCookedErrorBoundary>
      <WeCookedAdminApp />
    </WeCookedErrorBoundary>
  );
}
