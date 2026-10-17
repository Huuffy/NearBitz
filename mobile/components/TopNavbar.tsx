import { View, Text, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter, usePathname } from 'expo-router';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useAuthStore } from '../stores/authStore';
import { Colors, Font, Radius, Space } from '../constants/theme';
import { confirmAction } from '../utils/notify';

const NAV = [
  { label: 'Map', icon: 'map' as const, route: '/(tabs)' as const, match: (p: string) => p === '/' },
  { label: 'Feed', icon: 'newspaper' as const, route: '/(tabs)/feed' as const, match: (p: string) => p.startsWith('/feed') },
  { label: 'Profile', icon: 'person' as const, route: '/(tabs)/profile' as const, match: (p: string) => p.startsWith('/profile') },
];

export function TopNavbar(_: BottomTabBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { width } = useWindowDimensions();
  const compact = width < 640;
  const { isAuthenticated, user, logout } = useAuthStore();

  const handleLogout = async () => {
    if (!(await confirmAction('Sign out', 'You will need to sign in again to see your clients.', 'Sign out'))) return;
    await logout();
    router.replace('/(auth)/login');
  };

  return (
    <View style={styles.wrapper}>
      <View style={[styles.navbar, compact && styles.navbarCompact]}>
        <Pressable style={styles.logo} onPress={() => router.replace('/(tabs)')} accessibilityLabel="GeoSales home">
          <View style={styles.mark}>
            <MaterialCommunityIcons name="map-marker" size={18} color={Colors.accent} />
          </View>
          {!compact && (
            <Text style={styles.logoText}>
              GeoSales<Text style={{ color: Colors.accent }}>.ai</Text>
            </Text>
          )}
        </Pressable>

        <View style={styles.links}>
          {NAV.map((item) => {
            const active = item.match(pathname);
            return (
              <Pressable
                key={item.label}
                onPress={() => router.push(item.route)}
                style={({ hovered }: any) => [styles.link, (active || hovered) && styles.linkActive]}
              >
                <Ionicons
                  name={active ? item.icon : (`${item.icon}-outline` as any)}
                  size={17}
                  color={active ? Colors.text : Colors.textSecondary}
                />
                <Text style={[styles.linkText, active && styles.linkTextActive]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {isAuthenticated ? (
          <View style={styles.user}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{(user?.full_name || '?').charAt(0).toUpperCase()}</Text>
            </View>
            {!compact && <Text style={styles.userName} numberOfLines={1}>{user?.full_name?.split(' ')[0]}</Text>}
            <Pressable onPress={handleLogout} hitSlop={8} accessibilityLabel="Sign out" style={styles.iconBtn}>
              <Ionicons name="log-out-outline" size={19} color={Colors.textSecondary} />
            </Pressable>
          </View>
        ) : (
          <Pressable style={styles.signIn} onPress={() => router.push('/(auth)/login')}>
            <Text style={styles.signInText}>Sign in</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { backgroundColor: Colors.bg, borderBottomWidth: 1, borderBottomColor: Colors.borderLight, zIndex: 100 },
  navbar: {
    flexDirection: 'row', alignItems: 'center', gap: Space.lg,
    paddingHorizontal: Space.xl, height: 56, width: '100%',
  },
  navbarCompact: { paddingHorizontal: Space.md, gap: Space.sm },
  logo: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  mark: {
    width: 30, height: 30, borderRadius: 9, backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  logoText: { fontFamily: Font.heavy, fontSize: 18, color: Colors.text, letterSpacing: -0.3 },
  links: { flex: 1, flexDirection: 'row', gap: 2, minWidth: 0 },
  link: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, height: 36, borderRadius: Radius.sm,
  },
  linkActive: { backgroundColor: Colors.bgSecondary },
  linkText: { fontFamily: Font.semibold, fontSize: 14, color: Colors.textSecondary },
  linkTextActive: { fontFamily: Font.bold, color: Colors.text },
  user: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  avatar: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: Colors.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontFamily: Font.heavy, fontSize: 13, color: Colors.accentInk },
  userName: { fontFamily: Font.semibold, fontSize: 14, color: Colors.text, maxWidth: 120 },
  iconBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  signIn: { backgroundColor: Colors.primary, paddingHorizontal: 16, height: 36, borderRadius: Radius.sm, justifyContent: 'center' },
  signInText: { fontFamily: Font.bold, fontSize: 14, color: '#fff' },
});
