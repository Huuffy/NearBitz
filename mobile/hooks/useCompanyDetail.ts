import { useEffect, useState } from 'react';
import { apiClient } from '../services/api';

export interface CompanyDetail {
  id: string;
  name: string;
  description?: string | null;
  logo_url?: string | null;
  website?: string | null;
  phone?: string | null;
  email?: string | null;
  gstin?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  pinned: boolean;
  geocode_precision?: string | null;
  is_verified: boolean;
  feed_active: boolean;
  employee_band?: string | null;
  primary_industry?: string | null;
  industry_names?: string[];
  buy_categories?: string[];
  sell_categories?: string[];
  buy_hsn?: string[];
  products?: { id: string }[];
  posts?: { id: string }[];
  mca: {
    cin: string | null;
    class: string | null;
    incorporated: string | null;
    activity: string | null;
    paid_up_capital: number | null;
  };
}

const cache = new Map<string, CompanyDetail>();

export function useCompanyDetail(id: string | null | undefined, enabled = true) {
  const [data, setData] = useState<CompanyDetail | null>(() => (id ? cache.get(id) ?? null : null));
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!id || !enabled) { setData(null); return; }
    const hit = cache.get(id);
    if (hit) { setData(hit); setError(false); return; }
    setData(null);
    setError(false);
    let alive = true;
    apiClient.get(`/api/companies/${id}`)
      .then((r) => {
        if (!r.data?.success) throw new Error('not found');
        cache.set(id, r.data.data);
        if (alive) setData(r.data.data);
      })
      .catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, [id, enabled]);

  return { data, error, loading: enabled && !!id && !data && !error };
}
