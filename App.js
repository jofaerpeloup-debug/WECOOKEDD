import React, { useEffect } from 'react';
import { View, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import {
  useFonts,
  PlayfairDisplay_600SemiBold,
  PlayfairDisplay_700Bold,
  PlayfairDisplay_600SemiBold_Italic,
} from '@expo-google-fonts/playfair-display';
import {
  WorkSans_400Regular,
  WorkSans_500Medium,
  WorkSans_600SemiBold,
  WorkSans_700Bold,
} from '@expo-google-fonts/work-sans';

import RootNavigator from './src/navigation/RootNavigator';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { ProfileProvider } from './src/context/ProfileContext';
import { SavedRecipesProvider } from './src/context/SavedRecipesContext';
import { CookedRecipesProvider } from './src/context/CookedRecipesContext';
import { CollectionsProvider } from './src/context/CollectionsContext';
import { ReviewsProvider } from './src/context/ReviewsContext';
import { MealPlanProvider } from './src/context/MealPlanContext';
import { NotificationsProvider } from './src/context/NotificationsContext';
import { ShoppingListProvider } from './src/context/ShoppingListContext';
import { SearchHistoryProvider } from './src/context/SearchHistoryContext';
import { CommunityProvider } from './src/context/CommunityContext';

SplashScreen.preventAutoHideAsync();

// On web the Expo HTML template's #root reset relies on a row flexbox +
// align-items:stretch to fill height, which can leave the app short of the
// viewport on the dev server. Force a column flex chain and kill body margin
// so the app always fills the window (background is themed in AppGate).
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  const STYLE_ID = 'wecooked-web-reset';
  if (!document.getElementById(STYLE_ID)) {
    const el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent =
      'html,body,#root{height:100%;min-height:100%;margin:0;}' +
      '#root{display:flex;flex-direction:column;}';
    document.head.appendChild(el);
  }
}

// Data providers, applied outermost-first.
const PROVIDERS = [
  AuthProvider,
  ProfileProvider,
  SavedRecipesProvider,
  CookedRecipesProvider,
  CollectionsProvider,
  ReviewsProvider,
  MealPlanProvider,
  NotificationsProvider,
  ShoppingListProvider,
  SearchHistoryProvider,
  CommunityProvider,
];

function withProviders(children) {
  return PROVIDERS.reduceRight((acc, Provider) => <Provider>{acc}</Provider>, children);
}

function AppGate({ fontsLoaded }) {
  const { colors, isDark } = useTheme();
  const { isReady } = useAuth();
  const ready = fontsLoaded && isReady;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  // Paint the web page canvas with the theme background so any area the app
  // doesn't cover (or briefly, before layout) never flashes as a bare gap.
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.body.style.backgroundColor = colors.cream;
    }
  }, [colors.cream]);

  if (!ready) return null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <RootNavigator />
    </View>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({
    PlayfairDisplay_600SemiBold,
    PlayfairDisplay_700Bold,
    PlayfairDisplay_600SemiBold_Italic,
    WorkSans_400Regular,
    WorkSans_500Medium,
    WorkSans_600SemiBold,
    WorkSans_700Bold,
  });

  return (
    <SafeAreaProvider style={{ flex: 1 }}>
      <ThemeProvider>{withProviders(<AppGate fontsLoaded={fontsLoaded} />)}</ThemeProvider>
    </SafeAreaProvider>
  );
}
