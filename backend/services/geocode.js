const fetch = require('node-fetch');
const pool = require('../db/pool');
const config = require('../config');

const PHOTON_URL = config.photon.url;
const INDIA_BBOX = '68,6,97,37';

const memCache = new Map();

async function geocodeAddress(address) {
    if (!address || !address.trim()) return null;
    const key = address.toLowerCase().trim();

    if (memCache.has(key)) return memCache.get(key);

    try {
        const cached = await pool.query(
            'SELECT latitude, longitude, display_name FROM geocode_cache WHERE address_key = $1',
            [key]
        );
        if (cached.rows.length > 0) {
            const r = {
                lat: cached.rows[0].latitude,
                lon: cached.rows[0].longitude,
                display_name: cached.rows[0].display_name
            };
            memCache.set(key, r);
            return r;
        }
    } catch {}

    try {
        const url = `${PHOTON_URL}/api?q=${encodeURIComponent(address)}&limit=1&lang=en&bbox=${INDIA_BBOX}`;
        const res = await fetch(url, { headers: { 'Accept': 'application/json' }, timeout: 5000 });
        const data = await res.json();

        if (data.features && data.features.length > 0) {
            const f = data.features[0];
            const [lon, lat] = f.geometry.coordinates;

            if (lat < 6.5 || lat > 37.1 || lon < 68.0 || lon > 97.5) return null;

            const p = f.properties;
            // Reject area-level matches: a pin at a city/district/state centroid is not a real location.
            const COARSE = new Set(['country', 'state', 'region', 'county', 'district', 'city', 'province']);
            if (COARSE.has(p.type) || (p.osm_key === 'place' && COARSE.has(p.osm_value))
                || (p.osm_key === 'boundary' && p.osm_value === 'administrative')) {
                return null;
            }
            const result = {
                lat,
                lon,
                display_name: p.name || p.street || address,
                city: p.city || p.town || p.village || p.county || '',
                precision: p.type === 'house' ? 'house' : p.type === 'street' ? 'street' : 'locality',
            };
            memCache.set(key, result);

            pool.query(
                'INSERT INTO geocode_cache (address_key, latitude, longitude, display_name, created_at) VALUES ($1, $2, $3, $4, NOW()) ON CONFLICT (address_key) DO NOTHING',
                [key, lat, lon, result.display_name]
            ).catch(() => {});

            return result;
        }
    } catch {}

    return null;
}

module.exports = { geocodeAddress };
