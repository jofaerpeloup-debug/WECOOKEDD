import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import TabBar from '../components/TabBar';

import DashboardScreen from '../screens/DashboardScreen';
import CommunityScreen from '../screens/CommunityScreen';
import IngredientStudioScreen from '../screens/IngredientStudioScreen';
import ProfileScreen from '../screens/ProfileScreen';

const Tab = createBottomTabNavigator();

// UI-FINAL1 keeps these four registered routes while the pinned 4ffd47d
// reference supplies the floating TabBar appearance.
// Verified against teammate WECOOKEDD @ c1c86ed (src/navigation/MainTabs.js):
// FOUR Tab.Screen routes only — Home | Community | Swaps | Profile.
//
// The visual five-slot bar (Home | Community | chef | Swaps | Profile) is NOT five
// routes: the centre chef icon is an action button living in <TabBar> that
// opens <PlusMenu>. It is deliberately not registered here as a Tab.Screen.
//
// Discover, Assistant and Saved are no longer tabs — they moved to the root
// stack (see RootNavigator.js) and stay reachable from Dashboard/Search/Profile
// flows and from PlusMenu.
export default function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{ headerShown: false, tabBarHideOnKeyboard: true }}
      tabBar={(props) => <TabBar {...props} />}
    >
      <Tab.Screen name="Home" component={DashboardScreen} />
      <Tab.Screen name="Community" component={CommunityScreen} />
      <Tab.Screen name="Swaps" component={IngredientStudioScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}
