# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This file gives any developer or AI assistant the context needed to continue work on NearBiz without re-deriving what has already been decided. Read this before touching any code.

---

## Current Codebase State (Phase 0 — as of project start)

**What actually exists right now** — the rest of this file describes the planned target state:

| File | Status |
|---|---|
| `backend/server.js` | Monolithic — all 4 routes + geocoding inline. Has both known bugs (see below). |
| `backend/config.js` | Exists but **never imported** by `server.js` — env vars are read directly |
| `backend/db/pool.js` | Working PostgreSQL pool |
| `backend/db/init.sql` | Base schema only (`clients`, `geocode_cache`) |
| `frontend/index.html` | Working map page — all JS and CSS inline (~1100 lines) |
| `frontend/sw.js` | Working service worker |

**Nothing else exists yet.** No `routes/`, `middleware/`, `services/`, migrations, `feed.html`, `company.html`, `login.html`, or any frontend JS modules. The folder structure and API tables in this file are the **planned target**, not the current state.

---

## Project Overview

**NearBiz** is a B2B field sales intelligence platform targeting the Indian market. It has two integrated modules:

1. **Field Sales Map** — A salesman in a new city opens the map, sees nearby companies that buy what they sell, filters by industry/category, taps a pin to view the company's profile and catalogue, and requests a meeting. The map ranks companies by distance weighted by their feed activity score.

2. **B2B Marketing Feed** — Companies publish product catalogues, innovations, and case studies to a feed. Active companies earn a higher `feed_visibility_score`, which boosts their ranking in nearby salesmen's map searches. This creates the commercial loop: post → get discovered → get meetings.

**Target users:** B2B salespeople (field, traveling) and company marketing/sales teams.
**Primary geography:** India (GST number trust signal, Photon geocoder tuned for Indian addresses, default map center Mumbai).

---

## Running the Project

```bash
# 1. Start local Photon geocoder (required for CSV/XLSX import)
cd geocoder
java -jar photon-0.5.0.jar -listen-ip 0.0.0.0 -listen-port 2322

# 2. Start backend (auto-reloads with nodemon)
cd backend
npm run dev       # → http://localhost:3000

# 3. Serve frontend (any static server)
npx http-server frontend -p 8080 -c-1
# → http://localhost:8080
```

**External services that must be reachable:**
- `router.project-osrm.org` — routing/directions (free, external)
- `tile.openstreetmap.org` — map tiles (cached by service worker after first load)

**Services that run locally:**
- Photon geocoder on `:2322`
- PostgreSQL on `:5432`
- Express API on `:3000`

---

## What Is Already Built (Phase 0)

The following is fully working in the current codebase:

| Feature | Where |
|---|---|
| Interactive Leaflet.js map (OpenStreetMap tiles) | `frontend/index.html` |
| CSV / XLSX bulk import with column mapping UI | `frontend/index.html` (inline JS) |
| In-browser Photon geocoding fallback | `frontend/index.html` |
| Radius-based nearby client search (Haversine, client-side) | `frontend/index.html` |
| "Search This Area" — click to place custom pin + search | `frontend/index.html` |
| Text search filtering clients by name/address | `frontend/index.html` |
| Live GPS tracking (`watchPosition`) | `frontend/index.html` |
| Turn-by-turn routing via OSRM, polyline on map | `frontend/index.html` |
| PWA service worker with map tile offline caching | `frontend/sw.js` |
| Backend geocode-and-store via Photon | `backend/server.js` |
| `POST /clients/bulk` — bulk import with geocoding | `backend/server.js` |
| `GET /clients/nearby` — PostGIS radius query | `backend/server.js` |
| `POST /route` — OSRM proxy | `backend/server.js` |
| `GET /health` — health check | `backend/server.js` |

**Database baseline (already exists):**
- `clients` table: `id`, `name`, `address`, `latitude`, `longitude`, `geom` (PostGIS), `created_at`
- `geocode_cache` table: `address_key`, `latitude`, `longitude`, `display_name`

---

## Known Bugs — Fix These First

