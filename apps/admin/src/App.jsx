import React, { useState, useEffect, useMemo } from 'react';
import {
  LayoutDashboard, ChefHat, Users, X,
  Leaf, TrendingUp, Clock, Check, LogOut, Mail, Lock, Eye, EyeOff,
  AlertCircle, ArrowRight, User, Settings, HelpCircle,
  Accessibility, ChevronDown, Carrot, ShieldAlert, Replace, ShieldCheck, UserCog,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { useCallback, useRef } from 'react';
import { auth } from './firebase.js';
import {
  toAccount, logIn, logOutUser,
  updateUserProfile, changeUserPassword, deleteCurrentAccount,
  requestPasswordReset, verifyResetCode, confirmReset,
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
  PendingState,
  RejectedState,
  StaffBootstrapError,
  StaffPortalAuthScreen,
  StaffPortalScreenStyles,
  VerifyEmailState,
} from './StaffPortalScreens.jsx';
import {
  applyAsModerator,
  getStaffState,
  requestBackendPasswordReset,
  resendBackendVerification,
} from './staffApi.js';
import { getCatalogPolicy, getPortalDestination, getSafeNavigation } from './portalPolicy.js';
import { staffErrorMessage } from './staffErrorMessage.js';
import { registerModeratorApplicant, retryModeratorApplication } from './staffOnboarding.js';

const DISPLAY_PREFS_KEY = 'wecooked-admin-display-prefs';

const growthData = [
  { month: 'Mar', users: 340, recipes: 210 },
  { month: 'Apr', users: 410, recipes: 245 },
  { month: 'May', users: 505, recipes: 268 },
  { month: 'Jun', users: 612, recipes: 301 },
  { month: 'Jul', users: 748, recipes: 329 },
  { month: 'Aug', users: 890, recipes: 356 },
];

const activityFeed = [
  { text: 'Priya Nandakumar saved Saffron Risotto with Charred Leeks', time: '2h ago' },
  { text: 'New recipe added: Grilled Peach & Burrata Toast', time: '5h ago' },
  { text: 'Theo Marchetti joined WeCooked', time: '1d ago' },
  { text: 'New recipe added: Smoky Chickpea Shakshuka', time: '2d ago' },
];

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
  // effort, only so the Firebase-Auth-backed admin account flows (profile,
  // password, email, verification, delete-account) keep working — see
  // docs/architecture/admin-api-integration.md.
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
  const [recipeStats, setRecipeStats] = useState({ total: 0, latest: [] });
  const [userCounts, setUserCounts] = useState({ total: 0, active: 0, suspended: 0 });

  const [account, setAccount] = useState(null);
  const [confirmDeleteAccount, setConfirmDeleteAccount] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [displayPrefs, setDisplayPrefs] = useState({ theme: 'light', reduceMotion: false });
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  const [resetOobCode, setResetOobCode] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('mode') === 'resetPassword' ? params.get('oobCode') : null;
  });

  function clearResetLink() {
    setResetOobCode(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('mode');
    url.searchParams.delete('oobCode');
    url.searchParams.delete('apiKey');
    window.history.replaceState({}, '', url.pathname + url.search);
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
    // Firebase auth runs in the background purely for the Firebase-Auth-backed
    // admin account flows (profile, password, email, verification,
    // delete-account); the dashboard gate itself is driven by backend auth, not
    // this. `account` feeds the profile menu / Settings identity.
    const unsub = auth.onAuthStateChanged((user) => {
      setAccount(toAccount(user));
    });
    return unsub;
  }, []);

  useEffect(() => {
    // Recipe stats for the Overview tab, straight from the REST API — no
    // Firestore. Best-effort: a failure just leaves the widgets at zero/empty.
    if (backend.status !== 'authenticated' || backend.user?.role !== 'admin') return undefined;
    let cancelled = false;
    (async () => {
      try {
        const { recipes, pagination } = await listRecipes({
          status: 'all', sort: 'newest', page: 1, limit: 100,
        });
        if (cancelled) return;
        setRecipeStats({
          total: pagination?.total ?? recipes.length,
          latest: recipes.slice(0, 4),
        });
      } catch {
        if (!cancelled) setRecipeStats({ total: 0, latest: [] });
      }
    })();
    return () => { cancelled = true; };
  }, [backend.status, backend.user?.role]);

  useEffect(() => {
    // User counts for the Overview tab, straight from the REST API — no
    // Firestore. Refetched whenever the admin lands on Overview so a suspend /
    // reactivate done on the Users tab is reflected. Only pagination.total is
    // read (limit: 1 keeps the payload tiny). Best-effort: a failure just
    // leaves the cards at zero.
    if (tab !== 'overview') return undefined;
    if (backend.status !== 'authenticated' || backend.user?.role !== 'admin') return undefined;
    let cancelled = false;
    (async () => {
      try {
        const [all, active, suspended] = await Promise.all([
          listUsers({ limit: 1 }),
          listUsers({ limit: 1, status: 'active' }),
          listUsers({ limit: 1, status: 'suspended' }),
        ]);
        if (cancelled) return;
        setUserCounts({
          total: all.pagination?.total ?? 0,
          active: active.pagination?.total ?? 0,
          suspended: suspended.pagination?.total ?? 0,
        });
      } catch {
        if (!cancelled) setUserCounts({ total: 0, active: 0, suspended: 0 });
      }
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
    await backend.login(email, password);
    // Best effort: mirror the sign-in to Firebase so the Firebase-Auth-backed
    // admin account flows keep working for admins whose credentials also exist
    // there. A failure here is expected for backend-only admins and must not
    // block.
    try {
      await logIn(email, password);
    } catch (err) {
      console.warn('Firebase sign-in unavailable (account flows will be limited):', err?.code || err);
    }
    return true;
  }

  async function forgotPassword(email) {
    await requestPasswordReset(email);
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

  async function updateProfile({ name, email }) {
    const updated = await updateUserProfile(name, email);
    setAccount(updated);
  }

  async function changePassword({ currentPassword, newPassword }) {
    await changeUserPassword(currentPassword, newPassword);
  }

  function updateDisplayPrefs(patch) {
    setDisplayPrefs((prev) => ({ ...prev, ...patch }));
  }

  // Identity shown in the sidebar / menus. Prefer the Firebase account object
  // (it carries the fields those Firebase-specific modals still expect); fall
  // back to the backend user so a backend-only admin still gets a profile menu
  // and a working "Log out".
  const identity =
    account ||
    (backend.user
      ? { name: backend.user.name, email: backend.user.email, emailVerified: backend.user.emailVerified }
      : null);

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
        .wc-admin *:focus-visible {
          outline: none;
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

      {resetOobCode ? (
        <ResetPasswordScreen oobCode={resetOobCode} onDone={clearResetLink} />
      ) : backend.status === 'checking' || (backend.status === 'authenticated' && ['idle', 'loading'].includes(staffState.status)) ? (
        <div className="wc-loading">
          <Leaf size={26} />
          <span>Loading Staff Portal…</span>
        </div>
      ) : backend.status !== 'authenticated' ? (
        <StaffPortalAuthScreen onRegisterAndApply={registerAndApply} onSignIn={signIn} onForgotPassword={forgotStaffPassword} />
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
          onSignOut={signOut}
          onAuthorityLost={refreshAuthority}
        />
      ) : portalDestination !== 'admin' ? (
        <StaffBootstrapError message="The Staff Portal returned an unsupported access state." onRetry={() => refreshStaffState()} onSignOut={signOut} />
      ) : (
        <>
          <aside className="wc-sidebar">
            <div className="wc-brand">
              <div className="wc-brand-badge">
                <Leaf size={18} color="#4A5D4E" />
              </div>
              <div>
                <div className="wc-brand-name">WeCooked</div>
                <div className="wc-brand-sub">Staff Portal · Admin</div>
              </div>
            </div>
            <nav className="wc-nav">
              <button
                className={`wc-nav-item ${tab === 'overview' ? 'active' : ''}`}
                onClick={() => setTab('overview')}
              >
                <LayoutDashboard size={17} /> Overview
              </button>
              <button
                className={`wc-nav-item ${tab === 'recipes' ? 'active' : ''}`}
                onClick={() => setTab('recipes')}
              >
                <ChefHat size={17} /> Recipes
              </button>
              <button
                className={`wc-nav-item ${tab === 'ingredients' ? 'active' : ''}`}
                onClick={() => setTab('ingredients')}
              >
                <Carrot size={17} /> Ingredients
              </button>
              <button
                className={`wc-nav-item ${tab === 'substitutions' ? 'active' : ''}`}
                onClick={() => setTab('substitutions')}
              >
                <Replace size={17} /> Substitutions
              </button>
              <button
                className={`wc-nav-item ${tab === 'users' ? 'active' : ''}`}
                onClick={() => setTab('users')}
              >
                <Users size={17} /> Users
              </button>
              <button
                className={`wc-nav-item ${tab === 'staff' ? 'active' : ''}`}
                onClick={() => setTab('staff')}
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
              {account && (
                <button className="wc-reset-btn" onClick={() => setConfirmDeleteAccount(true)}>
                  Delete admin account
                </button>
              )}
            </div>
          </aside>

          <main className="wc-main">
            {tab === 'overview' && (
              <OverviewTab
                metrics={metrics}
                dark={displayPrefs.theme === 'dark'}
                latestRecipes={recipeStats.latest}
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

function ModeratorWorkspace({ tab, setTab, identity, onSignOut, onAuthorityLost }) {
  const areas = [
    { id: 'recipes', label: 'Recipes', icon: ChefHat },
    { id: 'ingredients', label: 'Ingredients', icon: Carrot },
    { id: 'substitutions', label: 'Substitutions', icon: Replace },
  ];

  return (
    <>
      <style>{`
        .wc-moderator-card { max-width:760px; background:var(--field-bg); border:1px solid var(--stone-light); border-radius:16px; padding:28px; box-shadow:0 8px 24px rgba(42,47,40,.07); }
        .wc-moderator-kicker { display:inline-flex; align-items:center; gap:7px; color:var(--sage-deep); background:rgba(192,213,194,.35); border-radius:999px; padding:7px 11px; font-size:12px; font-weight:700; margin-bottom:14px; }
        .wc-moderator-card h1 { margin:0 0 9px; font-size:27px; }
        .wc-moderator-card p { color:var(--stone); line-height:1.6; margin:0; }
        .wc-moderator-areas { display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:12px; margin-top:24px; }
        .wc-moderator-area { border:1px solid var(--stone-light); border-radius:11px; padding:16px; display:flex; flex-direction:column; gap:8px; color:var(--ink); background:var(--parchment); }
        .wc-moderator-area svg { color:var(--sage-deep); }
        .wc-moderator-area span { font-size:11.5px; color:var(--stone); }
        .wc-moderator-identity { padding:8px; color:var(--sage-light); font-size:11.5px; overflow:hidden; text-overflow:ellipsis; }
        @media (max-width:760px) { .wc-moderator-areas { grid-template-columns:1fr; } }
      `}</style>
      <aside className="wc-sidebar">
        <div className="wc-brand">
          <div className="wc-brand-badge"><Leaf size={18} color="#4A5D4E" /></div>
          <div><div className="wc-brand-name">WeCooked</div><div className="wc-brand-sub">Staff Portal · Moderator</div></div>
        </div>
        <nav className="wc-nav">
          <button className={`wc-nav-item ${tab === 'moderator-home' ? 'active' : ''}`} onClick={() => setTab('moderator-home')}><LayoutDashboard size={17} /> Overview</button>
          {areas.map(({ id, label, icon: Icon }) => (
            <button key={id} className={`wc-nav-item ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}><Icon size={17} /> {label}</button>
          ))}
        </nav>
        <div className="wc-sidebar-footer">
          <div className="wc-moderator-identity">{identity?.name || identity?.email}<br />{identity?.email}</div>
          <button className="wc-nav-item" onClick={onSignOut}><LogOut size={17} /> Sign Out</button>
        </div>
      </aside>
      <main className="wc-main">
        {tab === 'recipes' && (
          <RecipesTab canWrite canUploadRecipeImage onAuthorityLost={onAuthorityLost} />
        )}
        {tab === 'ingredients' && <IngredientsTab canWrite onAuthorityLost={onAuthorityLost} />}
        {tab === 'substitutions' && <SubstitutionsTab canWrite onAuthorityLost={onAuthorityLost} />}
        {tab === 'moderator-home' && (
          <div className="wc-moderator-card">
            <div className="wc-moderator-kicker"><ShieldCheck size={16} /> Moderator access approved</div>
            <h1>Welcome to the Staff Portal</h1>
            <p>Your Moderator account can manage the shared recipe, ingredient, and substitution catalog.</p>
            <div className="wc-moderator-areas">
              {areas.map(({ id, label, icon: Icon }) => (
                <button
                  type="button"
                  className="wc-moderator-area"
                  key={id}
                  onClick={() => setTab(id)}
                >
                  <Icon size={20} /><strong>{label}</strong><span>Open catalog management</span>
                </button>
              ))}
            </div>
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

function ProfileMenu({
  account, open, onToggle, onClose, onSignOut,
  onOpenSettings, onOpenHelp, onOpenDisplay,
}) {
  if (!account) return null;

  return (
    <div className="wc-profile">
      <button className="wc-profile-btn" onClick={onToggle} aria-expanded={open}>
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
          <div className="wc-profile-dropdown">
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

function SettingsModal({ account, onClose, onUpdateProfile, onChangePassword }) {
  const [name, setName] = useState(account.name || '');
  const [email, setEmail] = useState(account.email || '');
  const [profileError, setProfileError] = useState('');
  const [profileSaved, setProfileSaved] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  const passwordRules = checkPasswordRules(newPassword, name, email);
  const passwordValid = Object.values(passwordRules).every(Boolean);

  async function submitProfile(e) {
    e.preventDefault();
    setProfileError('');
    setProfileSaved(false);
    if (!name.trim() || !email.trim()) {
      setProfileError('Name and email can’t be empty.');
      return;
    }
    const emailChanged = email.trim().toLowerCase() !== (account.email || '').toLowerCase();
    setSavingProfile(true);
    try {
      await onUpdateProfile({ name, email });
      setProfileSaved(emailChanged ? 'email-pending' : true);
    } catch (err) {
      setProfileError(err && err.message ? err.message : String(err));
    } finally {
      setSavingProfile(false);
    }
  }

  async function submitPassword(e) {
    e.preventDefault();
    setPasswordError('');
    setPasswordSaved(false);
    if (!currentPassword || !newPassword) {
      setPasswordError('Fill in both password fields.');
      return;
    }
    if (!passwordValid) {
      setPasswordError('New password doesn’t meet all the requirements below.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPasswordError('New passwords don’t match.');
      return;
    }
    setSavingPassword(true);
    try {
      await onChangePassword({ currentPassword, newPassword });
      setPasswordSaved(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
    } catch (err) {
      setPasswordError(err && err.message ? err.message : String(err));
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
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="wc-field">
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          {profileError && (
            <div className="wc-auth-error"><AlertCircle size={14} /> {profileError}</div>
          )}
          {profileSaved === 'email-pending' && (
            <div className="wc-settings-success">
              <Check size={14} /> Name updated. Check your new email inbox to confirm the email change.
            </div>
          )}
          {profileSaved === true && (
            <div className="wc-settings-success"><Check size={14} /> Profile updated.</div>
          )}
          <div className="wc-modal-actions">
            <button type="submit" className="wc-btn-primary" disabled={savingProfile}>
              {savingProfile ? 'Saving…' : 'Save changes'}
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
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          <div className="wc-field">
            <label>New password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>
          {newPassword && (
            <ul className="wc-pw-checklist">
              <li className={passwordRules.length ? 'ok' : ''}>
                {passwordRules.length ? <Check size={13} /> : <span className="wc-pw-dot" />}
                Contains at least 8 characters
              </li>
              <li className={passwordRules.mixedCase ? 'ok' : ''}>
                {passwordRules.mixedCase ? <Check size={13} /> : <span className="wc-pw-dot" />}
                Contains both lower and upper case letters
              </li>
              <li className={passwordRules.number ? 'ok' : ''}>
                {passwordRules.number ? <Check size={13} /> : <span className="wc-pw-dot" />}
                Contains at least one number (0-9)
              </li>
              <li className={passwordRules.symbol ? 'ok' : ''}>
                {passwordRules.symbol ? <Check size={13} /> : <span className="wc-pw-dot" />}
                Contains at least one special symbol
              </li>
              <li className={passwordRules.noNameOrEmail ? 'ok' : ''}>
                {passwordRules.noNameOrEmail ? <Check size={13} /> : <span className="wc-pw-dot" />}
                Does not contain your name or email
              </li>
            </ul>
          )}
          <div className="wc-field">
            <label>Confirm new password</label>
            <input
              type="password"
              value={confirmNewPassword}
              onChange={(e) => setConfirmNewPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>
          {passwordError && (
            <div className="wc-auth-error"><AlertCircle size={14} /> {passwordError}</div>
          )}
          {passwordSaved && (
            <div className="wc-settings-success"><Check size={14} /> Password updated.</div>
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
    a: 'Ingredients, substitutions, recipes, users, and staff applications live in the WeCooked backend (REST API + MongoDB). Firebase remains only for legacy account utilities and a best-effort sign-in mirror; it does not determine Staff Portal access.',
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

function OverviewTab({ metrics, dark, latestRecipes }) {
  const gridStroke = dark ? '#3A392F' : '#DAD3C4';
  const tickFill = dark ? '#A39C8C' : '#8C8577';
  return (
    <div>
      <div className="wc-topbar">
        <h1>Overview</h1>
      </div>

      <div className="wc-metric-grid">
        <div className="wc-metric-card">
          <div className="wc-metric-label">Total Recipes</div>
          <div className="wc-metric-value wc-serif">{metrics.totalRecipes}</div>
          <div className="wc-metric-delta"><TrendingUp size={13} /> +12 this month</div>
        </div>
        <div className="wc-metric-card">
          <div className="wc-metric-label">Total Users</div>
          <div className="wc-metric-value wc-serif">{metrics.totalUsers}</div>
          <div className="wc-metric-delta"><TrendingUp size={13} /> +8% this month</div>
        </div>
        <div className="wc-metric-card">
          <div className="wc-metric-label">Active Users</div>
          <div className="wc-metric-value wc-serif">{metrics.activeUsers}</div>
          <div className="wc-metric-delta"><TrendingUp size={13} /> steady</div>
        </div>
        <div className="wc-metric-card">
          <div className="wc-metric-label">Suspended Users</div>
          <div className="wc-metric-value wc-serif">{metrics.suspendedUsers}</div>
          <div className="wc-metric-delta"><Clock size={13} /> as of last check</div>
        </div>
      </div>

      <div className="wc-panels">
        <div className="wc-card">
          <h2>Growth, last 6 months</h2>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={growthData} margin={{ left: -18, right: 10, top: 5, bottom: 0 }}>
              <defs>
                <linearGradient id="wcUsers" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#4A5D4E" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#4A5D4E" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="wcRecipes" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#C9962E" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#C9962E" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={gridStroke} vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 12, fill: tickFill }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: tickFill }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ borderRadius: 8, border: `1px solid ${gridStroke}`, fontSize: 13, background: dark ? '#262B24' : '#fff', color: dark ? '#EDEAE0' : '#2A2F28' }} />
              <Area type="monotone" dataKey="users" stroke="#4A5D4E" fill="url(#wcUsers)" strokeWidth={2} name="Users" />
              <Area type="monotone" dataKey="recipes" stroke="#C9962E" fill="url(#wcRecipes)" strokeWidth={2} name="Recipes" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="wc-card">
          <h2>Recent activity</h2>
          <ul className="wc-activity-list">
            {activityFeed.map((item, i) => (
              <li key={i}>
                <Leaf size={13} className="wc-leaf-dot" />
                <span>{item.text}</span>
                <span className="wc-activity-time">{item.time}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="wc-panels wc-panels-secondary">
        <div className="wc-card">
          <h2>Latest recipes</h2>
          {latestRecipes.length === 0 ? (
            <div className="wc-empty-inline">No recipes yet.</div>
          ) : (
            <ul className="wc-toprecipe-list">
              {latestRecipes.map((r) => (
                <li key={r.id}>
                  <span className="wc-toprecipe-title">{r.title}</span>
                  <span className="wc-toprecipe-saves">
                    {slugLabel(r.category) || slugLabel(r.region) || ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="wc-card">
          <h2>Catalog</h2>
          <div className="wc-empty-inline">
            {metrics.totalRecipes === 1 ? '1 recipe' : `${metrics.totalRecipes} recipes`} in the
            catalog. A region / category breakdown returns once recipe content is classified.
          </div>
        </div>
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

function ResetPasswordScreen({ oobCode, onDone }) {
  const [status, setStatus] = useState('verifying'); // verifying | ready | invalid | done
  const [email, setEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    verifyResetCode(oobCode)
      .then((resolvedEmail) => {
        if (!cancelled) { setEmail(resolvedEmail); setStatus('ready'); }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err && err.message ? err.message : String(err));
          setStatus('invalid');
        }
      });
    return () => { cancelled = true; };
  }, [oobCode]);

  const passwordRules = checkPasswordRules(newPassword, '', email);
  const passwordValid = Object.values(passwordRules).every(Boolean);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!passwordValid) {
      setError('Your password doesn’t meet all the requirements below.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords don’t match.');
      return;
    }
    setSubmitting(true);
    try {
      await confirmReset(oobCode, newPassword);
      setStatus('done');
    } catch (err) {
      setError(err && err.message ? err.message : String(err));
    } finally {
      setSubmitting(false);
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
          <Lock size={20} color="#4A5D4E" />
        </div>
        <div className="wc-auth-title wc-serif">Reset your password</div>

        {status === 'verifying' && (
          <div className="wc-auth-sub">Checking your reset link…</div>
        )}

        {status === 'invalid' && (
          <>
            <div className="wc-auth-error"><AlertCircle size={14} /> {error || 'This reset link is invalid or has expired.'}</div>
            <button type="button" className="wc-btn-primary wc-auth-submit" onClick={onDone}>
              Back to sign in
            </button>
          </>
        )}

        {status === 'done' && (
          <>
            <div className="wc-auth-sub">Your password has been updated.</div>
            <button type="button" className="wc-btn-primary wc-auth-submit" onClick={onDone}>
              Continue to sign in
            </button>
          </>
        )}

        {status === 'ready' && (
          <>
            <div className="wc-auth-sub">Choose a new password for <strong>{email}</strong>.</div>
            <form onSubmit={handleSubmit}>
              <div className="wc-auth-field">
                <label>New password</label>
                <div className="wc-auth-input-wrap">
                  <Lock size={15} />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Create a password"
                    autoComplete="new-password"
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

              {error && <div className="wc-auth-error"><AlertCircle size={14} /> {error}</div>}

              <button type="submit" className="wc-btn-primary wc-auth-submit" disabled={submitting}>
                {submitting ? 'Saving…' : 'Save new password'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
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
