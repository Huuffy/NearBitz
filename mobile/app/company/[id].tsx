import { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Linking, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn } from 'react-native-reanimated';
import { apiClient } from '../../services/api';
import { ENDPOINTS } from '../../constants/Api';
import { Colors, Font, Radius, Shadow, Space, Type, Numeric } from '../../constants/theme';
import { INDUSTRY_BY_NAME } from '../../constants/industries';
import { useMySellHsn, hsnOverlap } from '../../hooks/useMySellHsn';
import { formatINR } from '../../utils/geo';
import Skeleton from '../../components/ui/Skeleton';

type Tab = 'overview' | 'catalogue' | 'posts';

interface Company {
  id: string;
  name: string;
  description?: string;
  logo_url?: string;
  website?: string;
  phone?: string;
  email?: string;
  gstin?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  latitude?: number;
  longitude?: number;
  is_verified: boolean;
  feed_active: boolean;
  follower_count?: number;
  employee_band?: string;
  founded_year?: number;
  primary_industry?: string;
  industry_names?: string[];
  buy_categories?: string[];
  sell_categories?: string[];
  buy_hsn?: string[];
  products?: { id: string; name: string; description?: string; price_min?: number; price_max?: number; unit?: string; category_name?: string }[];
  posts?: { id: string; post_type: string; title?: string; content: string; like_count: number; comment_count: number; published_at: string }[];
}

function priceText(min?: number, max?: number, unit?: string) {
  if (!min && !max) return null;
  const range = min && max && min !== max ? `${formatINR(min)} to ${formatINR(max)}` : formatINR((min || max)!);
  return unit ? `${range} per ${unit}` : range;
}

function Chips({ items, tone }: { items: string[]; tone: 'buy' | 'sell' }) {
  return (
    <View style={styles.chipWrap}>
      {items.map((t) => (
        <View key={t} style={[styles.chip, tone === 'buy' ? styles.chipBuy : styles.chipSell]}>
          <Text style={[styles.chipText, tone === 'buy' && { color: Colors.accentInk }]}>{t}</Text>
        </View>
      ))}
    </View>
  );
}

function DetailRow({ label, value, mono }: { label: string; value?: string | number | null; mono?: boolean }) {
  if (value == null || value === '') return null;
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, mono && Numeric, mono && { letterSpacing: 0.5 }]} selectable>{value}</Text>
    </View>
  );
}