### Bug 1: PostGIS Spatial Index Is Never Used

**File:** `backend/server.js` — the `GET /clients/nearby` handler

**Problem:** The WHERE clause reconstructs the geography inline on every row, which forces a sequential scan:
```sql
-- CURRENT (broken — cannot use GIST index):
WHERE ST_DWithin(
    ST_GeogFromText('SRID=4326;POINT(' || longitude || ' ' || latitude || ')'),
    ST_GeogFromText('SRID=4326;POINT($2 $1)'),
    $3 * 1000
)
```

**Fix:** Use the pre-stored `geom` column:
```sql
-- CORRECT (uses the GIST index):
WHERE ST_DWithin(
    geom,
    ST_GeogFromText('SRID=4326;POINT(' || $lon || ' ' || $lat || ')'),
    $radius_km * 1000
)
```

This changes query performance from O(n) full-table scan to O(log n) index lookup. Fix this before the `companies` table has real data.

### Bug 2: `geom` Column Is Never Populated on Insert

**File:** `backend/server.js` — the `POST /clients/bulk` INSERT query

**Problem:** The INSERT stores `latitude` and `longitude` as floats but does not populate the `geom` column. The GIST index on `geom` has no data to index.

**Fix:** Add `geom` to the INSERT:
```sql
INSERT INTO clients (name, address, latitude, longitude, geom)
VALUES ($1, $2, $3, $4,
    ST_GeogFromText('SRID=4326;POINT(' || $4 || ' ' || $3 || ')')
)
```

Or equivalently using `ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography`.

---

## Architecture Decisions — Do Not Relitigate

These decisions were made deliberately. Do not change them without a documented reason.

### 1. Multi-Page App (MPA), Not SPA

The map module needs Leaflet.js (canvas rendering, GPS APIs). The feed module needs Alpine.js (reactive list state). Keeping them as separate HTML pages means each page loads only what it needs. The shared auth token is re-hydrated on every page via a silent `POST /api/auth/refresh` call on load. Do not introduce a client-side router.

### 2. UUID Primary Keys for All New Tables

New tables (users, companies, posts, meetings) use `gen_random_uuid()` UUIDs. This prevents ID enumeration attacks (`/api/companies/1`, `2`, `3`). The existing `clients` and `geocode_cache` tables keep their serial PKs — do not change them.

### 3. Denormalised Counters with Nightly Reconciliation

`posts.like_count`, `posts.comment_count`, `companies.follower_count` are maintained as columns updated by the application layer on every action. Do not run `COUNT(*)` aggregates at query time — on a feed loading 20 posts this would be 20 subqueries. A nightly `node-cron` job recounts and corrects any drift.

### 4. `feed_visibility_score` — Updated Nightly, Used in Map Sort

The map ranking formula is `distance_km * (1 / feed_visibility_score)`. A company 3km away with score 1.5 ranks above a competitor 2km away with score 1.0. Score is recomputed nightly:

```sql
UPDATE companies SET
    feed_active = (last_post_at > NOW() - INTERVAL '30 days'),
    feed_visibility_score =
        1.0
        + (CASE WHEN last_post_at > NOW() - INTERVAL '7 days' THEN 0.5 ELSE 0 END)
        + LEAST(follower_count::float / 100, 1.0);
```

This is the core commercial incentive for companies to post.

### 5. File Storage Behind `storage.js` Abstraction

All file I/O goes through `backend/services/storage.js`. No code outside this file should ever call `fs.writeFile`, construct upload paths, or call S3 directly. The current implementation uses local disk; the Phase 4 migration to S3/R2 changes only this one file.

### 6. Comments Use Soft Delete

`post_comments` has `is_deleted BOOLEAN DEFAULT false`. Deleting a comment sets this flag; it does not remove the row. This preserves thread structure — a deleted parent comment that has replies shows "This comment was deleted" rather than breaking the thread.

### 7. `clients` Table Kept Alive with a Bridge

The existing `clients` table is not dropped. During Phase 1, a migration creates corresponding `companies` rows for each `clients` row, setting `legacy_client_id` as a FK. The legacy API endpoints continue to work. The `clients` table is fully deprecated in Phase 4 after all data is confirmed migrated.

