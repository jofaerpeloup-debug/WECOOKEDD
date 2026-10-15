import React from 'react';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { navigationRef } from './navigationRef';

import LandingScreen from '../screens/LandingScreen';
import LoginScreen from '../screens/LoginScreen';
import RegisterScreen from '../screens/RegisterScreen';
import MainTabs from './MainTabs';
import DiscoverScreen from '../screens/DiscoverScreen';
import TrendingScreen from '../screens/TrendingScreen';
import SavedScreen from '../screens/SavedScreen';
import CollectionDetailScreen from '../screens/CollectionDetailScreen';
import AssistantScreen from '../screens/AssistantScreen';
import MealPlanScreen from '../screens/MealPlanScreen';
import IngredientStudioScreen from '../screens/IngredientStudioScreen';
import SwapDetailScreen from '../screens/SwapDetailScreen';
import RecipeDetailScreen from '../screens/RecipeDetailScreen';
import RecipeReviewsScreen from '../screens/RecipeReviewsScreen';
import CookingHistoryScreen from '../screens/CookingHistoryScreen';
import CookModeScreen from '../screens/CookModeScreen';
import ShoppingListScreen from '../screens/ShoppingListScreen';
import AccountDetailsScreen from '../screens/AccountDetailScreen';
import SettingsScreen from '../screens/SettingsScreen';
import SecurityScreen from '../screens/SecurityScreen';
import NotificationsScreen from '../screens/NotificationsScreen';
import HelpCenterScreen from '../screens/HelpCenterScreen';
import AboutScreen from '../screens/AboutScreen';
import TermsScreen from '../screens/TermsScreen';
import PrivacyScreen from '../screens/PrivacyScreen';
import LicensesScreen from '../screens/LicensesScreen';
import ResetPasswordScreen from '../screens/ResetPasswordScreen';
import VerifyEmailScreen from '../screens/VerifyEmailScreen';
import VerifyEmailChangeScreen from '../screens/VerifyEmailChangeScreen';

// Deep-link routes only. ResetPassword, VerifyEmail, and VerifyEmailChange
// map by REGISTERED route name — all three routes exist in the authenticated
// and unauthenticated stacks below (see
// each stack's own comment), so this single config resolves correctly
// regardless of which stack is currently mounted. React Navigation extracts
// `?token=...` into route.params automatically; no custom parse function is
// needed. Deliberately narrow: only these two screens are linkable, and there
// is no catch-all/wildcard route, so an unmatched link is simply ignored
// rather than routed somewhere arbitrary.
const linking = {
  prefixes: ['wecooked://'],
  config: {
    screens: {
      ResetPassword: 'reset-password',
      VerifyEmail: 'verify-email',
      VerifyEmailChange: 'verify-email-change',
    },
  },
};

const Stack = createNativeStackNavigator();

