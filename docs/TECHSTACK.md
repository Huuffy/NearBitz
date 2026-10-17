# TECHSTACK.md

Verified stack as of 2026-10-09. All versions confirmed from running containers and installed packages — not from manifests.

---

## Runtime Environment

| Component | Version | Role |
|---|---|---|
| **Node.js** | v20.20.2 (LTS Iron) | Backend JavaScript runtime |
| **Alpine Linux** | 3.x (inside Docker) | Base OS for all containers — minimal attack surface, ~5MB base |
| **Docker Engine** | 29.8.1 | Container runtime |
| **Docker Compose** | v5.5.1 | Multi-container orchestration |

---

## Database Layer

| Component | Version | Role |
|---|---|---|
| **PostgreSQL** | 16.4 | Primary relational database — ACID, MVCC, row-level locking |
| **PostGIS** | 3.4.3 | Spatial extension — adds `GEOGRAPHY` type, `ST_DWithin`, GIST spatial indexes |
| **GEOS** | 3.12.2 | Geometry engine (spatial operations — used internally by PostGIS) |
| **PROJ** | 9.4.0 | Coordinate transformation library (used by PostGIS) |
| **pg** (Node driver) | 8.23.1 | PostgreSQL client for Node.js — connection pooling, parameterised queries |

### Why PostgreSQL over alternatives
- PostGIS adds `GEOGRAPHY(POINT, 4326)` which measures distances in real metres on Earth's surface — not flat-plane approximations
- `ST_DWithin` on a GIST index runs O(log n) radius searches — essential at 20,000 company scale
- Recursive CTEs handle the product category tree traversal natively
- No separate graph DB needed — join tables + indexed FKs cover the buy/sell product graph
- Full-text search via `pg_trgm` and `tsvector` built in — no Elasticsearch needed

---

## Backend API

| Package | Version | Role |
|---|---|---|
| **express** | 4.22.3 | HTTP framework — routing, middleware pipeline |
| **helmet** | ^8.3.0 | Security headers (XSS, clickjacking, MIME sniffing protection) |
| **cors** | 2.8.6 | Cross-origin request policy — scoped to app dev ports |
| **express-rate-limit** | ^8.7.1 | Per-route request throttling (20/15min auth, 200/min API) |
| **cookie-parser** | 1.4.7 | Parses `httpOnly` cookies — used for refresh token on web |
| **dotenv** | 16.6.1 | Loads `.env` into `process.env` |

### Auth
| Package | Version | Role |
|---|---|---|
| **jsonwebtoken** | 9.0.3 | JWT signing/verification — HS256, 15-minute access tokens |
| **bcryptjs** | ^3.0.3 | Password hashing — pure JS, no native bindings, cost factor 12 |
| **uuid** | 14.0.2 | `gen_random_uuid()` equivalent in JS — used for refresh token generation |

### File Handling & Upload
| Package | Version | Role |
|---|---|---|
| **multer** | 2.4.0 | Multipart form-data parser — ERP file upload, in-memory storage |
| **xlsx** | 0.18.5 | Excel (.xlsx/.xls) and CSV parser — ERP Quotation file reading |

### ERP Intelligence
| Package | Version | Role |
|---|---|---|
| **fuse.js** | ^7.5.0 | Fuzzy string matching — customer name normalisation, company deduplication |
| **csv-parse** | ^7.0.3 | Streaming CSV parser — MCA company master data import |
| **p-limit** | ^7.3.3 | Concurrency limiter — controls parallel geocoding workers |

### Jobs & Scheduling
| Package | Version | Role |
|---|---|---|
| **node-cron** | ^4.6.0 | Cron-style scheduler — nightly `feed_visibility_score` recalculation |
| **node-fetch** | 2.7.0 | HTTP client — Photon geocoder calls, OSRM routing proxy |

---

## Mobile & Web App

Single codebase — one `npx expo start` serves iOS, Android, and browser.

| Package | Version | Role |
|---|---|---|
| **Expo SDK** | ~52.0.0 | Managed React Native toolchain — build, dev server, native APIs |
| **expo-router** | ~4.0.0 | File-based routing — `app/(tabs)/index.tsx` = map screen, auto web URLs |
| **React Native** | 0.76.5 | Cross-platform UI framework |
| **React** | 18.3.1 | UI rendering |
| **react-native-web** | ~0.19.13 | Renders React Native components as HTML/CSS in the browser |
| **react-dom** | 18.3.1 | React browser renderer — required by react-native-web |

### State Management
| Package | Version | Role |
|---|---|---|
| **zustand** | ^4.5.4 | Lightweight client state — auth token (in-memory only), map state, filters |
| **@tanstack/react-query** | ^5.56.0 | Server state — caching, background refetch, stale-while-revalidate |
| **axios** | ^1.7.0 | HTTP client — JWT injection interceptor, 401 auto-refresh retry |

### Map
| Package | Version | Platform | Role |
|---|---|---|---|
| **@maplibre/maplibre-react-native** | ^10.0.0 | iOS / Android | Native C++ MapLibre renderer — vector tiles, custom layers, GIST clustering |
| **react-map-gl** | ^7.1.7 | Web | React wrapper for MapLibre GL JS |
| **maplibre-gl** | ^4.7.0 | Web | MapLibre GL JS — WebGL vector tile renderer |
| **OpenFreeMap Liberty** | — | All | Tile source — `tiles.openfreemap.org/styles/liberty`, free, no API key, OSM-derived vector tiles |

