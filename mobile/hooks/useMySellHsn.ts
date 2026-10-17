import { useEffect, useState } from 'react';
import { apiClient } from '../services/api';
import { useAuthStore } from '../stores/authStore';

let cache: string[] | null = null;
let inflight: Promise<string[]> | null = null;

// HSN codes of the products the signed-in salesman sells; fetched once per session.
export function useMySellHsn() {
  const token = useAuthStore((s) => s.accessToken);
  const [hsn, setHsn] = useState<string[]>(cache ?? []);

  useEffect(() => {
    if (!token || cache) return;
    inflight ??= apiClient
      .get('/api/users/me/products')
      .then((r) => (r.data?.products || []).map((p: any) => String(p.hsn_code || '')).filter(Boolean))
      .catch(() => []);
    inflight.then((codes) => { cache = codes; setHsn(codes); });
  }, [token]);

  return hsn;
}

// Prefix match in either direction: chapter "72" matches heading "7213" and vice versa.
export function hsnOverlap(mine: string[], theirs: string[] | undefined) {
  if (!mine.length || !theirs?.length) return false;
  return theirs.some((t) => mine.some((m) => t.startsWith(m) || m.startsWith(t)));
}