### 8. Auth Token Strategy — Memory + httpOnly Cookie

```
Access token:   JWT, HS256, 15-minute expiry
                Stored in: JavaScript memory variable ONLY
                (never localStorage, never sessionStorage — prevents XSS theft)

Refresh token:  Opaque random token, stored as bcrypt hash in refresh_tokens table
                Stored in: httpOnly, Secure, SameSite=Strict cookie
                (JavaScript cannot read this — prevents XSS)
```

On every page load, `js/auth.js` calls `POST /api/auth/refresh`. If the cookie is valid, a new 15-minute access token is returned into memory. Every 14 minutes, `setInterval` triggers another silent refresh.

---

## Target Folder Structure

This is what the project should look like after Phase 1 restructuring:

```
backend/
├── server.js                       # App setup only: register routes, middleware, start listen
├── config.js                       # All env vars with defaults and validation
├── package.json
├── .env                            # Not committed
├── .env.example                    # Committed, no real values
│
├── routes/
│   ├── auth.js                     # POST /api/auth/*
│   ├── companies.js                # GET/POST/PUT /api/companies/*
│   ├── map.js                      # GET /api/map/nearby, /bounds; POST /api/map/trip, /route
│   ├── meetings.js                 # GET/POST /api/meetings/*
│   ├── posts.js                    # POST /api/posts, likes, comments, media
│   ├── feed.js                     # GET /api/feed, /api/feed/discover
│   ├── upload.js                   # POST /api/upload/image, /document
│   ├── users.js                    # GET/PUT /api/users/me, notifications, followed-companies
│   └── legacy.js                   # /clients/bulk, /clients/nearby, /route, /health (backward compat)
│
├── middleware/
│   └── auth.js
│       # authenticateToken(req, res, next)     — verifies JWT, sets req.user
│       # requireRole(...roles)                 — returns middleware checking req.user.role
│       # requireCompanyAccess(req, res, next)  — req.user.company_id === req.params.id
│       # optionalAuth(req, res, next)          — sets req.user if token present, continues if not
│
├── services/
│   ├── geocode.js                  # geocodeAddress(address) → {lat, lon} — wraps Photon + DB cache
│   ├── routing.js                  # getRoute(from, to, mode), getTripOrder(waypoints)
│   ├── storage.js                  # upload(buffer, filename, context) → {url, thumbnail_url?}
│   └── notifications.js            # createNotification(userId, type, data) → void
│
├── db/
│   ├── pool.js                     # pg Pool instance (existing)
│   ├── init.sql                    # Base schema: clients, geocode_cache (existing)
│   └── migrations/
│       ├── 001_reference_tables.sql
│       ├── 002_auth.sql
│       ├── 003_companies.sql
│       ├── 004_products.sql
│       ├── 005_posts.sql
│       ├── 006_follows.sql
│       ├── 007_meetings.sql
│       └── 008_notifications.sql
│
└── uploads/                        # Served as /files/* — gitignored
    ├── companies/logos/
    ├── companies/covers/
    ├── products/images/
    ├── products/catalogues/
    └── posts/media/

frontend/
├── index.html                      # Map module
├── feed.html                       # Social feed
├── company.html                    # Company profile (tabs: Info, Products, Posts, Meetings)
├── meetings.html                   # Meetings inbox (both salesman and company views)
├── profile.html                    # User profile + settings
├── login.html                      # Register / login
├── manifest.json                   # PWA manifest
│
├── js/
│   ├── api.js                      # fetch(url, options) wrapper
│   │                               # — injects Authorization: Bearer <token>
│   │                               # — on 401: calls refresh once, retries request, then /login
│   ├── auth.js                     # let accessToken = null  (module-level, in memory)
│   │                               # initAuth() — calls /api/auth/refresh on load
│   │                               # scheduleRefresh() — setInterval every 14 min
│   ├── utils.js                    # formatDate, formatDistance, debounce, throttle, toast
│   └── modules/
│       ├── map.js                  # class MapApp { init, loadNearby, addMarkers, ... }
│       ├── map-filters.js          # Industry/category filter panel, triggers map reload
│       ├── map-company-popup.js    # Popup: company name, distance, latest post, buttons
│       ├── feed.js                 # IntersectionObserver infinite scroll, post rendering
│       ├── post-editor.js          # Create post: type, content, tags, media upload
│       ├── company-profile.js      # Tab switching, data loading per tab
│       ├── catalogue.js            # Product grid, PDF iframe viewer
│       ├── meetings.js             # Meeting list, request form, accept/decline/complete actions
│       └── notifications.js        # Bell icon, unread count badge, polling
│
├── css/
│   ├── base.css                    # :root CSS custom properties (colors, spacing, radius)
│   │                               # CSS reset, typography, dark mode media query
│   ├── components.css              # .btn, .card, .modal, .badge, .spinner, .toast
│   ├── map.css                     # #map, .sidebar, .filter-panel, .popup-card
│   ├── feed.css                    # .feed-container, .post-card, .post-actions
│   └── company.css                 # .company-header, .tabs, .product-grid
│
├── images/
│   ├── marker-icon.png
│   ├── marker-shadow.png
│   └── marker-user.png             # Distinct pin for user's own location
│
└── sw.js                           # Service worker — cache app shell + tiles + discovery feed
```

