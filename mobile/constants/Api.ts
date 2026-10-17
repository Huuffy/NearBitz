export const API_BASE = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';

export const ENDPOINTS = {
  auth: {
    register: '/api/auth/register',
    login: '/api/auth/login',
    refresh: '/api/auth/refresh',
    logout: '/api/auth/logout',
    me: '/api/auth/me',
  },
  COMPANIES: '/api/companies',
  companies: {
    list: '/api/companies',
    detail: (id: string) => `/api/companies/${id}`,
    categories: '/api/companies/categories',
  },
  UPLOAD_ERP: '/api/upload/erp',
  upload: {
    erp: '/api/upload/erp',
    erpStatus: (id: string) => `/api/upload/erp/${id}/status`,
  },
  users: {
    me: '/api/users/me',
    products: '/api/users/me/products',
    productsSearch: '/api/users/me/products/search',
    clients: '/api/users/me/clients',
    uploads: '/api/users/me/uploads',
    notifications: '/api/users/me/notifications',
  },
  map: {
    allPins: '/api/map/all-pins',
    myClientPins: '/api/map/my-client-pins',
    categoryCompanies: '/api/map/category-companies',
    nearby: '/api/map/nearby',
    nearbyForMe: '/api/map/nearby/for-me',
    route: '/api/map/route',
    trip: '/api/map/trip',
    search: '/api/map/search',
  },
  feed: '/api/feed',
} as const;
