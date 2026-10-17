/**
 * Web map — react-map-gl + MapLibre GL JS.
 *
 * Pins are GeoJSON features drawn by WebGL symbol layers, so they stay fixed to their coordinates.
 * Instead of count bubbles, companies are ranked by MCA paid-up capital (Google-Maps style):
 * each capital tier appears from its own zoom level, and when pins collide MapLibre keeps the
 * higher-ranked one, so zooming in progressively reveals smaller companies.
 */
import { useEffect, useRef, useMemo, useCallback } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/Colors';
import { INDUSTRIES } from '../../constants/industries';
import type { NearbyItem, MapFocus } from '../../stores/mapStore';

let ReactMapGL: any = null;
let MaplibreGL: any = null;
try {
  ReactMapGL = require('react-map-gl/maplibre');
  MaplibreGL = require('maplibre-gl');
} catch { /* not installed */ }

const OPENFREE_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const DEFAULT_LAT = 20.5937;
const DEFAULT_LON = 78.9629;

export const PIN_COLORS = {
  company: '#14202E',
  client: '#D64545',
  selected: '#F29F05',
  me: '#1F8A70',
};

// tier → zoom at which that tier starts to appear, and zoom from which its names are labelled
const TIERS = [
  { tier: 1, minzoom: 0, labelFrom: 5 },
  { tier: 2, minzoom: 6, labelFrom: 9 },
  { tier: 3, minzoom: 8.5, labelFrom: 12 },
  { tier: 4, minzoom: 10.5, labelFrom: 14 },
];
const PIN_LAYER_IDS = ['pins-client', ...TIERS.map((t) => `pins-t${t.tier}`)];

export interface MapViewWebProps {
  userLat?: number;
  userLon?: number;
  hasGPS?: boolean;
  nearbyItems?: NearbyItem[];
  selectedPin?: NearbyItem | null;
  routeCoords?: [number, number][] | null;
  zoom?: number;
  focus?: MapFocus | null;
  // Screen-space area covered by overlays — the selected pin is kept clear of it.
  overlayInsets?: { top: number; bottom: number; right?: number };
  onPress?: (coords: { lat: number; lon: number }) => void;
  onRegionChange?: (lat: number, lon: number, zoom: number, bounds?: [number, number, number, number]) => void;
  onPinPress?: (item: NearbyItem) => void;
}

function boundsOf(map: any): [number, number, number, number] {
  const b = map.getBounds();
  return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
}

const SUFFIXES: [RegExp, string][] = [
  [/\s*\bprivate limited\b\.?$/i, ' Pvt Ltd'],
  [/\s*\bpvt\.? ?ltd\.?$/i, ' Pvt Ltd'],
  [/\s*\blimited\b\.?$/i, ' Ltd'],
];

// Official names keep their casing (NTPC, JSW…); only the legal suffix is shortened.
export function displayName(raw: string) {
  let s = raw.trim().replace(/\s+/g, ' ');
  for (const [re, rep] of SUFFIXES) s = s.replace(re, rep);
  return s;
}

// "NEW DELHI" / "delhi" → "New Delhi" / "Delhi" for place names only.
export function placeCase(raw?: string | null) {
  if (!raw) return '';
  return raw.trim().toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

// Teardrop pin drawn on a canvas at 2x; the tip sits at bottom-centre.
function makePinImage(fill: string, size: number) {
  const ratio = 2;
  const w = size * ratio;
  const h = Math.round(size * 1.3) * ratio;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const r = w / 2 - 2.5 * ratio;
  const cx = w / 2;
  const cy = r + 2.5 * ratio;
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI * 0.82, Math.PI * 0.18, false);
  ctx.lineTo(cx, h - 1.5 * ratio);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 1.8 * ratio;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.36, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  return { image: ctx.getImageData(0, 0, w, h), pixelRatio: ratio };
}