---

## Database Schema — All Tables

### Reference / Lookup
```sql
industries (id SERIAL PK, name, slug UNIQUE, icon, created_at)
product_categories (id SERIAL PK, name, slug UNIQUE, parent_id → self, created_at)
```

### Auth
```sql
users (
    id UUID PK DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    role user_role NOT NULL DEFAULT 'salesman',   -- ENUM: salesman|company_member|company_admin|platform_admin
    company_id UUID → companies(id) SET NULL,
    avatar_url TEXT, phone VARCHAR(20),
    is_verified BOOL DEFAULT false, is_active BOOL DEFAULT true,
    last_seen_at TIMESTAMP, created_at TIMESTAMP, updated_at TIMESTAMP
)

refresh_tokens (
    id UUID PK, user_id UUID → users CASCADE,
    token_hash VARCHAR(255) NOT NULL,              -- bcrypt hash, never raw token
    expires_at TIMESTAMP NOT NULL, created_at TIMESTAMP
)
INDEX: (user_id), (token_hash)
```

### Companies
```sql
companies (
    id UUID PK, slug VARCHAR(200) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL, description TEXT,
    logo_url TEXT, cover_image_url TEXT, website_url TEXT,
    phone VARCHAR(20), email VARCHAR(255),
    gstin VARCHAR(20),                             -- Indian GST number (trust signal)
    founded_year SMALLINT, employee_range employee_range,
    annual_revenue_range VARCHAR(50),              -- '1Cr-10Cr', '10Cr-100Cr'
    address TEXT, city VARCHAR(100), state VARCHAR(100), country VARCHAR(100) DEFAULT 'India',
    pincode VARCHAR(20), latitude FLOAT, longitude FLOAT,
    geom GEOGRAPHY(POINT, 4326),                  -- GIST indexed
    is_verified BOOL DEFAULT false,
    verification_tier verification_tier DEFAULT 'none',
    is_active BOOL DEFAULT true,
    feed_active BOOL DEFAULT false,               -- posted in last 30 days
    feed_visibility_score FLOAT DEFAULT 1.0,      -- updated nightly
    last_post_at TIMESTAMP,
    follower_count INT DEFAULT 0,                 -- denormalised
    post_count INT DEFAULT 0,                     -- denormalised
    legacy_client_id INT → clients(id) SET NULL,
    created_at TIMESTAMP, updated_at TIMESTAMP
)
INDEXES: GIST(geom), (city), (feed_visibility_score DESC), (is_active, feed_active)

company_industries (company_id UUID, industry_id INT, PRIMARY KEY(company_id, industry_id))
company_product_categories (company_id UUID, category_id INT, PRIMARY KEY(company_id, category_id))
```

