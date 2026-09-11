import React from 'react';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../context/AuthContext';

import LandingScreen from '../screens/LandingScreen';
import LoginScreen from '../screens/LoginScreen';
import RegisterScreen from '../screens/RegisterScreen';
import MainTabs from './MainTabs';
import DiscoverScreen from '../screens/DiscoverScreen';
import SavedScreen from '../screens/SavedScreen';
import CollectionDetailScreen from '../screens/CollectionDetailScreen';
import AssistantScreen from '../screens/AssistantScreen';
import MealPlanScreen from '../screens/MealPlanScreen';
import IngredientStudioScreen from '../screens/IngredientStudioScreen';
import SwapDetailScreen from '../screens/SwapDetailScreen';
import RecipeDetailScreen from '../screens/RecipeDetailScreen';
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
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
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
                  "Search"). SavedScreen also navigate('Discover').
                - Assistant — PlusMenu "Ask the Chef".
                - MealPlan  — PlusMenu "Meal Plan" (minimal placeholder screen;
                  real feature is a later milestone).

              Community is NOT registered here: it is a MainTabs route. Its only
              caller, ProfileScreen's menu (navigation.navigate('Community')),
              runs inside MainTabs and resolves to the sibling Community tab. A
              duplicate root-stack "Community" would only trigger React
              Navigation's nested same-name warning.
            */}
            <Stack.Screen name="Discover" component={DiscoverScreen} />
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
          </>
        ) : (
          // --- unauthenticated stack ---
          <>
            <Stack.Screen name="Landing" component={LandingScreen} />
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="Register" component={RegisterScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
