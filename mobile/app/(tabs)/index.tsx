import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Platform, Keyboard, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import type BottomSheet from '@gorhom/bottom-sheet';
import { Colors, Font, Radius, Shadow, Space, Numeric } from '../../constants/theme';
import { useMapStore, selectVisible, NearbyItem } from '../../stores/mapStore';
import { useAuthStore } from '../../stores/authStore';
import SearchPanel from '../../components/map/SearchPanel';
import CompanyPanel, { PANEL_WIDTH, WIDE_BREAKPOINT } from '../../components/map/CompanyPanel';
import ResultsSheet, { SHEET_PEEK } from '../../components/map/ResultsSheet';

const MapView = Platform.OS === 'web'
  ? require('../../components/map/MapViewWeb').default
  : require('../../components/map/MapViewNative').default;


export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const wide = width >= WIDE_BREAKPOINT;

  const {
    userLocation, mapCenter, bounds, zoom, nearbyItems, selectedPin, filters, showMyClients,
    isLoadingPins, totalCompanies, routeCoords, routeInfo, mapFocus,
    setUserLocation, setViewport, setSelectedPin, clearRoute, focusMap,
    loadFromCache, loadAllPins, loadMyClientPins, fetchRoute,
  } = useMapStore();
  const accessToken = useAuthStore((s) => s.accessToken);

  const [gps, setGps] = useState<'idle' | 'watching' | 'denied'>('idle');
  const [deniedDismissed, setDeniedDismissed] = useState(false);
  const [panelExpanded, setPanelExpanded] = useState(false);
  const [containerH, setContainerH] = useState(0);
  const watchRef = useRef<Location.LocationSubscription | null>(null);
  const sheetRef = useRef<BottomSheet>(null);

  const visibleItems = useMemo(
    () => selectVisible(nearbyItems, filters, showMyClients),
    [nearbyItems, filters, showMyClients],
  );

  const industryCounts = useMemo(() => {
    const m = new Map<number, number>();
    for (const i of nearbyItems) if (i.industry_id) m.set(i.industry_id, (m.get(i.industry_id) ?? 0) + 1);
    return m;
  }, [nearbyItems]);

  const origin = userLocation || mapCenter;

  const startGPS = useCallback(async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') { setGps('denied'); return; }
    setGps('watching');
    try {
      watchRef.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, timeInterval: 5000, distanceInterval: 30 },
        (loc) => setUserLocation({ lat: loc.coords.latitude, lon: loc.coords.longitude }),
      );
    } catch {
      setGps('denied');
    }
  }, [setUserLocation]);

  useEffect(() => {
    loadFromCache();
    loadAllPins();
    startGPS();
    return () => { try { watchRef.current?.remove(); } catch { /* web */ } };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (accessToken) loadMyClientPins(); }, [accessToken]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectPin = useCallback((item: NearbyItem) => {
    setSelectedPin(item);
    sheetRef.current?.snapToIndex(0);
    if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
  }, [setSelectedPin]);

  const selectFromSearch = useCallback((item: NearbyItem) => {
    // Search results may not be in the loaded pin set (filtered out, or no verified location yet).
    const pin = nearbyItems.find((i) => i.id === item.id) ?? item;
    if (Number.isFinite(pin.lat)) focusMap(pin.lat, pin.lon, 15);
    selectPin(pin);
  }, [nearbyItems, focusMap, selectPin]);

  const routeTo = useCallback(async (item: NearbyItem) => {
    const from = userLocation || mapCenter;
    if (!from) return;
    await fetchRoute([from.lat, from.lon], [item.lat, item.lon]);
  }, [userLocation, mapCenter, fetchRoute]);

  const onGpsPress = () => {
    if (gps === 'watching' && userLocation) focusMap(userLocation.lat, userLocation.lon, 15);
    else startGPS();
  };

  const topOffset = insets.top + Space.md;
  const panelRight = selectedPin && wide ? (panelExpanded ? PANEL_WIDTH.expanded : PANEL_WIDTH.compact) + Space.md : 0;
  const fabBottom = SHEET_PEEK + Space.md;

  return (
    <View style={styles.container} onLayout={(e) => setContainerH(e.nativeEvent.layout.height)}>
      <MapView
        userLat={userLocation?.lat}
        userLon={userLocation?.lon}
        hasGPS={!!userLocation}
        nearbyItems={visibleItems}
        selectedPin={selectedPin}
        routeCoords={routeCoords}
        zoom={zoom}
        focus={mapFocus}
        overlayInsets={{
          top: wide ? Space.xl : topOffset + 110,
          bottom: !wide && selectedPin ? Math.round(height * 0.5) : SHEET_PEEK + Space.lg,
          right: panelRight,
        }}
        onPinPress={selectPin}
        onPress={() => {
          if (selectedPin) setSelectedPin(null);
          Keyboard.dismiss();
        }}
        onRegionChange={(lat: number, lon: number, z: number, b?: [number, number, number, number]) =>
          setViewport({ lat, lon }, z ?? zoom, b ?? bounds)}
      />

      <View
        style={[styles.top, { top: topOffset }, wide && styles.topWide]}
        pointerEvents="box-none"
      >
        <SearchPanel industryCounts={industryCounts} onSelectCompany={selectFromSearch} />

        {routeInfo && (
          <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)} style={styles.routePill}>
            <Ionicons name="git-branch" size={15} color="#fff" />
            <Text style={[styles.routeText, Numeric]}>
              {routeInfo.distance_km.toFixed(1)} km, about {Math.round(routeInfo.duration_min)} min by road
            </Text>
            <Pressable onPress={clearRoute} hitSlop={8}>
              <Text style={styles.routeClear}>Clear</Text>
            </Pressable>
          </Animated.View>
        )}

        {gps === 'denied' && !deniedDismissed && (
          <View style={styles.denied}>
            <Ionicons name="location-outline" size={15} color={Colors.danger} />
            <Text style={styles.deniedText}>
              Location is off, so distances use the map centre. Allow location access to sort by distance from you.
            </Text>
            <Pressable onPress={() => setDeniedDismissed(true)} hitSlop={10} accessibilityLabel="Dismiss">
              <Ionicons name="close" size={16} color={Colors.danger} />
            </Pressable>
          </View>
        )}
      </View>

      <Pressable
        accessibilityLabel={gps === 'watching' ? 'Centre on my location' : 'Turn on location'}
        onPress={onGpsPress}
        style={[styles.fab, { bottom: fabBottom, right: Space.lg + panelRight }, gps === 'watching' && styles.fabOn]}
      >
        <Ionicons
          name={gps === 'watching' ? 'locate' : 'locate-outline'}
          size={22}
          color={gps === 'watching' ? '#fff' : Colors.text}
        />
      </Pressable>

      <ResultsSheet
        ref={sheetRef}
        items={visibleItems}
        bounds={bounds}
        origin={origin}
        originIsUser={!!userLocation}
        selectedId={selectedPin?.id}
        loading={isLoadingPins}
        totalCompanies={totalCompanies}
        pinnedCompanies={nearbyItems.filter((i) => i.source === 'company').length}
        onSelect={(item) => { focusMap(item.lat, item.lon); selectPin(item); }}
      />

      {selectedPin && containerH > 0 && (
        <CompanyPanel
          key={wide ? 'wide' : 'narrow'}
          item={selectedPin}
          origin={userLocation}
          pool={visibleItems}
          topOffset={wide ? Space.md : topOffset}
          containerHeight={containerH}
          onClose={() => { setSelectedPin(null); setPanelExpanded(false); }}
          onRoute={routeTo}
          onSelect={(it) => { focusMap(it.lat, it.lon); setSelectedPin(it); }}
          onExpandedChange={setPanelExpanded}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bgSecondary },
  top: { position: 'absolute', left: Space.md, right: Space.md, zIndex: 20, gap: Space.sm },
  topWide: { right: undefined, width: 460 },
  routePill: {
    flexDirection: 'row', alignItems: 'center', gap: Space.sm, alignSelf: 'flex-start',
    backgroundColor: Colors.primary, borderRadius: Radius.pill,
    paddingHorizontal: 14, paddingVertical: 9,
    ...Shadow.md,
  },
  routeText: { fontFamily: Font.bold, fontSize: 13, color: '#fff' },
  routeClear: { fontFamily: Font.heavy, fontSize: 13, color: Colors.accent, marginLeft: 4 },
  denied: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Space.sm,
    backgroundColor: Colors.dangerSoft, borderRadius: Radius.md, padding: Space.md,
  },
  deniedText: { flex: 1, fontFamily: Font.semibold, fontSize: 12, lineHeight: 17, color: Colors.danger },
  fab: {
    position: 'absolute', right: Space.lg, width: 48, height: 48, borderRadius: 24,
    backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center', zIndex: 15,
    ...Shadow.md,
  },
  fabOn: { backgroundColor: Colors.primary },
});