### Products
```sql
products (
    id UUID PK, company_id UUID → companies CASCADE,
    name VARCHAR(255) NOT NULL, description TEXT, sku VARCHAR(100),
    price_min DECIMAL(15,2), price_max DECIMAL(15,2),
    currency VARCHAR(10) DEFAULT 'INR', unit VARCHAR(50),
    min_order_qty INT, category_id INT → product_categories,
    is_active BOOL DEFAULT true, display_order INT DEFAULT 0,
    created_at TIMESTAMP, updated_at TIMESTAMP
)

product_media (
    id UUID PK, product_id UUID → products CASCADE,
    company_id UUID → companies CASCADE,
    media_type VARCHAR(20) NOT NULL,              -- 'image' | 'pdf'
    url TEXT NOT NULL, thumbnail_url TEXT,
    file_name VARCHAR(255), file_size_bytes INT, display_order INT DEFAULT 0,
    created_at TIMESTAMP
)
```

### Posts / Social Feed
```sql
posts (
    id UUID PK, company_id UUID → companies CASCADE,
    author_user_id UUID → users,
    post_type post_type NOT NULL DEFAULT 'update',
    -- ENUM: product_launch|innovation|case_study|news|update|event|offer
    title VARCHAR(500), content TEXT NOT NULL,
    is_published BOOL DEFAULT true,
    like_count INT DEFAULT 0,                     -- denormalised
    comment_count INT DEFAULT 0,                  -- denormalised
    view_count INT DEFAULT 0,                     -- denormalised
    published_at TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP, updated_at TIMESTAMP
)
INDEXES: (company_id, is_published, published_at DESC), (is_published, published_at DESC)

post_tags (post_id UUID, tag VARCHAR(100), PRIMARY KEY(post_id, tag))
INDEX: (tag)

post_media (
    id UUID PK, post_id UUID → posts CASCADE,
    media_type VARCHAR(20),                       -- 'image' | 'video' | 'pdf' | 'link'
    url TEXT NOT NULL, thumbnail_url TEXT,
    file_name VARCHAR(255), file_size_bytes INT,
    link_title VARCHAR(255), link_description TEXT,  -- for OG preview cards
    display_order INT DEFAULT 0, created_at TIMESTAMP
)

post_likes (
    id UUID PK, post_id UUID → posts CASCADE,
    user_id UUID → users CASCADE,
    created_at TIMESTAMP,
    UNIQUE(post_id, user_id)
)

post_comments (
    id UUID PK, post_id UUID → posts CASCADE,
    parent_comment_id UUID → post_comments SET NULL,  -- thread nesting
    user_id UUID → users CASCADE,
    content TEXT NOT NULL,
    like_count INT DEFAULT 0,
    is_deleted BOOL DEFAULT false,                -- SOFT DELETE — preserves thread structure
    created_at TIMESTAMP, updated_at TIMESTAMP
)
INDEX: (post_id, created_at ASC)

-- Unified follows: user→company OR company→company (exactly one follower column must be set)
follows (
    id UUID PK,
    follower_user_id UUID → users CASCADE,        -- NULL if company-follows-company
    follower_company_id UUID → companies CASCADE, -- NULL if user-follows-company
    following_company_id UUID → companies CASCADE NOT NULL,
    created_at TIMESTAMP,
    CONSTRAINT chk_exactly_one_follower CHECK (
        (follower_user_id IS NOT NULL AND follower_company_id IS NULL) OR
        (follower_user_id IS NULL AND follower_company_id IS NOT NULL)
    ),
    UNIQUE(follower_user_id, following_company_id),
    UNIQUE(follower_company_id, following_company_id)
)
INDEXES: (following_company_id), (follower_user_id)
```