export default function RootNavigator() {
  const { colors, isDark } = useTheme();
  const { isLoggedIn } = useAuth();

  // Keeps the (mostly invisible) native-stack transition background in sync
  // with the active theme, so a screen transition never flashes white/black.
  const navTheme = {
    ...(isDark ? DarkTheme : DefaultTheme),
    colors: {
      ...(isDark ? DarkTheme.colors : DefaultTheme.colors),
      background: colors.cream,
      card: colors.paper,
      text: colors.ink,
      border: colors.hairline,
      primary: colors.sageDeep,
    },
  };

  return (
    <NavigationContainer ref={navigationRef} theme={navTheme} linking={linking}>
      {/*
        NOT keyed off isLoggedIn. A whole-Navigator React `key` here was tried
        and reverted: on remount, React Navigation rehydrates the previous
        state via router.getRehydratedState(), which keeps any route whose
        NAME still exists in the new branch's routeNames — so "ResetPassword"
        and "VerifyEmail" (registered under the same name in both branches)
        survived the "reset" and became the sole/active route again. A plain
        re-render (no key) goes through getStateForRouteNamesChange instead,
        which additionally drops routes whose `navigationKey` changed since
        the last render — see the three auth deep-link screens below,
        which use exactly that to get discarded on every auth-state flip.
      */}
      <Stack.Navigator
        screenOptions={{ headerShown: false, animation: 'slide_from_right' }}
      >
        {isLoggedIn ? (
          // --- authenticated stack ---
          // React Navigation swaps the whole screen set when `isLoggedIn`
          // flips, so login/register/logout need no imperative navigation —
          // the correct stack simply renders.
          <>
            <Stack.Screen name="MainTabs" component={MainTabs} />
            {/*
              M2 navigation shell: the teammate tab set is Home | Community |
              Swaps | Profile only (see MainTabs.js). Discover, Assistant and
              Saved are no longer tabs, so they are registered here as stack
              destinations to stay reachable:
                - Discover  — Dashboard "search / browse / See all / Easy / Vegan
                  / Vegetarian" all navigate('Discover', { initialFilter }); the
                  internal route name stays "Discover" (user-facing title may be
                  "Search"). CollectionDetailScreen also navigates to Discover.
                - Assistant — PlusMenu "Ask the Chef".
                - MealPlan  — PlusMenu "Meal Plan" (real server-backed planner).
                - IngredientStudio — registered for direct navigation; the same
                  screen is also the Swaps tab.
                - SwapDetail — real catalog result cards from IngredientStudio.

              Community is NOT registered here: it is intentionally reachable
              only through its MainTabs tab. A duplicate root-stack
              "Community" would trigger React Navigation's nested same-name
              warning.
            */}
            <Stack.Screen name="Discover" component={DiscoverScreen} />
            <Stack.Screen name="Trending" component={TrendingScreen} />
            <Stack.Screen name="Saved" component={SavedScreen} />
            {/*
              CollectionDetail is Saved's real next screen (teammate "My
              Collections" -> collection contents). It currently supports only
              collectionType: 'favorites', backed by FavoritesContext — see
              CollectionDetailScreen.js. Real Collections (smart/user, with
              real collection ids) is M5.
            */}
            <Stack.Screen name="CollectionDetail" component={CollectionDetailScreen} />
            <Stack.Screen name="Assistant" component={AssistantScreen} />
            <Stack.Screen name="MealPlan" component={MealPlanScreen} />
            <Stack.Screen name="IngredientStudio" component={IngredientStudioScreen} />
            <Stack.Screen
              name="SwapDetail"
              component={SwapDetailScreen}
              options={{ animation: 'slide_from_bottom' }}
            />
            <Stack.Screen name="RecipeDetail" component={RecipeDetailScreen} />
            <Stack.Screen name="RecipeReviews" component={RecipeReviewsScreen} />
            <Stack.Screen name="CookingHistory" component={CookingHistoryScreen} />
            <Stack.Screen
              name="CookMode"
              component={CookModeScreen}
              options={{ animation: 'slide_from_bottom' }}
            />
            <Stack.Screen name="List" component={ShoppingListScreen} />
            {/*
              Profile is a MainTabs route only — no root-stack registration.
              Nothing navigates('Profile'); the tab is the sole entry point, and
              a duplicate root-stack "Profile" would only trip React Navigation's
              nested same-name warning. Its detail pages (AccountDetails,
              Settings, Security, Notifications, HelpCenter, About, Terms,
              Privacy, Licenses) stay here — the Profile tab navigates out to
              them and the calls bubble up to this stack.
            */}
            <Stack.Screen name="AccountDetails" component={AccountDetailsScreen} />
            <Stack.Screen name="Settings" component={SettingsScreen} />
            <Stack.Screen name="Security" component={SecurityScreen} />
            <Stack.Screen name="Notifications" component={NotificationsScreen} />
            <Stack.Screen name="HelpCenter" component={HelpCenterScreen} />
            <Stack.Screen name="About" component={AboutScreen} />
            <Stack.Screen name="Terms" component={TermsScreen} />
            <Stack.Screen name="Privacy" component={PrivacyScreen} />
            <Stack.Screen name="Licenses" component={LicensesScreen} />
            {/*
              Deep-link-only routes, reachable while authenticated too (an
              already-signed-in device can still receive a verify-email link;
              a stale reset-password link opened while signed in must still
              render the form, then ResetPasswordScreen's own
              endLocalSession() handles dropping the session on success). Not
              a fake third auth state — these are ordinary registered routes
              present in both stacks, exactly like every other screen here.

              `navigationKey` is what makes each of these get DROPPED (not
              preserved) by React Navigation when isLoggedIn flips: it differs
              from its counterpart in the other branch below, so
              getStateForRouteNamesChange sees this route's key change and
              removes it, instead of matching it by name and keeping it
              mounted/focused across the swap. Without this, a ResetPassword
              (or either verification route) pushed while on one side of the swap survives
              into the other side as the sole remaining — and therefore
              active — route.
            */}
            <Stack.Screen
              name="ResetPassword"
              component={ResetPasswordScreen}
              navigationKey="reset-authed"
            />
            <Stack.Screen
              name="VerifyEmail"
              component={VerifyEmailScreen}
              navigationKey="verify-authed"
            />
            <Stack.Screen
              name="VerifyEmailChange"
              component={VerifyEmailChangeScreen}
              navigationKey="verify-change-authed"
            />
          </>
        ) : (
          // --- unauthenticated stack ---
          <>
            <Stack.Screen name="Landing" component={LandingScreen} />
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="Register" component={RegisterScreen} />
            {/* See the authenticated stack's own comment above. */}
            <Stack.Screen
              name="ResetPassword"
              component={ResetPasswordScreen}
              navigationKey="reset-guest"
            />
            <Stack.Screen
              name="VerifyEmail"
              component={VerifyEmailScreen}
              navigationKey="verify-guest"
            />
            <Stack.Screen
              name="VerifyEmailChange"
              component={VerifyEmailChangeScreen}
              navigationKey="verify-change-guest"
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
