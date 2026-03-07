import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Redirect, Tabs } from 'expo-router';
import React from 'react';

import { HapticTab } from '@/components/haptic-tab';
import { useAuth } from '@/contexts/AuthContext';
import { useAppTheme } from '@/hooks/use-app-theme';

export default function TabLayout() {
  const th = useAppTheme();
  const { status } = useAuth();

  if (status === 'unauthenticated') {
    return <Redirect href="/auth" />;
  }

  return (
    <Tabs
      sceneContainerStyle={{ backgroundColor: th.bg }}
      screenOptions={{
        tabBarActiveTintColor:   th.accent,
        tabBarInactiveTintColor: th.textSoft,
        tabBarStyle: {
          backgroundColor: th.tabBg,
          borderTopColor: th.divider,
          borderTopWidth: 1,
        },
        headerShown: false,
        tabBarButton: HapticTab,
        lazy: false,
        freezeOnBlur: false,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Chats',
          tabBarIcon: ({ color, focused }) => (
            <MaterialCommunityIcons
              name={focused ? 'message-text' : 'message-text-outline'}
              size={26}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="friends"
        options={{
          title: 'Friends',
          tabBarIcon: ({ color, focused }) => (
            <MaterialCommunityIcons
              name={focused ? 'account-plus' : 'account-plus-outline'}
              size={26}
              color={color}
            />
          ),
        }}
      />
    </Tabs>
  );
}
