import { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet, ActivityIndicator, Keyboard,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { Colors, Font, Radius, Shadow, Space, Type, Numeric } from '../../constants/theme';
import { INDUSTRIES, INDUSTRY_BY_ID } from '../../constants/industries';
import { useMapStore, NearbyItem, ProductHit, PlaceHit } from '../../stores/mapStore';
import { formatDistance } from '../../utils/geo';

interface Props {
  industryCounts: Map<number, number>;
  onSelectCompany: (item: NearbyItem) => void;
}

// Splits `text` around the first case-insensitive occurrence of `q` so it can be emphasised.
function Highlight({ text, q, style }: { text: string; q: string; style: any }) {
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return <Text style={style} numberOfLines={1}>{text}</Text>;
  return (
    <Text style={style} numberOfLines={1}>
      {text.slice(0, i)}
      <Text style={{ fontFamily: Font.heavy, color: Colors.text }}>{text.slice(i, i + q.length)}</Text>
      {text.slice(i + q.length)}
    </Text>
  );
}

function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.section}>{children}</Text>;
}

export default function SearchPanel({ industryCounts, onSelectCompany }: Props) {
  const {
    searchQuery, setSearchQuery, runSearch, isSearching,
    searchCompanies, searchProducts, searchPlaces, recentSearches, addRecentSearch,
    filters, setIndustry, setVerifiedOnly, showMyClients, setShowMyClients,
    applyCategory, clearCategory, focusMap, nearbyItems,
  } = useMapStore();
  const [focused, setFocused] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<TextInput>(null);
  const hasClients = nearbyItems.some((i) => i.source === 'my_client');

  useEffect(() => () => { if (debounce.current) clearTimeout(debounce.current); }, []);

  const onChange = (text: string) => {
    setSearchQuery(text);
    setFocused(true);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => runSearch(text), 250);
  };

  const close = () => {
    setFocused(false);
    inputRef.current?.blur();
    Keyboard.dismiss();
  };

  const clear = () => {
    setSearchQuery('');
    runSearch('');
  };

  const pickCompany = (c: NearbyItem) => {
    addRecentSearch(searchQuery);
    onSelectCompany(c);
    close();
  };

  const pickPlace = (p: PlaceHit) => {
    addRecentSearch(searchQuery);
    focusMap(p.lat, p.lon, 12);
    close();
  };

  const pickProduct = (p: ProductHit, kind: 'buy' | 'sell') => {
    addRecentSearch(searchQuery);
    applyCategory(p, kind);
    clear();
    close();
  };

  const q = searchQuery.trim();
  const showDropdown = focused && (q.length >= 2 || recentSearches.length > 0);
  const noResults = q.length >= 2 && !isSearching
    && !searchCompanies.length && !searchProducts.length && !searchPlaces.length;

  const industryChips = INDUSTRIES.filter((i) => (industryCounts.get(i.id) ?? 0) > 0);

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={[styles.bar, focused && styles.barFocused]}>
        <Ionicons name="search" size={18} color={Colors.textSecondary} />
        <TextInput
          ref={inputRef}
          style={styles.input}
          placeholder="Company, product, HSN code or city"
          placeholderTextColor={Colors.textLight}
          value={searchQuery}
          onChangeText={onChange}
          onFocus={() => setFocused(true)}
          returnKeyType="search"
          onSubmitEditing={() => { if (searchCompanies[0]) pickCompany(searchCompanies[0]); }}
          autoCorrect={false}
        />
        {isSearching ? (
          <ActivityIndicator size="small" color={Colors.textSecondary} />
        ) : q.length > 0 ? (
          <Pressable onPress={clear} hitSlop={8} accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={18} color={Colors.textLight} />
          </Pressable>
        ) : null}
        {focused && (
          <Pressable onPress={close} hitSlop={8} style={styles.cancel}>
            <Text style={styles.cancelText}>Done</Text>
          </Pressable>
        )}
      </View>

      {showDropdown ? (
        <Animated.View entering={FadeIn.duration(140)} exiting={FadeOut.duration(100)} style={styles.dropdown}>
          <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 420 }}>
            {q.length < 2 && recentSearches.length > 0 && (
              <>
                <SectionLabel>Recent</SectionLabel>
                {recentSearches.map((r) => (
                  <Pressable key={r} style={styles.row} onPress={() => onChange(r)}>
                    <Ionicons name="time-outline" size={16} color={Colors.textSecondary} />
                    <Text style={styles.rowTitle} numberOfLines={1}>{r}</Text>
                  </Pressable>
                ))}
              </>
            )}

            {searchProducts.length > 0 && (
              <>
                <SectionLabel>Products</SectionLabel>
                {searchProducts.slice(0, 4).map((p) => (
                  <View key={p.id} style={styles.productRow}>
                    <View style={styles.hsn}><Text style={[styles.hsnText, Numeric]}>{p.hsn}</Text></View>
                    <Text style={styles.productLabel} numberOfLines={2}>{p.label}</Text>
                    <View style={styles.productActions}>
                      {p.buyers > 0 && (
                        <Pressable style={[styles.kindBtn, styles.kindBuy]} onPress={() => pickProduct(p, 'buy')}>
                          <Text style={[styles.kindText, { color: Colors.accentInk }, Numeric]}>
                            {p.buyers.toLocaleString('en-IN')} buy
                          </Text>
                        </Pressable>
                      )}
                      {p.sellers > 0 && (
                        <Pressable style={styles.kindBtn} onPress={() => pickProduct(p, 'sell')}>
                          <Text style={[styles.kindText, Numeric]}>{p.sellers.toLocaleString('en-IN')} sell</Text>
                        </Pressable>
                      )}
                    </View>
                  </View>
                ))}
              </>
            )}

            {searchCompanies.length > 0 && (
              <>
                <SectionLabel>Companies</SectionLabel>
                {searchCompanies.slice(0, 8).map((c) => {
                  const ind = c.industry_id ? INDUSTRY_BY_ID.get(c.industry_id) : undefined;
                  return (
                    <Pressable key={c.id} style={styles.row} onPress={() => pickCompany(c)}>
                      <View style={[styles.rowIcon, { backgroundColor: ind?.tint ?? Colors.primary }]}>
                        <MaterialCommunityIcons name={(ind?.icon ?? 'domain') as any} size={14} color="#fff" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Highlight text={c.name} q={q} style={styles.rowTitle} />
                        <Text style={styles.rowSub} numberOfLines={1}>{c.city}{c.state ? `, ${c.state}` : ''}</Text>
                      </View>
                      {c.distance_km ? (
                        <Text style={[styles.rowDist, Numeric]}>{formatDistance(c.distance_km)}</Text>
                      ) : null}
                    </Pressable>
                  );
                })}
              </>
            )}

            {searchPlaces.length > 0 && (
              <>
                <SectionLabel>Places</SectionLabel>
                {searchPlaces.map((p) => (
                  <Pressable key={`${p.city}-${p.state}`} style={styles.row} onPress={() => pickPlace(p)}>
                    <View style={[styles.rowIcon, { backgroundColor: Colors.bgSecondary }]}>
                      <Ionicons name="location" size={14} color={Colors.text} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle} numberOfLines={1}>{p.city}</Text>
                      <Text style={styles.rowSub} numberOfLines={1}>
                        {p.state}, {p.companies.toLocaleString('en-IN')} companies
                      </Text>
                    </View>
                  </Pressable>
                ))}
              </>
            )}

            {noResults && (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>Nothing matches "{q}"</Text>
                <Text style={styles.emptyBody}>Try a shorter name, a product like "cement", or an HSN code like 7213.</Text>
              </View>
            )}
          </ScrollView>
        </Animated.View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
          style={styles.chipScroll}
        >
          {filters.category && (
            <Pressable style={[styles.chip, styles.chipCategory]} onPress={clearCategory}>
              <MaterialCommunityIcons name="filter-variant" size={14} color="#fff" />
              <Text style={[styles.chipText, { color: '#fff' }]} numberOfLines={1}>
                {filters.category.kind === 'buy' ? 'Buys' : 'Sells'} {filters.category.label.slice(0, 28)}
              </Text>
              <Ionicons name="close" size={14} color="#fff" />
            </Pressable>
          )}
          {hasClients && (
            <Pressable
              style={[styles.chip, showMyClients && styles.chipClient]}
              onPress={() => setShowMyClients(!showMyClients)}
            >
              <Ionicons name="briefcase" size={13} color={showMyClients ? '#fff' : Colors.myClient} />
              <Text style={[styles.chipText, showMyClients && { color: '#fff' }]}>My clients</Text>
            </Pressable>
          )}
          <Pressable
            style={[styles.chip, filters.verifiedOnly && styles.chipActive]}
            onPress={() => setVerifiedOnly(!filters.verifiedOnly)}
          >
            <Ionicons name="shield-checkmark" size={13} color={filters.verifiedOnly ? '#fff' : Colors.verified} />
            <Text style={[styles.chipText, filters.verifiedOnly && { color: '#fff' }]}>Verified</Text>
          </Pressable>
          {industryChips.map((ind) => {
            const on = filters.industryId === ind.id;
            return (
              <Pressable
                key={ind.id}
                style={[styles.chip, on && { backgroundColor: ind.tint, borderColor: ind.tint }]}
                onPress={() => setIndustry(on ? null : ind.id)}
              >
                <MaterialCommunityIcons name={ind.icon as any} size={14} color={on ? '#fff' : ind.tint} />
                <Text style={[styles.chipText, on && { color: '#fff' }]}>{ind.short}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Space.sm },
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: Space.sm,
    backgroundColor: Colors.bg, borderRadius: Radius.md,
    paddingHorizontal: Space.md, height: 48,
    borderWidth: 1.5, borderColor: 'transparent',
    ...Shadow.md,
  },
  barFocused: { borderColor: Colors.primary },
  input: {
    flex: 1, fontFamily: Font.semibold, fontSize: 15, color: Colors.text,
    paddingVertical: 0, outlineStyle: 'none',
  } as any,
  cancel: { paddingLeft: 4 },
  cancelText: { fontFamily: Font.bold, fontSize: 13, color: Colors.text },
  dropdown: {
    backgroundColor: Colors.bg, borderRadius: Radius.md, paddingVertical: Space.sm, overflow: 'hidden',
    ...Shadow.lg,
  },
  section: {
    ...Type.caption, color: Colors.textSecondary,
    paddingHorizontal: Space.lg, paddingTop: Space.md, paddingBottom: Space.xs,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Space.md,
    paddingHorizontal: Space.lg, paddingVertical: 10,
  },
  rowIcon: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontFamily: Font.semibold, fontSize: 14, color: Colors.textSecondary },
  rowSub: { ...Type.caption, fontFamily: Font.regular, color: Colors.textSecondary },
  rowDist: { fontFamily: Font.bold, fontSize: 12, color: Colors.text },
  productRow: {
    flexDirection: 'row', alignItems: 'center', gap: Space.md,
    paddingHorizontal: Space.lg, paddingVertical: 8,
  },
  hsn: {
    minWidth: 46, paddingHorizontal: 6, paddingVertical: 4, borderRadius: 6,
    backgroundColor: Colors.primary, alignItems: 'center',
  },
  hsnText: { fontFamily: Font.bold, fontSize: 12, color: '#fff' },
  productLabel: { flex: 1, fontFamily: Font.semibold, fontSize: 13, color: Colors.text },
  productActions: { flexDirection: 'row', gap: 6 },
  kindBtn: {
    paddingHorizontal: 8, paddingVertical: 5, borderRadius: Radius.sm, backgroundColor: Colors.bgSecondary,
  },
  kindBuy: { backgroundColor: Colors.accentSoft },
  kindText: { fontFamily: Font.bold, fontSize: 11, color: Colors.text },
  empty: { padding: Space.lg, gap: 4 },
  emptyTitle: { ...Type.bodyStrong, color: Colors.text },
  emptyBody: { ...Type.body, color: Colors.textSecondary },
  chipScroll: { flexGrow: 0 },
  chips: { gap: 6, paddingRight: Space.lg },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    height: 34, paddingHorizontal: 12, borderRadius: Radius.pill,
    backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.border,
    ...Shadow.sm,
  },
  chipActive: { backgroundColor: Colors.verified, borderColor: Colors.verified },
  chipClient: { backgroundColor: Colors.myClient, borderColor: Colors.myClient },
  chipCategory: { backgroundColor: Colors.primary, borderColor: Colors.primary, maxWidth: 280 },
  chipText: { fontFamily: Font.bold, fontSize: 12, color: Colors.text },
});
