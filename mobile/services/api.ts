import axios, { InternalAxiosRequestConfig } from 'axios';
import { API_BASE } from '../constants/Api';

export const apiClient = axios.create({
  baseURL: API_BASE,
  timeout: 120000, // 2 min — large bulk fetches (22k pins) need extra time
  headers: { 'Content-Type': 'application/json' },
});

let _accessToken: string | null = null;
let _refreshFn: (() => Promise<void>) | null = null;

export function setAccessToken(token: string | null) {
  _accessToken = token;
}

export function setRefreshFn(fn: () => Promise<void>) {
  _refreshFn = fn;
}

apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (_accessToken) {
    config.headers.Authorization = `Bearer ${_accessToken}`;
  }
  return config;
});

let _isRefreshing = false;

apiClient.interceptors.response.use(
  (res) => res,
  async (err) => {
    const originalConfig = err.config;
    const isAuthRoute = originalConfig.url?.includes('/api/auth/');
    // Only retry with token refresh if we were actually sending a token (authenticated request)
    const hadToken = !!(originalConfig.headers?.Authorization);
    if (err.response?.status === 401 && !originalConfig._retry && _refreshFn && !isAuthRoute && hadToken) {
      if (_isRefreshing) return Promise.reject(err);
      _isRefreshing = true;
      originalConfig._retry = true;
      try {
        await _refreshFn();
        if (_accessToken) {
          originalConfig.headers.Authorization = `Bearer ${_accessToken}`;
        }
        return apiClient(originalConfig);
      } catch {
        return Promise.reject(err);
      } finally {
        _isRefreshing = false;
      }
    }
    return Promise.reject(err);
  }
);
