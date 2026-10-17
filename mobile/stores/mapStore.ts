import { create } from 'zustand';
import { Platform } from 'react-native';
import { apiClient } from '../services/api';
import { useAuthStore } from './authStore';
import { ENDPOINTS } from '../constants/Api';

const CACHE_KEY = 'geosales_companies_v3';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const RECENT_KEY = 'geosales_recent_searches';

const canStore = () => Platform.OS === 'web' && typeof localStorage !== 'undefined';

function saveCache(items: NearbyItem[]) {
  if (!canStore()) return;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), items: items.filter(i => i.source === 'company') }));
  } catch { /* quota exceeded */ }
}

function loadCache(): NearbyItem[] | null {
  if (!canStore()) return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { ts, items } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL_MS) return null;
    return items as NearbyItem[];
  } catch { return null; }
}

function loadRecent(): string[] {
  if (!canStore()) return [];
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
}

export interface NearbyItem {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  lat: number;
  lon: number;
  distance_km: number;
  feed_visibility_score: number;
  primary_industry?: string;
  industry_id?: number | null;
  capital?: number | null;
  tier?: number | null;
  pinned?: boolean;
  phone?: string;
  logo_url?: string;
  is_verified: boolean;
  feed_active: boolean;
  products_sell?: string[];
  products_buy?: string[];
  source: 'company' | 'my_client';
  last_order_date?: string;
  last_order_amount?: number;
  last_product_raw?: string;
}

export interface ProductHit {
  id: number;
  hsn: string;
  label: string;
  buyers: number;
  sellers: number;
}

export interface PlaceHit {
  city: string;
  state: string;
  companies: number;
  lat: number;
  lon: number;
}

export interface CategoryFilter {
  id: number;
  label: string;
  kind: 'buy' | 'sell';
  ids: Set<string>;
}

export interface MapFilters {
  industryId: number | null;
  verifiedOnly: boolean;
  category: CategoryFilter | null;
}

export interface MapFocus {
  lat: number;
  lon: number;
  zoom?: number;
  ts: number;
}

export interface RouteInfo {
  distance_km: number;
  duration_min: number;
}

interface MapState {
  userLocation: { lat: number; lon: number } | null;
  mapCenter: { lat: number; lon: number } | null;
  bounds: [number, number, number, number] | null;
  zoom: number;
  nearbyItems: NearbyItem[];
  selectedPin: NearbyItem | null;
  filters: MapFilters;
  showMyClients: boolean;
  isLoadingPins: boolean;
  totalCompanies: number | null;
  routeCoords: [number, number][] | null;
  routeInfo: RouteInfo | null;
  mapFocus: MapFocus | null;

  searchQuery: string;
  searchCompanies: NearbyItem[];
  searchProducts: ProductHit[];
  searchPlaces: PlaceHit[];
  isSearching: boolean;
  recentSearches: string[];

  setUserLocation: (loc: { lat: number; lon: number }) => void;
  setViewport: (c: { lat: number; lon: number }, zoom: number, bounds: [number, number, number, number] | null) => void;
  setSelectedPin: (pin: NearbyItem | null) => void;
  setIndustry: (id: number | null) => void;
  setVerifiedOnly: (v: boolean) => void;
  setShowMyClients: (v: boolean) => void;
  clearRoute: () => void;
  setSearchQuery: (q: string) => void;
  focusMap: (lat: number, lon: number, zoom?: number) => void;
  addRecentSearch: (q: string) => void;

  loadFromCache: () => boolean;
  loadAllPins: () => Promise<void>;
  loadMyClientPins: () => Promise<void>;
  fetchRoute: (from: [number, number], to: [number, number], mode?: 'driving' | 'walking' | 'cycling') => Promise<void>;
  runSearch: (q: string) => Promise<void>;
  applyCategory: (p: ProductHit, kind: 'buy' | 'sell') => Promise<void>;
  clearCategory: () => void;
}

let searchAbort: AbortController | null = null;

