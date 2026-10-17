import { forwardRef, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BottomSheet, { BottomSheetFlatList } from '@gorhom/bottom-sheet';
import { Colors, Font, Radius, Shadow, Space, Type, Numeric } from '../../constants/theme';
import CompanyListItem, { LIST_ROW_HEIGHT } from './CompanyListItem';
import { haversineKm } from '../../utils/geo';
import type { NearbyItem } from '../../stores/mapStore';

export const SHEET_PEEK = 84;
const MAX_ROWS = 150;

interface Props {
  items: NearbyItem[];
  bounds: [number, number, number, number] | null;
  origin: { lat: number; lon: number } | null;
  originIsUser: boolean;
  selectedId?: string;
  loading: boolean;
  totalCompanies: number | null;
  pinnedCompanies: number;
  onSelect: (item: NearbyItem) => void;
  onChange?: (index: number) => void;
}

const ResultsSheet = forwardRef<BottomSheet, Props>(function ResultsSheet(
  { items, bounds, origin, originIsUser, selectedId, loading, totalCompanies, pinnedCompanies, onSelect, onChange }, ref,
) {
  const snapPoints = useMemo(() => [SHEET_PEEK, '45%', '88%'], []);

  const { rows, inView } = useMemo(() => {
    if (!bounds) return { rows: [] as { it: NearbyItem; d: number | null }[], inView: 0 };
    const [w, s, e, n] = bounds;
    const visible = items.filter((i) => i.lon >= w && i.lon <= e && i.lat >= s && i.lat <= n);
    const withD = visible.map((it) => ({
      it,
      d: origin ? haversineKm(origin.lat, origin.lon, it.lat, it.lon) : null,
    }));
    if (origin) withD.sort((a, b) => (a.d ?? 0) - (b.d ?? 0));
    return { rows: withD.slice(0, MAX_ROWS), inView: visible.length };
  }, [items, bounds, origin?.lat, origin?.lon]);

  const clients = rows.filter((r) => r.it.source === 'my_client').length;

  const unlocated = totalCompanies != null ? totalCompanies - pinnedCompanies : 0;
  const title = loading && !items.length
    ? 'Loading companies'
    : pinnedCompanies === 0 && unlocated > 0
      ? 'Locating companies'
      : inView === 0
        ? 'No companies in this area'
        : `${inView.toLocaleString('en-IN')} ${inView === 1 ? 'company' : 'companies'} in view`;

  return (
    <BottomSheet
      ref={ref}
      index={0}
      snapPoints={snapPoints}
      onChange={onChange}
      backgroundStyle={styles.bg}
      handleIndicatorStyle={styles.handle}
      enablePanDownToClose={false}
    >
      <View style={styles.header}>
        <Text style={[styles.title, Numeric]}>{title}</Text>
        {unlocated > 0 && (
          <View style={styles.notice}>
            <Ionicons name="location-outline" size={14} color={Colors.textSecondary} />
            <Text style={styles.noticeText}>
              {pinnedCompanies.toLocaleString('en-IN')} of {totalCompanies!.toLocaleString('en-IN')} companies have a
              verified street address and are on the map. The rest are still searchable and appear as they're located.
            </Text>
          </View>
        )}
        <Text style={styles.sub}>
          {inView === 0
            ? 'Zoom out or pan the map to find companies.'
            : inView > MAX_ROWS
              ? `Nearest ${MAX_ROWS} shown${clients ? `, including ${clients} of your clients` : ''}. Zoom in to narrow down.`
              : originIsUser ? 'Sorted by distance from you.' : 'Sorted by distance from the map centre.'}
        </Text>
      </View>
      <BottomSheetFlatList
        data={rows}
        keyExtractor={(r: { it: NearbyItem; d: number | null }) => String(r.it.id)}
        getItemLayout={(_: any, index: number) => ({ length: LIST_ROW_HEIGHT, offset: LIST_ROW_HEIGHT * index, index })}
        contentContainerStyle={styles.list}
        renderItem={({ item: r }: { item: { it: NearbyItem; d: number | null } }) => (
          <CompanyListItem
            item={r.it}
            distanceKm={r.d}
            selected={r.it.id === selectedId}
            onPress={() => onSelect(r.it)}
          />
        )}
      />
    </BottomSheet>
  );
});

export default ResultsSheet;

const styles = StyleSheet.create({
  bg: { backgroundColor: Colors.bg, borderRadius: Radius.lg, ...Shadow.lg },
  handle: { backgroundColor: Colors.border, width: 40 },
  header: { paddingHorizontal: Space.lg, paddingBottom: Space.sm, gap: 2 },
  title: { ...Type.title, fontFamily: Font.heavy, color: Colors.text },
  sub: { ...Type.caption, fontFamily: Font.regular, color: Colors.textSecondary },
  notice: {
    flexDirection: 'row', gap: 6, alignItems: 'flex-start', backgroundColor: Colors.bgSecondary,
    borderRadius: Radius.sm, padding: Space.sm, marginVertical: 4,
  },
  noticeText: { flex: 1, ...Type.caption, fontFamily: Font.regular, color: Colors.textSecondary },
  list: { paddingHorizontal: Space.xs, paddingBottom: Space.xxl },
});
