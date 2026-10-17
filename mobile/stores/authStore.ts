import { create } from 'zustand';
import { Platform } from 'react-native';
import { apiClient, setAccessToken, setRefreshFn } from '../services/api';
import { ENDPOINTS } from '../constants/Api';

// expo-secure-store is native-only; gracefully skip on web
let SecureStore: typeof import('expo-secure-store') | null = null;
if (Platform.OS !== 'web') {
  SecureStore = require('expo-secure-store');
}

export interface User {
  id: string;
  email: string;
  full_name: string;
  role: 'salesman' | 'company_member' | 'company_admin' | 'platform_admin';
  company_id: string | null;
  avatar_url: string | null;
  phone?: string | null;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: {
    email: string;
    password: string;
    full_name: string;
    role: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  refreshToken: () => Promise<void>;
  initAuth: () => Promise<void>;
}

const REFRESH_TOKEN_KEY = 'geosales_refresh_token';

async function storeRefreshToken(token: string) {
  if (!SecureStore) return;
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token);
}

async function getStoredRefreshToken(): Promise<string | null> {
  if (!SecureStore) return null;
  return SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
}

async function clearStoredRefreshToken() {
  if (!SecureStore) return;
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
}

export const useAuthStore = create<AuthState>((set) => {
  const refreshToken = async () => {
    try {
      let config: Record<string, unknown> = {};
      if (Platform.OS !== 'web') {
        const storedToken = await getStoredRefreshToken();
        if (!storedToken) throw new Error('No refresh token stored');
        config.headers = { 'x-refresh-token': storedToken };
      } else {
        config.withCredentials = true;
      }
      const res = await apiClient.post(ENDPOINTS.auth.refresh, {}, config);
      const { access_token, user } = res.data;
      set({ accessToken: access_token, user, isAuthenticated: true });
      setAccessToken(access_token);
    } catch (err) {
      set({ accessToken: null, user: null, isAuthenticated: false });
      setAccessToken(null);
      await clearStoredRefreshToken();
      throw err; // propagate so initAuth/.catch() fires auto-login
    }
  };

  setRefreshFn(refreshToken);

  return {
    user: null,
    accessToken: null,
    isAuthenticated: false,
    isLoading: true,

    initAuth: async () => {
      set({ isLoading: true });
      await refreshToken();
      set({ isLoading: false });
      setInterval(refreshToken, 14 * 60 * 1000);
    },

    login: async (email, password) => {
      const res = await apiClient.post(
        ENDPOINTS.auth.login,
        { email, password },
        { withCredentials: true }
      );
      const { access_token, refresh_token, user } = res.data;
      set({ accessToken: access_token, user, isAuthenticated: true });
      setAccessToken(access_token);
      if (refresh_token) await storeRefreshToken(refresh_token);
    },

    register: async (data) => {
      const res = await apiClient.post(ENDPOINTS.auth.register, data);
      const { access_token, refresh_token, user } = res.data;
      set({ accessToken: access_token, user, isAuthenticated: true });
      setAccessToken(access_token);
      if (refresh_token) await storeRefreshToken(refresh_token);
    },

    logout: async () => {
      try {
        await apiClient.post(ENDPOINTS.auth.logout, {}, { withCredentials: true });
      } catch {
        // ignore network errors on logout
      }
      set({ accessToken: null, user: null, isAuthenticated: false });
      setAccessToken(null);
      await clearStoredRefreshToken();
    },

    refreshToken,
  };
});