const PIN_DEFS: Record<string, { color: string; size: number }> = (() => {
  const d: Record<string, { color: string; size: number }> = {
    'pin-company': { color: PIN_COLORS.company, size: 20 },
    'pin-company-lg': { color: PIN_COLORS.company, size: 28 },
    'pin-client': { color: PIN_COLORS.client, size: 22 },
    'pin-selected': { color: PIN_COLORS.selected, size: 34 },
  };
  for (const ind of INDUSTRIES) {
    d[`pin-ind-${ind.id}`] = { color: ind.tint, size: 20 };
    d[`pin-ind-${ind.id}-lg`] = { color: ind.tint, size: 28 };
  }
  return d;
})();

const EMPTY_IMAGE = { width: 1, height: 1, data: new Uint8Array(4) };

function addImageIfMissing(map: any, name: string) {
  if (map.hasImage(name)) return;
  const def = PIN_DEFS[name];
  if (def) {
    const { image, pixelRatio } = makePinImage(def.color, def.size);
    map.addImage(name, image, { pixelRatio });
  } else {
    // Basemap sprites the OpenFreeMap style references but doesn't ship (atm, office, …).
    map.addImage(name, EMPTY_IMAGE);
  }
}

function pinImageName(it: NearbyItem) {
  if (it.source === 'my_client') return 'pin-client';
  const lg = it.tier === 1 ? '-lg' : '';
  return it.industry_id ? `pin-ind-${it.industry_id}${lg}` : `pin-company${lg}`;
}