### Meetings
```sql
meetings (
    id UUID PK,
    title VARCHAR(255) NOT NULL,
    meeting_type meeting_type NOT NULL DEFAULT 'ad_hoc',
    -- ENUM: ad_hoc|scheduled|follow_up
    status meeting_status NOT NULL DEFAULT 'requested',
    -- ENUM: requested|accepted|declined|completed|cancelled|no_show
    requested_by_user_id UUID → users,
    host_company_id UUID → companies,
    proposed_at TIMESTAMP NOT NULL,
    confirmed_at TIMESTAMP,
    duration_minutes INT DEFAULT 30,
    location_address TEXT, location_lat FLOAT, location_lon FLOAT,
    notes TEXT,                                   -- salesman's pre-meeting context
    outcome TEXT,                                 -- filled after meeting
    outcome_tags VARCHAR(50)[],                   -- ARRAY['interested','follow_up_needed']
    created_at TIMESTAMP, updated_at TIMESTAMP
)
INDEXES: (host_company_id, status), (requested_by_user_id, status), (proposed_at)

meeting_attendees (
    meeting_id UUID, user_id UUID,
    role VARCHAR(20) DEFAULT 'attendee',          -- 'organizer' | 'attendee' | 'optional'
    status VARCHAR(20) DEFAULT 'pending',         -- 'pending' | 'accepted' | 'declined'
    PRIMARY KEY(meeting_id, user_id)
)
```

### Notifications & Activity
```sql
notifications (
    id UUID PK, user_id UUID → users CASCADE,
    type notification_type NOT NULL,
    -- ENUM: meeting_requested|meeting_accepted|meeting_declined|meeting_completed
    --       new_follower|new_post|post_liked|post_commented
    title VARCHAR(255) NOT NULL, body TEXT,
    data JSONB,                                   -- {entity_type: 'meeting', entity_id: '<uuid>'}
    is_read BOOL DEFAULT false, created_at TIMESTAMP
)
INDEX: (user_id, is_read, created_at DESC)

visit_logs (
    id UUID PK, user_id UUID → users CASCADE, company_id UUID → companies CASCADE,
    visit_type VARCHAR(50) NOT NULL,              -- 'profile_view' | 'map_pin_tap' | 'meeting_completed'
    metadata JSONB, created_at TIMESTAMP
)
INDEX: (company_id, created_at DESC)

company_signals (
    id UUID PK, company_id UUID → companies CASCADE,
    signal_type VARCHAR(50) NOT NULL,             -- 'recent_purchase' | 'tender' | 'expansion' | 'hiring'
    signal_data JSONB, signal_date DATE, source VARCHAR(100),
    created_at TIMESTAMP
)
INDEX: (company_id, signal_date DESC)
```

---

## Role Matrix

| Capability | salesman | company_member | company_admin | platform_admin |
|---|:---:|:---:|:---:|:---:|
| View profiles, map, discovery feed | ✓ | ✓ | ✓ | ✓ |
| View personalised feed | ✓ | ✓ | ✓ | ✓ |
| Follow companies | ✓ | — | ✓ | ✓ |
| Request meetings | ✓ | — | — | ✓ |
| Accept / decline meetings | — | ✓ | ✓ | ✓ |
| Create / edit posts | — | ✓ | ✓ | ✓ |
| Manage products / catalogue | — | ✓ | ✓ | ✓ |
| Manage company profile | — | — | ✓ | ✓ |
| Manage team members | — | — | ✓ | ✓ |
| View buying signals | ✓ | — | ✓ | ✓ |
| Platform ops + verification | — | — | — | ✓ |

---

## Auth Flow (Detailed)

```
LOGIN:
  POST /api/auth/login
    → server: verify password, create refresh_token row (store hash), set httpOnly cookie
    → response: {access_token (JWT, 15min)}
    → client: store access_token in module-level variable in auth.js

PAGE LOAD (on every page):
  auth.js initAuth()
    → POST /api/auth/refresh  (cookie sent automatically)
    → if 200: store new access_token in memory, scheduleRefresh()
    → if 401: redirect to /login.html

API REQUESTS:
  api.js wraps fetch()
    → injects Authorization: Bearer <accessToken>
    → on 401 response: calls initAuth() once, retries original request
    → on second 401: redirect to /login.html

SILENT REFRESH (every 14 min):
  setInterval(() => initAuth(), 14 * 60 * 1000)

LOGOUT:
  POST /api/auth/logout  (cookie sent automatically)
    → server: deletes refresh_token row, clears cookie
    → client: set accessToken = null, redirect to /login.html
```

