import { Platform } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { TopNavbar } from '../../components/TopNavbar';
import { Colors } from '../../constants/Colors';

export default function TabsLayout() {
  const renderTabBar = Platform.OS === 'web'
    ? (props: BottomTabBarProps) => <TopNavbar {...props} />
    : undefined;

  return (
    <Tabs
      tabBar={renderTabBar}
      screenOptions={{
        headerShown: false,
        ...(Platform.OS === 'web' ? { tabBarPosition: 'top' as const } : null),
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textSecondary,
        tabBarStyle: Platform.OS === 'web'
          ? { display: 'none' }
          : {
              borderTopWidth: 1,
              borderTopColor: Colors.border,
              paddingBottom: 4,
              height: 60,
              backgroundColor: Colors.bg,
            },
      }}
    >
      <Tabs.Screen
        name="feed"
        options={{
          title: 'Feed',
          tabBarIcon: ({ color, size }: { color: string; size: number }) => (
            <Ionicons name="newspaper-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="index"
        options={{
          title: 'Map',
          tabBarIcon: ({ color, size }: { color: string; size: number }) => (
            <Ionicons name="map-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }: { color: string; size: number }) => (
            <Ionicons name="person-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
