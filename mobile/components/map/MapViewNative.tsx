/**
 * Native (iOS / Android) map using @maplibre/maplibre-react-native.
 * Tiles: OpenFreeMap Liberty (free, no API key, OSM-derived vector tiles).
 */
import { useRef } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/Colors';
import type { NearbyItem } from '../../stores/mapStore';

let MapLibreGL: typeof import('@maplibre/maplibre-react-native') | null = null;
try {
  MapLibreGL = require('@maplibre/maplibre-react-native');
  // setTelemetryEnabled may not exist in all versions — suppress TS error
  const ml = (MapLibreGL as any).default;
  if (typeof ml?.setTelemetryEnabled === 'function') ml.setTelemetryEnabled(false);
} catch {
  // not yet installed / development build not set up
}

const OPENFREE_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

const PIN_COMPANY  = '#4285f4';
const PIN_CLIENT   = '#34a853';
const PIN_SELECTED = '#ea4335';

export interface MapViewNativeProps {
  userLat?: number;
  userLon?: number;
  nearbyItems?: NearbyItem[];
  selectedPin?: NearbyItem | null;
  routeCoords?: [number, number][] | null;
  onPress?: (coords: { lat: number; lon: number }) => void;
  onRegionChange?: (lat: number, lon: number, zoom: number, bounds?: [number, number, number, number]) => void;
  onPinPress?: (item: NearbyItem) => void;
}

export default function MapViewNative({
  userLat = 19.076,
  userLon = 72.8777,
  nearbyItems = [],
  selectedPin,
  routeCoords,
  onPress,
  onRegionChange,
  onPinPress,
}: MapViewNativeProps) {
  const cameraRef = useRef<any>(null);

  if (!MapLibreGL) {
    return (
      <View style={styles.placeholder}>
        <Ionicons name="map-outline" size={64} color={Colors.border} style={{ marginBottom: 16 }} />
        <Text style={styles.placeholderTitle}>Map Not Available</Text>
        <Text style={styles.placeholderSub}>
          Run <Text style={styles.code}>npx expo run:android</Text> or{' '}
          <Text style={styles.code}>npx expo run:ios</Text> to build with native MapLibre.
        </Text>
      </View>
    );
  }

  const ML = MapLibreGL.default;

  // GeoJSON FeatureCollection for all pins
  const pinsGeoJSON = {
    type: 'FeatureCollection' as const,
    features: nearbyItems.map((item) => ({
      type: 'Feature' as const,
      id: item.id,
      geometry: { type: 'Point' as const, coordinates: [item.lon, item.lat] },
      properties: {
        id: item.id,
        name: item.name,
        isClient: item.source === 'my_client',
        isVerified: item.is_verified,
        isSelected: selectedPin?.id === item.id,
        color: selectedPin?.id === item.id
          ? PIN_SELECTED
          : item.source === 'my_client'
            ? PIN_CLIENT
            : PIN_COMPANY,
      },
    })),
  };

  // GeoJSON for route
  const routeGeoJSON = routeCoords && routeCoords.length > 1
    ? {
        type: 'FeatureCollection' as const,
        features: [{
          type: 'Feature' as const,
          geometry: {
            type: 'LineString' as const,
            // routeCoords is [lat, lon] — GeoJSON expects [lon, lat]
            coordinates: routeCoords.map(([lat, lon]) => [lon, lat]),
          },
          properties: {},
        }],
      }
    : null;

  return (
    <ML.MapView
      style={styles.map}
      {...{ styleURL: OPENFREE_STYLE } as any}
      onPress={(feature: any) => {
        const [lon, lat] = feature?.geometry?.coordinates ?? [0, 0];
        onPress?.({ lat, lon });
      }}
      onRegionDidChange={(feature: any) => {
        const [lon, lat] = feature?.geometry?.coordinates ?? [0, 0];
        const props = feature?.properties ?? {};
        // visibleBounds is [[neLon, neLat], [swLon, swLat]]
        const vb = props.visibleBounds;
        const bounds: [number, number, number, number] | undefined = vb
          ? [vb[1][0], vb[1][1], vb[0][0], vb[0][1]]
          : undefined;
        onRegionChange?.(lat, lon, props.zoomLevel ?? 11, bounds);
      }}
      logoEnabled={false}
      attributionEnabled={false}
      compassEnabled
    >
      <ML.Camera
        ref={cameraRef}
        defaultSettings={{ centerCoordinate: [userLon, userLat], zoomLevel: 11 }}
        animationMode={"flyTo" as any}
      />

      {/* User location */}
      {userLat && userLon && (
        <ML.PointAnnotation
          id="user-location"
          coordinate={[userLon, userLat]}
        >
          <View style={styles.userDot} />
          <ML.Callout title="You are here" />
        </ML.PointAnnotation>
      )}

      {/* Route polyline */}
      {routeGeoJSON && (
        <ML.ShapeSource id="route-source" shape={routeGeoJSON as any}>
          <ML.LineLayer
            id="route-line"
            style={{
              lineColor: PIN_COMPANY,
              lineWidth: 4,
              lineOpacity: 0.85,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
        </ML.ShapeSource>
      )}

      {/* Company + client pins */}
      <ML.ShapeSource
        id="pins-source"
        shape={pinsGeoJSON as any}
        onPress={(e: any) => {
          const feat = e.features?.[0];
          if (!feat) return;
          const matched = nearbyItems.find(i => i.id === feat.properties?.id);
          if (matched) onPinPress?.(matched);
        }}
        cluster
        clusterMaxZoomLevel={14}
      >
        {/* Cluster circle */}
        <ML.CircleLayer
          id="clusters"
          belowLayerID="pins-circle"
          filter={['has', 'point_count']}
          style={{
            circleColor: PIN_COMPANY,
            circleRadius: ['step', ['get', 'point_count'], 16, 10, 22, 50, 28],
            circleOpacity: 0.85,
          }}
        />
        {/* Cluster count label */}
        <ML.SymbolLayer
          id="cluster-count"
          filter={['has', 'point_count']}
          style={{
            textField: ['get', 'point_count_abbreviated'],
            textSize: 12,
            textColor: '#fff',
            textFont: ['Open Sans Bold'],
          }}
        />
        {/* Individual pin circles */}
        <ML.CircleLayer
          id="pins-circle"
          filter={['!', ['has', 'point_count']]}
          style={{
            circleColor: ['get', 'color'],
            circleRadius: 9,
            circleStrokeWidth: 2,
            circleStrokeColor: '#fff',
          }}
        />
      </ML.ShapeSource>
    </ML.MapView>
  );
}

const styles = StyleSheet.create({
  map: { flex: 1 },
  userDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: PIN_COMPANY,
    borderWidth: 3,
    borderColor: '#fff',
    shadowColor: PIN_COMPANY,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
    elevation: 3,
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e8eef7',
    padding: 32,
  },
  placeholderTitle: { fontSize: 18, fontWeight: '700', color: Colors.text, marginBottom: 8 },
  placeholderSub: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  code: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    color: Colors.primary,
    backgroundColor: Colors.bgSecondary,
  },
});