---

## Phase-by-Phase Implementation Plan

### Phase 1 — Core Fixes + Auth (Weeks 1–3)

**Goal:** Stabilise the foundation, add authentication, restructure the codebase.

**Backend:**
1. Restructure `server.js` → `routes/`, `middleware/`, `services/` (keep the same logic, just move it)
2. Extract geocode logic → `services/geocode.js`, routing → `services/routing.js`
3. **Fix Bug 1**: use stored `geom` column in nearby query (see Known Bugs above)
4. **Fix Bug 2**: populate `geom` column in bulk INSERT
5. Add packages: `bcryptjs`, `jsonwebtoken`, `uuid`, `helmet`, `express-rate-limit`
6. Create `middleware/auth.js` with `authenticateToken`, `requireRole`, `requireCompanyAccess`, `optionalAuth`
7. Implement auth routes: register, login, refresh, logout
8. Run migrations 001, 002, 003
9. Data migration: for each `clients` row → create corresponding `companies` row with correct `geom`
10. Seed `industries` and `product_categories` from a static JSON file
11. Basic company GET endpoints: `GET /api/companies/:id`, `GET /api/companies/slug/:slug`

**Frontend:**
1. Extract inline CSS → `css/map.css`, extract inline JS → `js/modules/map.js`
2. Create `js/api.js` (fetch wrapper with auth injection and 401 retry)
3. Create `js/auth.js` (in-memory token, initAuth, scheduleRefresh)
4. Create `login.html` with register and login forms
5. Add auth guard to `index.html`: call `initAuth()` on load, redirect if fails
6. Add bottom nav bar HTML to all pages (Map, Feed, Meetings, Profile icons)
7. Update `sw.js` to cache new JS modules and CSS paths

---

### Phase 2 — Company Profiles + Meetings (Weeks 4–6)

**Goal:** Full company profile pages, product catalogues, and the meeting workflow.

**Backend:**
1. Run migrations 004, 007, 008
2. Full company CRUD: `PUT /api/companies/:id`, member management endpoints
3. Full products CRUD: all endpoints under `/api/companies/:id/products`
4. Add packages: `multer`, `sharp`, `express-validator`
5. File upload routes: `POST /api/upload/image` (with sharp resizing), `POST /api/upload/document`
6. Full meetings API: all status transitions (request → accept/decline → complete/cancel)
7. `services/notifications.js`: create notification rows on meeting status change
8. Enhanced map API: `GET /api/map/nearby` with industry/category/verified filters, `feed_visibility_score` sort
9. `POST /api/map/trip`: OSRM `/trip/v1` wrapper for multi-stop optimisation

**Frontend:**
1. `company.html`: tabbed layout — Info, Products, Meetings, (Posts — placeholder for Phase 3)
2. `meetings.html`: salesman view (sent requests + status badges), company view (inbox, accept/decline actions)
3. Update map popup in `map.js`: company name, industry, distance, "View Profile" and "Route Here" buttons
4. `map-filters.js`: industry chip multi-select, "Verified only" toggle, "Active on feed" toggle
5. Notification bell in nav (polls `GET /api/users/me/notifications` every 60 seconds, shows unread badge)
6. `profile.html`: user info display, edit form

---

### Phase 3 — Feed / Social (Weeks 7–10)

**Goal:** Full B2B marketing feed and the map-to-feed integration.

**Backend:**
1. Run migrations 005, 006
2. Full posts API: CRUD, like/unlike, threaded comments, media attachment
3. `GET /api/feed` — personalised feed (cursor-paginated, followed companies):
   ```sql
   SELECT p.* FROM posts p
   JOIN follows f ON f.following_company_id = p.company_id
   WHERE f.follower_user_id = $userId
     AND p.is_published = true AND p.published_at < $cursor
   ORDER BY p.published_at DESC LIMIT 20
   ```
