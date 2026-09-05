import React from 'react';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../context/AuthContext';

import OnboardingScreen from '../screens/OnboardingScreen';
import LoginScreen from '../screens/LoginScreen';
import MainTabs from './MainTabs';
import AssistantScreen from '../screens/AssistantScreen';
import DiscoverScreen from '../screens/DiscoverScreen';
import RecipeDetailScreen from '../screens/RecipeDetailScreen';
import CookModeScreen from '../screens/CookModeScreen';
import MealPlanScreen from '../screens/MealPlanScreen';
import CollectionDetailScreen from '../screens/CollectionDetailScreen';
import ShoppingListScreen from '../screens/ShoppingListScreen';
import SavedScreen from '../screens/SavedScreen';
import IngredientStudioScreen from '../screens/IngredientStudioScreen';
import SwapDetailScreen from '../screens/SwapDetailScreen';
import ProfileScreen from '../screens/ProfileScreen';
import AccountDetailsScreen from '../screens/AccountDetailsScreen';
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
  const { isLoggedIn, onboardingSeen } = useAuth();

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
      <Stack.Navigator
        initialRouteName={isLoggedIn ? 'MainTabs' : onboardingSeen ? 'Login' : 'Onboarding'}
        screenOptions={{ headerShown: false, animation: 'slide_from_right' }}
      >
        <Stack.Screen name="Onboarding" component={OnboardingScreen} />
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="MainTabs" component={MainTabs} />
        <Stack.Screen name="Assistant" component={AssistantScreen} />
        <Stack.Screen name="Search" component={DiscoverScreen} />
        <Stack.Screen name="RecipeDetail" component={RecipeDetailScreen} />
        <Stack.Screen
          name="CookMode"
          component={CookModeScreen}
          options={{ animation: 'slide_from_bottom' }}
        />
        <Stack.Screen name="MealPlan" component={MealPlanScreen} />
        <Stack.Screen name="CollectionDetail" component={CollectionDetailScreen} />
        <Stack.Screen name="Saved" component={SavedScreen} />
        <Stack.Screen name="Grocery" component={ShoppingListScreen} />
        <Stack.Screen
          name="SwapDetail"
          component={SwapDetailScreen}
          options={{ animation: 'slide_from_bottom' }}
        />
        <Stack.Screen name="IngredientStudio" component={IngredientStudioScreen} />
        <Stack.Screen name="Profile" component={ProfileScreen} />
        <Stack.Screen name="AccountDetails" component={AccountDetailsScreen} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen name="Security" component={SecurityScreen} />
        <Stack.Screen name="Notifications" component={NotificationsScreen} />
        <Stack.Screen name="HelpCenter" component={HelpCenterScreen} />
        <Stack.Screen name="About" component={AboutScreen} />
        <Stack.Screen name="Terms" component={TermsScreen} />
        <Stack.Screen name="Privacy" component={PrivacyScreen} />
        <Stack.Screen name="Licenses" component={LicensesScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