export default function CompanyProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const myHsn = useMySellHsn();
  const [tab, setTab] = useState<Tab>('overview');

  const { data: c, isLoading, error } = useQuery<Company>({
    queryKey: ['company', id],
    queryFn: async () => (await apiClient.get(ENDPOINTS.companies.detail(id))).data.data,
    enabled: !!id,
  });

  const back = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)'));

  if (isLoading) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <View style={[styles.band, { backgroundColor: Colors.border }]} />
        <View style={[styles.page, { gap: Space.md, padding: Space.xl }]}>
          <Skeleton style={{ width: 64, height: 64, borderRadius: Radius.md }} />
          <Skeleton style={{ width: '70%', height: 22 }} />
          <Skeleton style={{ width: '40%' }} />
          <Skeleton style={{ width: '100%', height: 90, borderRadius: Radius.md, marginTop: Space.lg }} />
        </View>
      </View>
    );
  }

  if (error || !c) {
    return (
      <View style={styles.centered}>
        <MaterialCommunityIcons name="office-building-marker-outline" size={40} color={Colors.textLight} />
        <Text style={styles.errorTitle}>This company isn't available</Text>
        <Text style={styles.errorBody}>It may have been removed or deactivated.</Text>
        <Pressable style={styles.primaryBtn} onPress={back}>
          <Text style={styles.primaryBtnText}>Back to map</Text>
        </Pressable>
      </View>
    );
  }

  const industry = c.primary_industry ? INDUSTRY_BY_NAME.get(c.primary_industry) : undefined;
  const tint = industry?.tint ?? Colors.primary;
  const buys = c.buy_categories ?? [];
  const sells = c.sell_categories ?? [];
  const match = hsnOverlap(myHsn, c.buy_hsn);
  const place = [c.city, c.state].filter(Boolean).join(', ');
  const hasPoint = c.latitude != null && c.longitude != null;
  const website = c.website && !/^https?:\/\//.test(c.website) ? `https://${c.website}` : c.website;

  const directions = () => {
    if (!hasPoint) return;
    const url = Platform.OS === 'ios'
      ? `maps://?daddr=${c.latitude},${c.longitude}`
      : `https://www.google.com/maps/dir/?api=1&destination=${c.latitude},${c.longitude}`;
    Linking.openURL(url);
  };

  const actions = [
    c.phone && { icon: 'call' as const, label: 'Call', onPress: () => Linking.openURL(`tel:${c.phone}`) },
    hasPoint && { icon: 'navigate' as const, label: 'Directions', onPress: directions },
    c.email && { icon: 'mail' as const, label: 'Email', onPress: () => Linking.openURL(`mailto:${c.email}`) },
    website && { icon: 'globe-outline' as const, label: 'Website', onPress: () => Linking.openURL(website!) },
  ].filter(Boolean) as { icon: any; label: string; onPress: () => void }[];

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'catalogue', label: 'Catalogue', count: c.products?.length ?? 0 },
    { key: 'posts', label: 'Posts', count: c.posts?.length ?? 0 },
  ];

  return (
    <View style={styles.screen}>
      <Pressable
        onPress={back}
        accessibilityLabel="Back"
        style={[styles.backBtn, { top: insets.top + Space.md }]}
      >
        <Ionicons name="arrow-back" size={20} color={Colors.text} />
      </Pressable>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 48 }}>
        <View style={[styles.band, { backgroundColor: tint, paddingTop: insets.top }]}>
          {industry && (
            <MaterialCommunityIcons name={industry.icon as any} size={120} color="rgba(255,255,255,0.12)" style={styles.bandGlyph} />
          )}
        </View>

        <Animated.View entering={FadeIn.duration(200)} style={styles.page}>
          <View style={styles.identity}>
            <View style={[styles.logo, { backgroundColor: tint }]}>
              {c.logo_url ? (
                <Image source={{ uri: c.logo_url }} style={styles.logoImg} contentFit="cover" />
              ) : (
                <MaterialCommunityIcons name={(industry?.icon ?? 'domain') as any} size={30} color="#fff" />
              )}
            </View>
            <Text style={styles.name}>{c.name}</Text>
            <Text style={styles.sub}>
              {[industry?.name ?? c.primary_industry, place].filter(Boolean).join(', ')}
            </Text>

            <View style={styles.badges}>
              {match && (
                <View style={[styles.badge, { backgroundColor: Colors.accentSoft }]}>
                  <MaterialCommunityIcons name="target" size={13} color={Colors.accentInk} />
                  <Text style={[styles.badgeText, { color: Colors.accentInk }]}>Buys what you sell</Text>
                </View>
              )}
              {c.is_verified && (
                <View style={[styles.badge, { backgroundColor: Colors.successSoft }]}>
                  <Ionicons name="shield-checkmark" size={13} color={Colors.verified} />
                  <Text style={[styles.badgeText, { color: Colors.verified }]}>GST verified</Text>
                </View>
              )}
              {c.feed_active && (
                <View style={[styles.badge, { backgroundColor: Colors.bgSecondary }]}>
                  <Ionicons name="pulse" size={13} color={Colors.text} />
                  <Text style={styles.badgeText}>Posting this month</Text>
                </View>
              )}
            </View>

            {actions.length > 0 && (
              <View style={styles.actions}>
                {actions.map((a, i) => (
                  <Pressable
                    key={a.label}
                    onPress={a.onPress}
                    style={({ pressed }) => [styles.action, i === 0 && styles.actionPrimary, pressed && { opacity: 0.85 }]}
                  >
                    <Ionicons name={a.icon} size={17} color={i === 0 ? '#fff' : Colors.text} />
                    <Text style={[styles.actionText, i === 0 && { color: '#fff' }]}>{a.label}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          <View style={styles.tabs}>
            {tabs.map((t) => (
              <Pressable key={t.key} onPress={() => setTab(t.key)} style={[styles.tab, tab === t.key && styles.tabOn]}>
                <Text style={[styles.tabText, tab === t.key && styles.tabTextOn]}>
                  {t.label}{t.count ? ` ${t.count}` : ''}
                </Text>
              </Pressable>
            ))}
          </View>

          {tab === 'overview' && (
            <View style={styles.sections}>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Buys</Text>
                {buys.length ? <Chips items={buys} tone="buy" /> : <Text style={styles.muted}>No purchase categories listed.</Text>}
              </View>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Sells</Text>
                {sells.length ? <Chips items={sells} tone="sell" /> : <Text style={styles.muted}>No sales categories listed.</Text>}
              </View>
              {c.description ? (
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>About</Text>
                  <Text style={styles.body}>{c.description}</Text>
                </View>
              ) : null}
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Details</Text>
                <DetailRow label="Address" value={[c.address, c.pincode].filter(Boolean).join(' ')} />
                <DetailRow label="GSTIN" value={c.gstin} mono />
                <DetailRow label="Industries" value={(c.industry_names ?? []).join(', ')} />
                <DetailRow label="Founded" value={c.founded_year} />
                <DetailRow label="Team size" value={c.employee_band} />
              </View>
            </View>
          )}

          {tab === 'catalogue' && (
            <View style={styles.sections}>
              {!c.products?.length ? (
                <View style={styles.empty}>
                  <MaterialCommunityIcons name="package-variant" size={32} color={Colors.textLight} />
                  <Text style={styles.muted}>This company hasn't published a catalogue yet. Its Buys and Sells categories are on the Overview tab.</Text>
                </View>
              ) : c.products.map((p) => (
                <View key={p.id} style={styles.card}>
                  <View style={styles.productHead}>
                    <Text style={styles.productName}>{p.name}</Text>
                    {priceText(p.price_min, p.price_max, p.unit) && (
                      <Text style={[styles.price, Numeric]}>{priceText(p.price_min, p.price_max, p.unit)}</Text>
                    )}
                  </View>
                  {p.category_name ? <Text style={styles.caption}>{p.category_name}</Text> : null}
                  {p.description ? <Text style={styles.body} numberOfLines={3}>{p.description}</Text> : null}
                </View>
              ))}
            </View>
          )}

          {tab === 'posts' && (
            <View style={styles.sections}>
              {!c.posts?.length ? (
                <View style={styles.empty}>
                  <MaterialCommunityIcons name="newspaper-variant-outline" size={32} color={Colors.textLight} />
                  <Text style={styles.muted}>No posts from this company yet.</Text>
                </View>
              ) : c.posts.map((post) => (
                <View key={post.id} style={styles.card}>
                  <Text style={styles.caption}>
                    {post.post_type.replace(/_/g, ' ')}, {new Date(post.published_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  </Text>
                  {post.title ? <Text style={styles.productName}>{post.title}</Text> : null}
                  <Text style={styles.body} numberOfLines={4}>{post.content}</Text>
                </View>
              ))}
            </View>
          )}
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bgSecondary },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Space.xl, gap: Space.sm },
  errorTitle: { ...Type.heading, color: Colors.text, textAlign: 'center' },
  errorBody: { ...Type.body, color: Colors.textSecondary, textAlign: 'center', marginBottom: Space.md },
  primaryBtn: { backgroundColor: Colors.primary, borderRadius: Radius.md, paddingHorizontal: 20, height: 44, justifyContent: 'center' },
  primaryBtnText: { fontFamily: Font.bold, fontSize: 14, color: '#fff' },
  backBtn: {
    position: 'absolute', left: Space.lg, zIndex: 10, width: 40, height: 40, borderRadius: 20,
    backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center', ...Shadow.md,
  },
  band: { height: 132, overflow: 'hidden' },
  bandGlyph: { position: 'absolute', right: -10, bottom: -24 },
  page: { width: '100%', maxWidth: 820, alignSelf: 'center', paddingHorizontal: Space.lg },
  identity: {
    backgroundColor: Colors.bg, borderRadius: Radius.lg, padding: Space.xl, marginTop: -48, gap: Space.sm,
    ...Shadow.md,
  },
  logo: {
    width: 64, height: 64, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden', marginBottom: Space.xs,
  },
  logoImg: { width: 64, height: 64 },
  name: { ...Type.display, fontSize: 24, lineHeight: 30, color: Colors.text },
  sub: { ...Type.body, color: Colors.textSecondary },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: Space.xs },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: Radius.pill },
  badgeText: { fontFamily: Font.bold, fontSize: 12, color: Colors.text },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm, marginTop: Space.md },
  action: {
    flexDirection: 'row', alignItems: 'center', gap: 6, height: 42, paddingHorizontal: 16,
    borderRadius: Radius.md, backgroundColor: Colors.bgSecondary,
  },
  actionPrimary: { backgroundColor: Colors.primary },
  actionText: { fontFamily: Font.bold, fontSize: 14, color: Colors.text },
  tabs: { flexDirection: 'row', gap: Space.xs, marginTop: Space.xl, marginBottom: Space.md },
  tab: { paddingHorizontal: 14, height: 36, borderRadius: Radius.pill, justifyContent: 'center' },
  tabOn: { backgroundColor: Colors.primary },
  tabText: { fontFamily: Font.bold, fontSize: 14, color: Colors.textSecondary },
  tabTextOn: { color: '#fff' },
  sections: { gap: Space.md },
  card: { backgroundColor: Colors.bg, borderRadius: Radius.md, padding: Space.lg, gap: Space.sm, ...Shadow.sm },
  cardTitle: { ...Type.title, color: Colors.text },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: Radius.sm },
  chipBuy: { backgroundColor: Colors.accentSoft },
  chipSell: { backgroundColor: Colors.bgSecondary },
  chipText: { fontFamily: Font.semibold, fontSize: 13, color: Colors.text },
  body: { ...Type.body, color: Colors.textSecondary },
  muted: { ...Type.body, color: Colors.textSecondary, textAlign: 'center' },
  caption: { ...Type.caption, color: Colors.textSecondary, textTransform: 'capitalize' },
  detailRow: { flexDirection: 'row', gap: Space.md, paddingVertical: 8, borderTopWidth: 1, borderTopColor: Colors.borderLight },
  detailLabel: { width: 96, ...Type.caption, fontSize: 13, color: Colors.textSecondary },
  detailValue: { flex: 1, ...Type.body, color: Colors.text },
  productHead: { flexDirection: 'row', justifyContent: 'space-between', gap: Space.md },
  productName: { ...Type.bodyStrong, color: Colors.text, flex: 1 },
  price: { fontFamily: Font.bold, fontSize: 13, color: Colors.text },
  empty: { alignItems: 'center', gap: Space.sm, padding: Space.xxl },
});