4. `GET /api/feed/discover` — public, no auth, for SEO and first-time visitors
5. Follows API: follow, unfollow, check, list
6. Nightly `node-cron` job: recalculate `feed_active` and `feed_visibility_score` for all companies
7. Notifications for: new follower, post liked, post commented
8. Increment `view_count` on `GET /api/posts/:id` (fire-and-forget UPDATE, don't await)

**Frontend:**
1. `feed.html`: post feed with Alpine.js. Like/unlike toggle (optimistic UI), comment expand/collapse, infinite scroll via `IntersectionObserver`
2. `post-editor.js`: type selector, content textarea, tag input, drag-drop media upload
3. `company.html`: add Posts tab (company's own post history), Follow/Unfollow toggle button
4. Update `map.js` / `map-company-popup.js`: feed-active companies get a distinct pin colour or badge; popup shows their latest post preview
5. Update `sw.js`: stale-while-revalidate for discovery feed responses

---

### Phase 4 — Analytics + PWA Polish (Weeks 11–14)

**Goal:** Analytics, push notifications, full PWA, production hardening.

**Backend:**
1. Analytics endpoints (company admins only):
   - `GET /api/companies/:id/analytics/views` — from `visit_logs`
   - `GET /api/companies/:id/analytics/engagement` — post engagement over time
   - `GET /api/companies/:id/analytics/meetings` — meeting funnel
2. Web Push: `web_push_subscriptions` table, push on meeting/follow events
3. Platform admin endpoints: company verification workflow
4. Rate limit audit: tighten upload and post creation limits
5. `storage.js` Phase 4 migration: swap local `fs` implementation for S3/R2 SDK — same interface, no other file changes

**Frontend:**
1. Analytics tab on `company.html` (company_admin only): line charts with Chart.js
2. "Enable notifications" button in `profile.html`: `PushManager.subscribe` → POST subscription to backend
3. `manifest.json`: `standalone` display, 192/512 icons, `start_url: /index.html`
4. `sw.js` upgrade: Background Sync API for offline meeting requests; cache last-viewed company profiles

---

## New Package Dependencies by Phase

```json
// Phase 1 additions to backend/package.json
"bcryptjs": "^2.4.3",
"jsonwebtoken": "^9.0.0",
"uuid": "^9.0.0",
"helmet": "^7.0.0",
"express-rate-limit": "^7.0.0"

// Phase 2 additions
"multer": "^1.4.5-lts.1",
"sharp": "^0.32.0",
"express-validator": "^7.0.0"

// Phase 3 additions
"node-cron": "^3.0.0"

// Phase 4 additions (S3 migration path)
"@aws-sdk/client-s3": "^3.0.0"  // OR "@cloudflare/r2" — only if migrating
```

---

## Image Processing Rules

Applied in `services/storage.js` via `sharp`:

| Context | Max dimensions | Format | Quality | Also create |
|---|---|---|---|---|
| `company_logo` | 400×400 | JPEG | 85 | 80×80 thumbnail |
| `company_cover` | 1200×400 (crop center) | JPEG | 85 | 400×133 thumbnail |
| `product` | 800px wide max | JPEG | 80 | — |
| `post` | 1200px wide max | JPEG | 80 | — |
| `catalogue` (PDF) | — (no processing) | PDF | — | — |

File naming: `{uuid}.{ext}` — never use original filename (prevents path traversal).

---

## Critical Files to Know

| File | What's in it | Phase it changes |
|---|---|---|
| `backend/server.js` | Monolith: all routes + geocoding + routing inline. PostGIS bug here. | Phase 1: decompose |
| `backend/db/init.sql` | Base schema: `clients`, `geocode_cache` | Phase 1: add migrations alongside |
| `frontend/index.html` | 1100-line monolith: all map JS and CSS inline | Phase 1: extract to modules |
| `frontend/sw.js` | Service worker: must be updated whenever new pages or JS modules are added | Every phase |
| `backend/services/storage.js` | File upload abstraction (to be created Phase 2) | Phase 2, Phase 4 |
| `backend/db/migrations/` | All new schema (to be created) | Phases 1–4 |