export default function MapViewWeb({
  userLat,
  userLon,
  hasGPS = false,
  nearbyItems = [],
  selectedPin,
  routeCoords,
  zoom = 5,
  focus,
  overlayInsets = { top: 120, bottom: 120, right: 0 },
  onPress,
  onRegionChange,
  onPinPress,
}: MapViewWebProps) {
  const safeLat = (typeof userLat === 'number' && !isNaN(userLat)) ? userLat : DEFAULT_LAT;
  const safeLon = (typeof userLon === 'number' && !isNaN(userLon)) ? userLon : DEFAULT_LON;

  const mapRef = useRef<any>(null);
  const mapLoadedRef = useRef(false);
  const hasFlewToGPSRef = useRef(false);
  const initialZoomRef = useRef(zoom);
  const padding = {
    top: overlayInsets.top, bottom: overlayInsets.bottom, left: 0, right: overlayInsets.right ?? 0,
  };

  const itemsById = useMemo(() => {
    const m = new Map<string, NearbyItem>();
    for (const it of nearbyItems) m.set(String(it.id), it);
    return m;
  }, [nearbyItems]);

  const pinsGeoJSON = useMemo(() => {
    // rank 0 = largest paid-up capital; lower sort keys are placed first and win collisions
    const ranked = nearbyItems
      .filter((it) => Number.isFinite(it.lat) && Number.isFinite(it.lon))
      .sort((a, b) => (b.capital ?? -1) - (a.capital ?? -1));
    return {
      type: 'FeatureCollection' as const,
      features: ranked.map((it, rank) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [it.lon, it.lat] },
        properties: {
          id: String(it.id),
          src: it.source === 'my_client' ? 'client' : 'company',
          tier: it.source === 'my_client' ? 0 : it.tier ?? 4,
          rank,
          img: pinImageName(it),
          label: displayName(it.name),
        },
      })),
    };
  }, [nearbyItems]);

  const selectedGeoJSON = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: selectedPin && Number.isFinite(selectedPin.lat) ? [{
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [selectedPin.lon, selectedPin.lat] },
      properties: { id: String(selectedPin.id), label: displayName(selectedPin.name) },
    }] : [],
  }), [selectedPin]);

  const meGeoJSON = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: hasGPS ? [{
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [safeLon, safeLat] },
      properties: {},
    }] : [],
  }), [hasGPS, safeLat, safeLon]);

  const routeGeoJSON = useMemo(() =>
    routeCoords && routeCoords.length > 1 ? {
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'LineString' as const, coordinates: routeCoords.map(([lat, lon]) => [lon, lat]) },
    } : null,
    [routeCoords]
  );

  // Fly to the user's location once, on the first real GPS fix.
  useEffect(() => {
    if (!hasGPS || hasFlewToGPSRef.current || !mapLoadedRef.current) return;
    const map = mapRef.current?.getMap?.();
    if (!map) return;
    hasFlewToGPSRef.current = true;
    map.flyTo({ center: [safeLon, safeLat], zoom: 13, duration: 1200 });
  }, [hasGPS, safeLat, safeLon]);

  // External fly-to requests (search result, place, list row).
  useEffect(() => {
    if (!focus || !mapLoadedRef.current) return;
    const map = mapRef.current?.getMap?.();
    if (!map) return;
    map.flyTo({
      center: [focus.lon, focus.lat],
      zoom: focus.zoom ?? Math.max(map.getZoom(), 14),
      padding,
      duration: 900,
    });
  }, [focus?.ts]);

  // Keep the selected pin visible outside the overlays (search bar, side panel).
  useEffect(() => {
    if (!selectedPin || !Number.isFinite(selectedPin.lat) || !mapLoadedRef.current) return;
    const map = mapRef.current?.getMap?.();
    if (!map) return;
    const p = map.project([selectedPin.lon, selectedPin.lat]);
    const { width, height } = map.getCanvas().getBoundingClientRect();
    const clear = p.x > 24 && p.x < width - (padding.right + 24)
      && p.y > padding.top && p.y < height - padding.bottom;
    if (clear) return;
    map.easeTo({
      center: [selectedPin.lon, selectedPin.lat],
      zoom: Math.max(map.getZoom(), 13),
      padding,
      duration: 450,
    });
  }, [selectedPin?.id]);

  const handleClick = useCallback((e: any) => {
    const feature = e.features?.[0];
    if (!feature) {
      onPress?.({ lat: e.lngLat.lat, lon: e.lngLat.lng });
      return;
    }
    const item = itemsById.get(String(feature.properties.id));
    if (item) onPinPress?.(item);
  }, [itemsById, onPinPress, onPress]);

  if (!ReactMapGL || !MaplibreGL) {
    return (
      <View style={styles.fallback}>
        <Ionicons name="map-outline" size={64} color={Colors.border} />
        <Text style={styles.fallbackText}>Map unavailable — run npm install</Text>
      </View>
    );
  }

  const { Map: GLMap, Source, Layer } = ReactMapGL as any;

  const labelPaint = {
    'text-color': Colors.text,
    'text-halo-color': 'rgba(255,255,255,0.95)',
    'text-halo-width': 1.6,
  };
  const pinLayout = (labelFrom: number, extra: Record<string, any> = {}) => ({
    'icon-image': ['get', 'img'],
    'icon-anchor': 'bottom',
    'icon-padding': 1,
    'symbol-sort-key': ['get', 'rank'],
    'text-field': ['step', ['zoom'], '', labelFrom, ['get', 'label']],
    'text-font': ['Noto Sans Bold'],
    'text-size': 11.5,
    'text-anchor': 'left',
    'text-offset': [0.9, -1.15],
    'text-max-width': 11,
    'text-optional': true,
    ...extra,
  });

  return (
    <View style={styles.container}>
      <GLMap
        ref={mapRef}
        initialViewState={{ longitude: safeLon, latitude: safeLat, zoom: initialZoomRef.current }}
        style={{ width: '100%', height: '100%' }}
        mapStyle={OPENFREE_STYLE}
        mapLib={MaplibreGL}
        interactiveLayerIds={PIN_LAYER_IDS}
        onClick={handleClick}
        onMouseEnter={(e: any) => { e.target.getCanvas().style.cursor = 'pointer'; }}
        onMouseLeave={(e: any) => { e.target.getCanvas().style.cursor = ''; }}
        onLoad={(e: any) => {
          const map = e.target;
          mapLoadedRef.current = true;
          const c = map.getCenter();
          onRegionChange?.(c.lat, c.lng, map.getZoom(), boundsOf(map));
          if (hasGPS && !hasFlewToGPSRef.current) {
            hasFlewToGPSRef.current = true;
            map.flyTo({ center: [safeLon, safeLat], zoom: 13, duration: 1200 });
          }
        }}
        onStyleData={(e: any) => {
          const map = e.target;
          if (!map.__pinsReady) {
            map.__pinsReady = true;
            for (const name of Object.keys(PIN_DEFS)) addImageIfMissing(map, name);
            map.on('styleimagemissing', (ev: any) => addImageIfMissing(map, ev.id));
          }
        }}
        onMoveEnd={(e: any) => {
          const c = e.target.getCenter();
          onRegionChange?.(c.lat, c.lng, e.target.getZoom(), boundsOf(e.target));
        }}
        attributionControl={false}
      >
        {routeGeoJSON && (
          <Source id="route" type="geojson" data={routeGeoJSON}>
            <Layer
              id="route-casing"
              type="line"
              paint={{ 'line-color': '#ffffff', 'line-width': 8, 'line-opacity': 0.9 }}
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            />
            <Layer
              id="route-line"
              type="line"
              paint={{ 'line-color': PIN_COLORS.company, 'line-width': 4.5 }}
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            />
          </Source>
        )}

        <Source id="pins" type="geojson" data={pinsGeoJSON} buffer={16}>
          {/* Lowest tier first: layers higher in the stack are placed first and win collisions. */}
          {[...TIERS].reverse().map((t) => (
            <Layer
              key={t.tier}
              id={`pins-t${t.tier}`}
              type="symbol"
              minzoom={t.minzoom}
              filter={['all', ['==', ['get', 'src'], 'company'], ['==', ['get', 'tier'], t.tier]]}
              layout={pinLayout(t.labelFrom)}
              paint={labelPaint}
            />
          ))}
          <Layer
            id="pins-client"
            type="symbol"
            filter={['==', ['get', 'src'], 'client']}
            layout={pinLayout(11, { 'icon-allow-overlap': true })}
            paint={{ ...labelPaint, 'text-color': PIN_COLORS.client }}
          />
        </Source>

        <Source id="selected" type="geojson" data={selectedGeoJSON}>
          <Layer
            id="selected-halo"
            type="circle"
            paint={{ 'circle-radius': 18, 'circle-color': PIN_COLORS.selected, 'circle-opacity': 0.22 }}
          />
          <Layer
            id="selected-pin"
            type="symbol"
            layout={{
              'icon-image': 'pin-selected',
              'icon-anchor': 'bottom',
              'icon-allow-overlap': true,
              'icon-ignore-placement': true,
              'text-field': ['get', 'label'],
              'text-font': ['Noto Sans Bold'],
              'text-size': 13,
              'text-anchor': 'left',
              'text-offset': [1.1, -1.5],
              'text-max-width': 14,
              'text-allow-overlap': true,
            }}
            paint={{ ...labelPaint, 'text-halo-width': 2 }}
          />
        </Source>

        <Source id="me" type="geojson" data={meGeoJSON}>
          <Layer
            id="me-halo"
            type="circle"
            paint={{ 'circle-radius': 18, 'circle-color': PIN_COLORS.me, 'circle-opacity': 0.18 }}
          />
          <Layer
            id="me-dot"
            type="circle"
            paint={{
              'circle-radius': 7,
              'circle-color': PIN_COLORS.me,
              'circle-stroke-width': 3,
              'circle-stroke-color': '#ffffff',
            }}
          />
        </Source>
      </GLMap>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  fallbackText: { fontSize: 14, color: Colors.textSecondary },
});