### Navigation & UI
| Package | Version | Role |
|---|---|---|
| **react-native-screens** | ~4.4.0 | Native screen containers — smooth transitions |
| **react-native-safe-area-context** | 4.14.0 | Notch/home bar aware layouts |
| **react-native-gesture-handler** | ~2.20.0 | Native touch gestures — swipe, pan for bottom sheet |
| **react-native-reanimated** | ~3.16.0 | 60fps animations on UI thread |
| **@gorhom/bottom-sheet** | ^5.0.0 | Bottom sheet for company list panel |
| **@expo/vector-icons** (Ionicons) | bundled with SDK 52 | All icons — zero emoji, professional icon set |

### Device APIs
| Package | Version | Role |
|---|---|---|
| **expo-location** | ~18.0.0 | GPS `watchPositionAsync` — live tracking, accuracy circles |
| **expo-document-picker** | ~13.0.0 | ERP Excel file picker — native file system access |
| **expo-secure-store** | ~14.0.0 | iOS Keychain / Android Keystore — encrypted refresh token storage |
| **expo-image** | ~2.0.0 | Optimised image component — company logos with caching |

### Utilities
| Package | Version | Role |
|---|---|---|
| **@turf/helpers** | ^6.5.0 | GeoJSON construction helpers — bounding boxes, feature collections |
| **fuse.js** | ^7.0.0 | Client-side fuzzy search — map search bar result ranking |
| **xlsx** | ^0.18.5 | ERP file reading on mobile before upload |
| **TypeScript** | ^5.3.3 | Type safety across all app code |

---

## External Services

| Service | Protocol | What it does | Cost |
|---|---|---|---|
| **OpenFreeMap Liberty** | HTTPS tiles | Vector map tiles (OSM-derived) — roads, buildings, labels | Free, no key |
| **OSRM** (`router.project-osrm.org`) | HTTP REST | Turn-by-turn routing, driving distance/duration, trip optimisation | Free, public |
| **Photon geocoder** | HTTP REST (local) | Address → lat/lon — runs locally on port 2322, India bbox-filtered | Free, self-hosted |
| **OpenStreetMap** | OSM data | Underlies both Photon and OpenFreeMap tiles | ODbL open license |

---

## Geocoding Architecture

```
Address string (MCA registered office)
       │
       ▼
geocode_cache (PostgreSQL) ──── hit → return cached lat/lon
       │ miss
       ▼
Photon geocoder (localhost:2322)
   - Based on OpenStreetMap Nominatim data
   - India bbox filter: 68°E–97°E, 6°N–37°N
   - Returns GeoJSON FeatureCollection
       │
       ▼
Validate: lat 6.5–37.1, lon 68–97.5 (reject if outside India)
       │
       ▼
Write lat/lon/geom to companies / company_locations / salesman_clients
Write result to geocode_cache
```

---

## Data Sources

| Dataset | Source | License | Records | Address quality |
|---|---|---|---|---|
| **MCA Company Master Data** | Ministry of Corporate Affairs, `data.gov.in/catalog/company-master-data` | Open Government Data License (OGL) India — free, commercial use allowed | ~2.8 million active registered companies | Street-level registered office address (e.g. "406 Marutibhavan, Parel, Mumbai") |
| **ERP Quotation Excel** | Salesman's own ERP system (uploaded by user) | Private — row-level owned, never shared | Varies per user | Full address from ERP records |
| **Industries taxonomy** | NIC 2008 (National Industrial Classification) — India's official sector codes | Public domain | 15 sectors | N/A — reference data |
| **Product categories** | NIC-aligned manual taxonomy | N/A | 45 categories (20 groups + 25 leaves) | N/A — reference data |

---

## Auth Architecture

```
Access token:   JWT · HS256 · 15-minute expiry
                Lives in: Zustand memory only (never localStorage / AsyncStorage)
                Injected by: Axios request interceptor

Refresh token:  Opaque random token → SHA-256 hash stored in PostgreSQL
                Lives in: expo-secure-store (iOS Keychain / Android Keystore) on native
                          httpOnly · Secure · SameSite=Strict cookie on web
                          JavaScript cannot read either — immune to XSS theft

Silent refresh: setInterval every 14 minutes → POST /api/auth/refresh
                On 401: retry once → redirect to login
```

---

## Infrastructure

| Component | Config | Notes |
|---|---|---|
| **Docker network** | `geosales_network` (bridge) | Containers communicate by service name (`postgres`, `backend`) |
| **pgdata volume** | Named Docker volume | PostgreSQL data — survives `docker compose down`, survives host reboot |
| **uploads volume** | Named Docker volume | User-uploaded files (logos, ERPs) — persists independently of image rebuilds |
| **backend_node_modules** | Named Docker volume | Installed packages — avoids npm install on every container start |
| **Source bind mount** | `./backend:/app` (dev only) | Hot-reload — nodemon watches file changes without container rebuild |
| **Dev vs Prod** | `docker-compose.override.yml` auto-merged in dev | `docker compose -f docker-compose.yml up` for production (no source mount, no nodemon) |

---

## What Is NOT Used

| Technology | Reason not used |
|---|---|
| Redis | No session cache needed — JWT is stateless, rate limiter is in-memory (acceptable for single instance) |
| Elasticsearch | `pg_trgm` GIN index handles fuzzy company name search adequately at 20K scale |
| Neo4j / graph DB | Product buy/sell graph modelled as two join tables in PostgreSQL — recursive CTE for tree traversal |
| Google Maps | No API key required — OpenFreeMap + OSRM + Photon cover all map/routing/geocoding needs |
| Firebase | Auth is custom JWT — full control, no vendor lock-in, refresh tokens in our own DB |
| S3 / cloud storage | `storage.js` abstraction is swappable — currently local disk, migrates to S3 by changing one file |
| React / Next.js (web-only) | React Native Web serves both browser and mobile from same codebase |
| MongoDB | Structured relational data with spatial queries — PostgreSQL is the correct choice |
