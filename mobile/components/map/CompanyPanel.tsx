/**
 * Company detail panel. Docked to the right on wide screens, to the bottom on phones.
 * Collapsed: identity, badges, actions, key facts, top Buys/Sells.
 * Expanded: everything we hold for the company — location, registration, contact, nearby companies.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet, Linking, Platform, useWindowDimensions,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, Easing, useReducedMotion, FadeIn,
} from 'react-native-reanimated';
import { Colors, Font, Radius, Shadow, Space, Type, Numeric } from '../../constants/theme';
import { INDUSTRY_BY_ID, INDUSTRY_BY_NAME } from '../../constants/industries';
import { useCompanyDetail } from '../../hooks/useCompanyDetail';
import { useMySellHsn, hsnOverlap } from '../../hooks/useMySellHsn';
import { haversineKm, formatDistance, formatINR } from '../../utils/geo';
import { displayName, placeCase } from './MapViewWeb';
import Skeleton from '../ui/Skeleton';
import type { NearbyItem } from '../../stores/mapStore';

export const PANEL_WIDTH = { compact: 384, expanded: 560 };
export const WIDE_BREAKPOINT = 900;

interface Props {
  item: NearbyItem;
  origin: { lat: number; lon: number } | null;
  pool: NearbyItem[];
  topOffset: number;
  containerHeight: number;
  onClose: () => void;
  onRoute: (item: NearbyItem) => void;
  onSelect: (item: NearbyItem) => void;
  onExpandedChange?: (expanded: boolean) => void;
}

function yearsSince(date: string | null) {
  if (!date) return null;
  const d = new Date(date);
  if (isNaN(+d)) return null;
  return { year: d.getFullYear(), age: Math.floor((Date.now() - +d) / (365.25 * 864e5)) };
}

function Fact({ label, value, wide }: { label: string; value: string | null; wide?: boolean }) {
  if (!value) return null;
  return (
    <View style={[styles.fact, wide && styles.factWide]}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={[styles.factValue, Numeric]} numberOfLines={wide ? 3 : 1}>{value}</Text>
    </View>
  );
}

function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {right}
      </View>
      {children}
    </View>
  );
}

function Chips({ items, tone, limit }: { items: string[]; tone: 'buy' | 'sell'; limit: number }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, limit);
  return (
    <View style={styles.chipWrap}>
      {shown.map((t) => (
        <View key={t} style={[styles.chip, tone === 'buy' ? styles.chipBuy : styles.chipSell]}>
          <Text style={[styles.chipText, tone === 'buy' && { color: Colors.accentInk }]}>{t}</Text>
        </View>
      ))}
      {items.length > limit && (
        <Pressable onPress={() => setAll(!all)} style={styles.chipMore}>
          <Text style={styles.chipMoreText}>{all ? 'Show fewer' : `${items.length - limit} more`}</Text>
        </Pressable>
      )}
    </View>
  );
}

function InfoLine({ icon, text, onPress, mono }: { icon: any; text?: string | null; onPress?: () => void; mono?: boolean }) {
  if (!text) return null;
  const body = (
    <View style={styles.infoLine}>
      <Ionicons name={icon} size={16} color={Colors.textSecondary} style={{ marginTop: 2 }} />
      <Text style={[styles.infoText, mono && Numeric, onPress && styles.link]} selectable>{text}</Text>
    </View>
  );
  return onPress ? <Pressable onPress={onPress}>{body}</Pressable> : body;
}

export default function CompanyPanel({
  item, origin, pool, topOffset, containerHeight, onClose, onRoute, onSelect, onExpandedChange,
}: Props) {
  const router = useRouter();
  const { width: screenW } = useWindowDimensions();
  const screenH = containerHeight;
  const wide = screenW >= WIDE_BREAKPOINT;
  const reduced = useReducedMotion();
  const [expanded, setExpanded] = useState(false);
  const isClient = item.source === 'my_client';
  const { data: d, loading, error } = useCompanyDetail(isClient ? null : String(item.id));
  const myHsn = useMySellHsn();

  // Animate width (wide) or height (phone) between collapsed and expanded.
  const size = useSharedValue(wide ? PANEL_WIDTH.compact : screenH * 0.46);
  useEffect(() => {
    const target = wide
      ? (expanded ? PANEL_WIDTH.expanded : PANEL_WIDTH.compact)
      : (expanded ? screenH - topOffset - Space.sm : screenH * 0.46);
    size.value = reduced ? target : withTiming(target, { duration: 260, easing: Easing.out(Easing.cubic) });
    onExpandedChange?.(expanded);
  }, [expanded, wide, screenH, topOffset]);
  const sizeStyle = useAnimatedStyle(() => (wide ? { width: size.value } : { height: size.value }));

  const industry =
    (item.industry_id && INDUSTRY_BY_ID.get(item.industry_id)) ||
    (d?.primary_industry ? INDUSTRY_BY_NAME.get(d.primary_industry) : undefined);
  const tint = isClient ? Colors.myClient : industry?.tint ?? Colors.primary;
  const dist = origin && Number.isFinite(item.lat) ? haversineKm(origin.lat, origin.lon, item.lat, item.lon) : null;
  const pinned = isClient || item.pinned !== false;
  const place = [placeCase(d?.city || item.city), placeCase(d?.state || item.state)].filter(Boolean).join(', ');
  const capital = d?.mca.paid_up_capital ?? item.capital ?? null;
  const inc = yearsSince(d?.mca.incorporated ?? null);
  const buys = d?.buy_categories ?? [];
  const sells = d?.sell_categories ?? [];
  const match = !isClient && hsnOverlap(myHsn, d?.buy_hsn);
  const phone = item.phone || d?.phone || null;
  const website = d?.website ? (/^https?:\/\//.test(d.website) ? d.website : `https://${d.website}`) : null;

  const nearby = useMemo(() => {
    if (!expanded || !Number.isFinite(item.lat)) return [];
    return pool
      .filter((p) => p.id !== item.id && Math.abs(p.lat - item.lat) < 0.2 && Math.abs(p.lon - item.lon) < 0.2)
      .map((p) => ({ p, d: haversineKm(item.lat, item.lon, p.lat, p.lon) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 5);
  }, [expanded, item.id, pool]);

  const directions = () => {
    if (!Number.isFinite(item.lat)) return;
    const url = Platform.OS === 'ios'
      ? `maps://?daddr=${item.lat},${item.lon}`
      : Platform.OS === 'web'
        ? `https://www.google.com/maps/dir/?api=1&destination=${item.lat},${item.lon}`
        : `google.navigation:q=${item.lat},${item.lon}`;
    Linking.openURL(url);
  };

  const actions = [
    pinned && { icon: 'git-branch-outline', label: 'Route', onPress: () => onRoute(item) },
    pinned && { icon: 'navigate', label: 'Directions', onPress: directions },
    phone && { icon: 'call', label: 'Call', onPress: () => Linking.openURL(`tel:${phone}`) },
    !isClient && { icon: 'business', label: 'Profile', primary: true, onPress: () => router.push(`/company/${item.id}`) },
  ].filter(Boolean) as { icon: any; label: string; onPress: () => void; primary?: boolean }[];

  const tierBadge = item.tier === 1 ? 'Top 300 by capital' : item.tier === 2 ? 'Top 3,000 by capital' : null;

  return (
    <Animated.View
      entering={reduced ? undefined : FadeIn.duration(180)}
      style={[
        styles.panel,
        wide
          ? { top: topOffset, right: Space.md, bottom: Space.md }
          : { left: Space.sm, right: Space.sm, bottom: Space.sm },
        sizeStyle,
      ]}
    >
      <View style={styles.toolbar}>
        <Pressable
          onPress={() => setExpanded(!expanded)}
          accessibilityLabel={expanded ? 'Show less' : 'Show all details'}
          style={styles.toolBtn}
        >
          <Ionicons
            name={wide ? (expanded ? 'contract-outline' : 'expand-outline') : (expanded ? 'chevron-down' : 'chevron-up')}
            size={17}
            color={Colors.text}
          />
          <Text style={styles.toolText}>{expanded ? 'Less' : 'More'}</Text>
        </Pressable>
        <Pressable onPress={onClose} accessibilityLabel="Close" style={styles.closeBtn}>
          <Ionicons name="close" size={18} color={Colors.text} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={[styles.tile, { backgroundColor: tint }]}>
            {d?.logo_url ? (
              <Image source={{ uri: d.logo_url }} style={styles.logo} contentFit="cover" />
            ) : isClient ? (
              <Ionicons name="briefcase" size={22} color="#fff" />
            ) : (
              <MaterialCommunityIcons name={(industry?.icon ?? 'domain') as any} size={24} color="#fff" />
            )}
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.name}>{displayName(item.name)}</Text>
            <Text style={styles.sub}>
              {[isClient ? 'Your client' : industry?.name, place].filter(Boolean).join(', ')}
            </Text>
          </View>
          {dist != null && (
            <View style={styles.distBox}>
              <Text style={[styles.dist, Numeric]}>{formatDistance(dist)}</Text>
              <Text style={styles.distLabel}>away</Text>
            </View>
          )}
        </View>

        <View style={styles.badges}>
          {match && (
            <View style={[styles.badge, { backgroundColor: Colors.accentSoft }]}>
              <MaterialCommunityIcons name="target" size={13} color={Colors.accentInk} />
              <Text style={[styles.badgeText, { color: Colors.accentInk }]}>Buys what you sell</Text>
            </View>
          )}
          {item.is_verified && (
            <View style={[styles.badge, { backgroundColor: Colors.successSoft }]}>
              <Ionicons name="shield-checkmark" size={13} color={Colors.verified} />
              <Text style={[styles.badgeText, { color: Colors.verified }]}>GST verified</Text>
            </View>
          )}
          {tierBadge && (
            <View style={[styles.badge, { backgroundColor: Colors.bgSecondary }]}>
              <MaterialCommunityIcons name="trophy-outline" size={13} color={Colors.text} />
              <Text style={styles.badgeText}>{tierBadge}</Text>
            </View>
          )}
          {!pinned && (
            <View style={[styles.badge, { backgroundColor: Colors.dangerSoft }]}>
              <Ionicons name="location-outline" size={13} color={Colors.danger} />
              <Text style={[styles.badgeText, { color: Colors.danger }]}>Location not verified yet</Text>
            </View>
          )}
        </View>

        <View style={styles.actions}>
          {actions.map((a) => (
            <Pressable
              key={a.label}
              onPress={a.onPress}
              style={({ pressed, hovered }: any) => [
                styles.action, a.primary && styles.actionPrimary, (pressed || hovered) && { opacity: 0.88 },
              ]}
            >
              <Ionicons name={a.icon} size={16} color={a.primary ? '#fff' : Colors.text} />
              <Text style={[styles.actionText, a.primary && { color: '#fff' }]}>{a.label}</Text>
            </Pressable>
          ))}
        </View>

        {isClient ? (
          <Section title="Last order">
            <View style={styles.facts}>
              <Fact label="Product" value={item.last_product_raw ?? null} wide />
              <Fact
                label="Date"
                value={item.last_order_date
                  ? new Date(item.last_order_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
                  : null}
              />
              <Fact label="Value" value={item.last_order_amount ? formatINR(item.last_order_amount) : null} />
            </View>
            <InfoLine icon="location-outline" text={item.address || null} />
          </Section>
        ) : loading ? (
          <View style={{ gap: 10, paddingTop: Space.sm }}>
            <Skeleton style={{ height: 56, borderRadius: Radius.md }} />
            <Skeleton style={{ width: '60%' }} />
            <Skeleton style={{ width: '80%' }} />
          </View>
        ) : error || !d ? (
          <Text style={styles.muted}>Details for this company couldn't be loaded. Check your connection and reopen it.</Text>
        ) : (
          <Animated.View entering={reduced ? undefined : FadeIn.duration(160)} style={{ gap: Space.lg }}>
            <View style={styles.facts}>
              <Fact label="Paid-up capital" value={capital ? formatINR(capital) : null} />
              <Fact label="Incorporated" value={inc ? `${inc.year}, ${inc.age} yrs` : null} />
              <Fact label="Company type" value={d.mca.class ? `${d.mca.class} company` : null} />
              <Fact label="Team size" value={d.employee_band ?? null} />
              {expanded && <Fact label="Registered activity" value={d.mca.activity} wide />}
            </View>

            <Section title="Buys">
              {buys.length
                ? <Chips items={buys} tone="buy" limit={expanded ? 12 : 3} />
                : <Text style={styles.muted}>No purchase categories listed.</Text>}
            </Section>
            <Section title="Sells">
              {sells.length
                ? <Chips items={sells} tone="sell" limit={expanded ? 12 : 3} />
                : <Text style={styles.muted}>No sales categories listed.</Text>}
            </Section>

            {!expanded ? (
              <Pressable onPress={() => setExpanded(true)} style={styles.moreBtn}>
                <Text style={styles.moreText}>Address, registration, contact and nearby companies</Text>
                <Ionicons name="chevron-forward" size={16} color={Colors.text} />
              </Pressable>
            ) : (
              <>
                <Section title="Location">
                  <InfoLine icon="location-outline" text={[d.address, d.pincode].filter(Boolean).join(' ')} />
                  <Text style={styles.caption}>
                    {d.pinned
                      ? d.geocode_precision === 'house'
                        ? 'Pinned at the building from its registered address.'
                        : 'Pinned at the street from its registered address.'
                      : 'Its registered address hasn’t been matched to a street yet, so it isn’t on the map.'}
                  </Text>
                </Section>

                <Section title="Registration">
                  <InfoLine icon="document-text-outline" text={d.mca.cin ? `CIN ${d.mca.cin}` : null} mono />
                  <InfoLine icon="receipt-outline" text={d.gstin ? `GSTIN ${d.gstin}` : null} mono />
                  {!d.mca.cin && !d.gstin && <Text style={styles.muted}>No registration numbers on file.</Text>}
                </Section>

                {(phone || d.email || website) && (
                  <Section title="Contact">
                    <InfoLine icon="call-outline" text={phone} onPress={() => Linking.openURL(`tel:${phone}`)} />
                    <InfoLine icon="mail-outline" text={d.email} onPress={() => Linking.openURL(`mailto:${d.email}`)} />
                    <InfoLine icon="globe-outline" text={d.website} onPress={() => website && Linking.openURL(website)} />
                  </Section>
                )}

                {nearby.length > 0 && (
                  <Section title="Nearby companies">
                    {nearby.map(({ p, d: km }) => {
                      const ind = p.industry_id ? INDUSTRY_BY_ID.get(p.industry_id) : undefined;
                      return (
                        <Pressable
                          key={p.id}
                          onPress={() => onSelect(p)}
                          style={({ hovered }: any) => [styles.nearRow, hovered && { backgroundColor: Colors.bgSecondary }]}
                        >
                          <View style={[styles.nearIcon, { backgroundColor: p.source === 'my_client' ? Colors.myClient : ind?.tint ?? Colors.primary }]}>
                            <MaterialCommunityIcons name={(ind?.icon ?? 'domain') as any} size={14} color="#fff" />
                          </View>
                          <Text style={styles.nearName} numberOfLines={1}>{displayName(p.name)}</Text>
                          <Text style={[styles.nearDist, Numeric]}>{formatDistance(km)}</Text>
                        </Pressable>
                      );
                    })}
                  </Section>
                )}
              </>
            )}
          </Animated.View>
        )}
      </ScrollView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute', zIndex: 40, backgroundColor: Colors.bg, borderRadius: Radius.lg,
    overflow: 'hidden', ...Shadow.lg,
  },
  toolbar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: Space.md, paddingTop: Space.md,
  },
  toolBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, height: 32, paddingHorizontal: 10,
    borderRadius: Radius.pill, backgroundColor: Colors.bgSecondary,
  },
  toolText: { fontFamily: Font.bold, fontSize: 12, color: Colors.text },
  closeBtn: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: Colors.bgSecondary,
    alignItems: 'center', justifyContent: 'center',
  },
  content: { padding: Space.lg, paddingTop: Space.md, gap: Space.lg },
  header: { flexDirection: 'row', gap: Space.md, alignItems: 'flex-start' },
  tile: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  logo: { width: 48, height: 48 },
  name: { ...Type.heading, fontSize: 19, lineHeight: 24, color: Colors.text },
  sub: { ...Type.body, fontSize: 13, color: Colors.textSecondary },
  distBox: { alignItems: 'flex-end' },
  dist: { fontFamily: Font.heavy, fontSize: 17, color: Colors.text },
  distLabel: { ...Type.caption, color: Colors.textSecondary },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: -Space.sm },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 5, borderRadius: Radius.pill },
  badgeText: { fontFamily: Font.bold, fontSize: 12, color: Colors.text },
  actions: { flexDirection: 'row', gap: Space.sm },
  action: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    height: 42, borderRadius: Radius.md, backgroundColor: Colors.bgSecondary,
  },
  actionPrimary: { backgroundColor: Colors.primary },
  actionText: { fontFamily: Font.bold, fontSize: 13, color: Colors.text },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  fact: {
    flexGrow: 1, flexBasis: '46%', backgroundColor: Colors.bgSecondary, borderRadius: Radius.sm,
    paddingHorizontal: 12, paddingVertical: 10, gap: 2,
  },
  factWide: { flexBasis: '100%' },
  factLabel: { ...Type.caption, color: Colors.textSecondary },
  factValue: { fontFamily: Font.bold, fontSize: 15, color: Colors.text },
  section: { gap: Space.sm },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { ...Type.title, color: Colors.text },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: Radius.sm },
  chipBuy: { backgroundColor: Colors.accentSoft },
  chipSell: { backgroundColor: Colors.bgSecondary },
  chipText: { fontFamily: Font.semibold, fontSize: 13, color: Colors.text },
  chipMore: { paddingHorizontal: 8, paddingVertical: 6 },
  chipMoreText: { fontFamily: Font.bold, fontSize: 13, color: Colors.textSecondary, textDecorationLine: 'underline' },
  moreBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.sm,
    borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 12,
  },
  moreText: { flex: 1, fontFamily: Font.semibold, fontSize: 13, color: Colors.text },
  infoLine: { flexDirection: 'row', gap: Space.sm, alignItems: 'flex-start' },
  infoText: { flex: 1, ...Type.body, color: Colors.text },
  link: { textDecorationLine: 'underline' },
  caption: { ...Type.caption, fontFamily: Font.regular, color: Colors.textSecondary },
  muted: { ...Type.body, color: Colors.textSecondary },
  nearRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, paddingVertical: 8, paddingHorizontal: 4, borderRadius: Radius.sm },
  nearIcon: { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  nearName: { flex: 1, fontFamily: Font.semibold, fontSize: 14, color: Colors.text },
  nearDist: { fontFamily: Font.bold, fontSize: 13, color: Colors.textSecondary },
});