export const useMapStore = create<MapState>((set, get) => ({
  userLocation: null,
  mapCenter: null,
  bounds: null,
  zoom: 5,
  nearbyItems: [],
  selectedPin: null,
  filters: { industryId: null, verifiedOnly: false, category: null },
  showMyClients: true,
  isLoadingPins: false,
  totalCompanies: null,
  routeCoords: null,
  routeInfo: null,
  mapFocus: null,

  searchQuery: '',
  searchCompanies: [],
  searchProducts: [],
  searchPlaces: [],
  isSearching: false,
  recentSearches: loadRecent(),

  setUserLocation: (loc) => set({ userLocation: loc }),
  setViewport: (c, zoom, bounds) => set({ mapCenter: c, zoom, bounds }),
  setSelectedPin: (pin) => set({ selectedPin: pin }),
  setIndustry: (id) => set((s) => ({ filters: { ...s.filters, industryId: id } })),
  setVerifiedOnly: (v) => set((s) => ({ filters: { ...s.filters, verifiedOnly: v } })),
  setShowMyClients: (v) => set({ showMyClients: v }),
  clearRoute: () => set({ routeCoords: null, routeInfo: null }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  focusMap: (lat, lon, zoom) => set({ mapFocus: { lat, lon, zoom, ts: Date.now() } }),

  addRecentSearch: (q) => {
    const term = q.trim();
    if (term.length < 2) return;
    const next = [term, ...get().recentSearches.filter((r) => r.toLowerCase() !== term.toLowerCase())].slice(0, 8);
    set({ recentSearches: next });
    if (canStore()) { try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* ignore */ } }
  },

  loadFromCache: () => {
    const cached = loadCache();
    if (!cached || !cached.length) return false;
    set({ nearbyItems: cached });
    return true;
  },

  loadAllPins: async () => {
    set({ isLoadingPins: true });
    try {
      const res = await apiClient.get(ENDPOINTS.map.allPins, { params: { v: 3 } });
      const { cols, rows, total_companies } = res.data;
      if (!Array.isArray(rows) || !Array.isArray(cols)) return;
      const [iId, iName, iCity, iState, iLat, iLon, iVerified, iFeedActive, iInd, iCap, iTier] =
        ['id', 'name', 'city', 'state', 'lat', 'lon', 'is_verified', 'feed_active', 'industry_id', 'capital', 'tier']
          .map(c => cols.indexOf(c));
      const items: NearbyItem[] = rows
        .filter((r: any[]) => typeof r[iLat] === 'number' && typeof r[iLon] === 'number')
        .map((r: any[]) => ({
          id: r[iId],
          name: r[iName] || '',
          address: '',
          city: r[iCity] || '',
          state: r[iState] || '',
          lat: r[iLat],
          lon: r[iLon],
          distance_km: 0,
          feed_visibility_score: 1,
          is_verified: !!r[iVerified],
          feed_active: !!r[iFeedActive],
          industry_id: iInd >= 0 ? r[iInd] : null,
          capital: iCap >= 0 ? r[iCap] : null,
          tier: iTier >= 0 ? r[iTier] : null,
          pinned: true,
          source: 'company' as const,
        }));
      const clients = get().nearbyItems.filter(i => i.source === 'my_client');
      set({ nearbyItems: [...items, ...clients], totalCompanies: total_companies ?? null });
      saveCache(items);
    } catch (err) {
      console.error('loadAllPins error:', err);
    } finally {
      set({ isLoadingPins: false });
    }
  },

  loadMyClientPins: async () => {
    if (!useAuthStore.getState().accessToken) return;
    try {
      const res = await apiClient.get(ENDPOINTS.map.myClientPins);
      const clients: NearbyItem[] = (res.data?.data || [])
        .filter((r: any) => r.lat != null && r.lon != null)
        .map((r: any) => ({
          id: r.id,
          name: r.name || '',
          address: r.address || '',
          city: r.city || '',
          state: r.state || '',
          lat: Number(r.lat),
          lon: Number(r.lon),
          distance_km: 0,
          feed_visibility_score: 1,
          phone: r.phone || undefined,
          is_verified: false,
          feed_active: false,
          source: 'my_client' as const,
          last_order_date: r.last_order_date || undefined,
          last_order_amount: r.last_order_amount != null ? Number(r.last_order_amount) : undefined,
          last_product_raw: r.last_product_raw || undefined,
          pinned: true,
        }));
      const companies = get().nearbyItems.filter(i => i.source !== 'my_client');
      set({ nearbyItems: [...companies, ...clients] });
    } catch (err) {
      console.error('loadMyClientPins error:', err);
    }
  },

  fetchRoute: async (from, to, mode = 'driving') => {
    try {
      const res = await apiClient.post(ENDPOINTS.map.route, { from, to, mode });
      const route = res.data.route;
      const coords: [number, number][] =
        route?.geometry?.coordinates?.map(([lon, lat]: [number, number]) => [lat, lon] as [number, number]) ?? [];
      set({
        routeCoords: coords,
        routeInfo: route ? { distance_km: route.distance / 1000, duration_min: route.duration / 60 } : null,
      });
    } catch (err) {
      console.error('fetchRoute error:', err);
    }
  },

  runSearch: async (q) => {
    const term = q.trim();
    searchAbort?.abort();
    if (term.length < 2) {
      set({ searchCompanies: [], searchProducts: [], searchPlaces: [], isSearching: false });
      return;
    }
    const ctrl = new AbortController();
    searchAbort = ctrl;
    set({ isSearching: true });
    const ref = get().userLocation || get().mapCenter;
    try {
      const res = await apiClient.get(ENDPOINTS.map.search, {
        params: { q: term, limit: 20, ...(ref ? { lat: ref.lat, lon: ref.lon } : {}) },
        signal: ctrl.signal,
      });
      if (ctrl.signal.aborted) return;
      const companies: NearbyItem[] = (res.data.companies || []).map((c: any) => ({
        id: c.id,
        name: c.name,
        address: '',
        city: c.city || '',
        state: c.state || '',
        lat: c.lat == null ? NaN : Number(c.lat),
        lon: c.lon == null ? NaN : Number(c.lon),
        distance_km: c.distance_km ?? 0,
        feed_visibility_score: 1,
        industry_id: c.industry_id ?? null,
        capital: c.capital ?? null,
        pinned: !!c.pinned,
        phone: c.phone || undefined,
        logo_url: c.logo_url || undefined,
        is_verified: !!c.is_verified,
        feed_active: !!c.feed_active,
        source: 'company' as const,
      }));
      set({
        searchCompanies: companies,
        searchProducts: res.data.products || [],
        searchPlaces: res.data.places || [],
      });
    } catch (err: any) {
      if (err?.name === 'CanceledError' || err?.name === 'AbortError') return;
      console.error('search error:', err);
      set({ searchCompanies: [], searchProducts: [], searchPlaces: [] });
    } finally {
      if (searchAbort === ctrl) set({ isSearching: false });
    }
  },

  applyCategory: async (p, kind) => {
    try {
      const res = await apiClient.get(ENDPOINTS.map.categoryCompanies, { params: { category_id: p.id, kind } });
      const ids = new Set<string>((res.data.ids || []).map(String));
      set((s) => ({
        filters: { ...s.filters, category: { id: p.id, label: p.label, kind, ids } },
        selectedPin: null,
      }));
    } catch (err) {
      console.error('applyCategory error:', err);
    }
  },

  clearCategory: () => set((s) => ({ filters: { ...s.filters, category: null } })),
}));

// Pins visible under the current filters (pure; used by the map and the list).
export function selectVisible(items: NearbyItem[], filters: MapFilters, showMyClients: boolean) {
  const { industryId, verifiedOnly, category } = filters;
  if (!industryId && !verifiedOnly && !category && showMyClients) return items;
  return items.filter((i) => {
    if (i.source === 'my_client') return showMyClients && !category && !industryId && !verifiedOnly;
    if (industryId && i.industry_id !== industryId) return false;
    if (verifiedOnly && !i.is_verified) return false;
    if (category && !category.ids.has(String(i.id))) return false;
    return true;
  });
}
