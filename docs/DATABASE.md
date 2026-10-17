# DATABASE.md

Complete reference for all PostgreSQL tables in GeoSales.ai — storage types, indexes, and architecture decisions.

---

## Storage Systems

| # | Storage | Engine | What lives here |
|---|---|---|---|
| 1 | **PostgreSQL** (local, port 5432) | Relational + PostGIS | Everything — companies, users, auth, spatial queries, products, feed, meetings, notifications |
| 2 | **Local filesystem** (`backend/uploads/`) | Plain files, served as `/files/*` | Uploaded binaries: logos, cover images, product photos, ERP Excel files, PDF catalogues |
| 3 | **Service worker cache** (browser) | Cache Storage API | Map tiles (OSM vector tiles), app shell HTML/JS/CSS — offline use |
| 4 | **Zustand store** (in-memory, app process) | JS memory | Access token (never persisted), map state, filter state, current user |
| 5 | **expo-secure-store** (device keychain) | iOS Keychain / Android Keystore | Refresh token on mobile — encrypted OS-managed, survives app restart |

No Neo4j. No Redis. No MongoDB. No separate graph server. Everything queryable is in PostgreSQL.

---

## Migration Run Order

```
backend/db/init.sql                      -- clients, geocode_cache (legacy base)
backend/db/migrations/001_reference_tables.sql
backend/db/migrations/002_auth.sql
backend/db/migrations/003_companies.sql
backend/db/migrations/004_salesman_clients.sql
backend/db/migrations/005_posts.sql
backend/db/migrations/006_follows.sql
backend/db/migrations/007_meetings.sql
backend/db/migrations/008_notifications.sql
backend/db/migrations/009_company_locations.sql
backend/db/migrations/010_mca_source.sql
```

---

## Domain 1 — Product Taxonomy (the graph)

| Table | PK type | Key columns + types | Special storage | Purpose |
|---|---|---|---|---|
| `industries` | `SMALLSERIAL` | `slug VARCHAR UNIQUE`, `nic_code_range VARCHAR`, `sort_order SMALLINT` | — | 10 sector labels (Steel, Pharma…). Reference data |
| `product_categories` | `SERIAL` | `parent_id INT → self`, `level SMALLINT(0–2)`, `keywords TEXT[]`, `nic_code VARCHAR` | `GIN(keywords)`, `B-tree(parent_id)` | Tree stored as adjacency list. 3 levels: sector → group → leaf |
| `product_name_aliases` | `SERIAL` | `raw_pattern VARCHAR UNIQUE`, `category_id INT → product_categories`, `match_method ENUM(exact/regex/token/manual)` | — | ERP raw strings mapped to leaf categories. Grows over time |

### Product Tree Structure

```
Level 0 — Sector:    Steel & Metals
  Level 1 — Group:     Long Products
    Level 2 — Leaf:      TMT Bars        ← companies link here
    Level 2 — Leaf:      Wire Rods
  Level 1 — Group:     Flat Products
    Level 2 — Leaf:      HR Coils
    Level 2 — Leaf:      CR Coils
```

Tree traversal with recursive CTE:

```sql
WITH RECURSIVE subtree AS (
  SELECT id FROM product_categories WHERE slug = 'steel-metals'
  UNION ALL
  SELECT pc.id FROM product_categories pc
  JOIN subtree s ON pc.parent_id = s.id
)
SELECT * FROM subtree;
```

### Buy / Sell Graph

```
companies ──[company_products_sell]──▶ product_categories (leaf)
                                              │ parent_id FK
                                       product_categories (group)
                                              │ parent_id FK
                                       product_categories (sector)

companies ──[company_products_buy]───▶ product_categories (leaf)
```

Two separate edge tables (BUY / SELL) pointing into the same category tree. Indexed joins on `category_id` are O(log n).

```sql
-- Find companies that BUY TMT Bars near Mumbai
SELECT c.name, c.city,
       ST_Distance(c.geom, ST_GeogFromText('SRID=4326;POINT(72.88 19.07)')) / 1000 AS dist_km
FROM companies c
JOIN company_products_buy cpb ON cpb.company_id = c.id
WHERE cpb.category_id = (SELECT id FROM product_categories WHERE slug = 'tmt-bars')
  AND ST_DWithin(c.geom, ST_GeogFromText('SRID=4326;POINT(72.88 19.07)'), 10000)
ORDER BY dist_km;
```

---

## Domain 2 — Companies & Locations (spatial)

| Table | PK type | Key columns + types | Special storage | Purpose |
|---|---|---|---|---|
| `companies` | `UUID` | `geom GEOGRAPHY(POINT,4326)`, `feed_visibility_score FLOAT`, `geocode_status ENUM`, `source_data JSONB`, `name VARCHAR` | `GIST(geom)`, `GIN(name gin_trgm_ops)`, `GIN(to_tsvector(name))` | Master company record. `source_data JSONB` holds raw MCA fields |
| `company_locations` | `UUID` | `company_id UUID → companies`, `location_type ENUM(HQ/branch/plant…)`, `geom GEOGRAPHY(POINT,4326)`, `is_primary BOOL` | `GIST(geom)`, partial index on `is_primary=true` | Multiple offices per company. Trigger syncs `is_primary=true` row back to `companies.geom` |
| `company_industries` | Composite `(company_id, industry_id)` | `company_id UUID → companies`, `industry_id SMALLINT → industries` | — | M:N junction. Which sectors a company operates in |
| `company_products_sell` | `UUID` | `company_id UUID → companies`, `category_id INT → product_categories`, `product_label VARCHAR` | `B-tree(category_id)` | SELL graph edge. What this company supplies |
| `company_products_buy` | `UUID` | `company_id UUID → companies`, `category_id INT → product_categories`, `estimated_monthly_qty VARCHAR` | `B-tree(category_id)` | BUY graph edge. What this company procures |

### Trigger: Primary Location Sync

When `company_locations.is_primary = true` is updated, a trigger automatically writes `lat/lon/geom/city/state` back to the `companies` row. This keeps the backward-compatible `companies.geom` in sync without application logic.

```sql
-- defined in 009_company_locations.sql
CREATE TRIGGER trg_sync_primary_location
    AFTER INSERT OR UPDATE ON company_locations
    FOR EACH ROW EXECUTE FUNCTION sync_primary_location();
```

### Spatial Query Pattern

```sql
-- Map nearby query — uses GIST index, O(log n)
SELECT c.name, ST_Distance(cl.geom, $point) / 1000 AS dist_km
FROM company_locations cl
JOIN companies c ON c.id = cl.company_id
WHERE ST_DWithin(cl.geom, ST_GeogFromText('SRID=4326;POINT($lon $lat)'), $radius_m)
ORDER BY dist_km;
```

---

## Domain 3 — Auth

| Table | PK type | Key columns + types | Special storage | Purpose |
|---|---|---|---|---|
| `users` | `UUID` | `email VARCHAR UNIQUE`, `password_hash VARCHAR`, `role ENUM(salesman/company_member/company_admin/platform_admin)`, `company_id UUID → companies` | `B-tree(email)`, `B-tree(company_id)` | One row per person |
| `refresh_tokens` | `UUID` | `user_id UUID → users CASCADE`, `token_hash VARCHAR(64) UNIQUE`, `expires_at TIMESTAMPTZ` | `B-tree(user_id)`, `B-tree(expires_at)` | SHA-256 hashes only. Raw token in device Keychain / httpOnly cookie |

### Token Strategy

```
Access token:   JWT, HS256, 15-min expiry — JS memory only, never stored
Refresh token:  Opaque random → SHA-256 hash stored here → raw in httpOnly cookie (web) / Keychain (mobile)
```

---

## Domain 4 — Salesman Private Data (ERP upload)

| Table | PK type | Key columns + types | Special storage | Purpose |
|---|---|---|---|---|
| `salesman_clients` | `UUID` | `owner_user_id UUID → users`, `geom GEOGRAPHY(POINT,4326)`, `last_order_amount DECIMAL(14,2)`, `raw_data JSONB`, `geocode_status ENUM` | `GIST(geom)`, `B-tree(owner_user_id)` | ERP customers as private map pins. `raw_data JSONB` stores original Excel row. Row-level ownership enforced in every query |
| `salesman_client_orders` | `UUID` | `client_id UUID → salesman_clients CASCADE`, `item_name_raw VARCHAR`, `category_id INT → product_categories`, `amount DECIMAL(14,2)`, `order_date DATE` | `B-tree(client_id)`, `B-tree(order_date DESC)` | Individual ERP lines. Many orders per client |
| `erp_uploads` | `UUID` | `user_id UUID → users`, `status ENUM(processing/geocoding/done/failed)`, `column_mapping JSONB`, `rows_imported INT` | — | Upload batch tracking. `column_mapping JSONB` records which Excel columns mapped to which fields |
| `geocoding_queue` | `BIGSERIAL` | `entity_type ENUM(company/salesman_client/company_location)`, `entity_id UUID`, `address_raw TEXT`, `status ENUM`, `attempt_count SMALLINT`, `next_retry_at TIMESTAMPTZ` | Partial index on `status IN ('pending','processing')` | Background geocoding job queue. `FOR UPDATE SKIP LOCKED` allows parallel workers without row collisions |

---

## Domain 5 — Feed / Social

| Table | PK type | Key columns + types | Special storage | Purpose |
|---|---|---|---|---|
| `posts` | `UUID` | `company_id UUID → companies`, `post_type ENUM(product_launch/case_study/news…)`, `like_count INT`, `comment_count INT`, `view_count INT`, `published_at TIMESTAMPTZ` | Composite index on `(company_id, is_published, published_at DESC)` | Denormalised counts avoid COUNT(*) subqueries on feed load |
| `post_tags` | Composite `(post_id, tag)` | `tag VARCHAR(100)` | `B-tree(tag)` | Tag-based discovery. Composite PK enforces one tag per post |
| `post_media` | `UUID` | `post_id UUID → posts`, `media_type VARCHAR(image/pdf/link)`, `url TEXT`, `link_title VARCHAR`, `display_order INT` | — | Ordered media/link attachments per post |
| `post_likes` | `UUID` | `post_id UUID → posts`, `user_id UUID → users`, `UNIQUE(post_id, user_id)` | `B-tree(post_id)` | Unique constraint prevents double-like at DB level |
| `post_comments` | `UUID` | `parent_comment_id UUID → self SET NULL`, `is_deleted BOOL DEFAULT false`, `like_count INT` | `B-tree(post_id, created_at ASC)` | Self-referencing FK for threaded comments. Soft delete preserves thread structure |
| `follows` | `UUID` | `follower_user_id UUID → users` (nullable), `follower_company_id UUID → companies` (nullable), `following_company_id UUID → companies NOT NULL`, `CHECK(exactly one follower column set)` | `B-tree(following_company_id)`, `B-tree(follower_user_id)` | User→company or company→company follows. CHECK constraint enforces exactly one follower side |

### Feed Query Pattern

```sql
-- Personalised feed — cursor paginated
SELECT p.* FROM posts p
JOIN follows f ON f.following_company_id = p.company_id
WHERE f.follower_user_id = $userId
  AND p.is_published = true
  AND p.published_at < $cursor
ORDER BY p.published_at DESC
LIMIT 20;
```

---

## Domain 6 — Meetings

| Table | PK type | Key columns + types | Special storage | Purpose |
|---|---|---|---|---|
| `meetings` | `UUID` | `status ENUM(requested/accepted/declined/completed/cancelled/no_show)`, `outcome_tags VARCHAR(50)[]`, `location_lat FLOAT`, `location_lon FLOAT`, `proposed_at TIMESTAMPTZ` | Composite index on `(host_company_id, status)` | Full meeting lifecycle. `outcome_tags` is a native array — no join table needed |
| `meeting_attendees` | Composite `(meeting_id, user_id)` | `role VARCHAR(organizer/attendee/optional)`, `status VARCHAR(pending/accepted/declined)` | — | Composite PK prevents duplicate attendees |

---

## Domain 7 — Notifications & Analytics

| Table | PK type | Key columns + types | Special storage | Purpose |
|---|---|---|---|---|
| `notifications` | `UUID` | `user_id UUID → users`, `type ENUM(meeting_requested/post_liked…)`, `data JSONB`, `is_read BOOL` | Index on `(user_id, is_read, created_at DESC)` | `data JSONB` carries entity reference `{entity_type, entity_id}` without per-type columns |
| `visit_logs` | `UUID` | `user_id UUID → users`, `company_id UUID → companies`, `visit_type VARCHAR`, `metadata JSONB`, `created_at TIMESTAMPTZ` | `B-tree(company_id, created_at DESC)` | Append-only analytics. `metadata JSONB` stores context (e.g. search term that led to visit) |
| `company_signals` | `UUID` | `company_id UUID → companies`, `signal_type VARCHAR(tender/expansion/hiring…)`, `signal_data JSONB`, `signal_date DATE` | `B-tree(company_id, signal_date DESC)` | Buying intent signals. JSONB for flexible schema per signal type |

---

## Domain 8 — Legacy (kept alive)

| Table | PK type | Key columns | Purpose |
|---|---|---|---|
| `clients` | `SERIAL` | `name`, `address`, `latitude`, `longitude`, `geom GEOGRAPHY` | Original table. Not dropped — `companies.legacy_client_id` FK points here |
| `geocode_cache` | `address_key VARCHAR` | `latitude`, `longitude`, `display_name` | Photon geocoding cache. Checked before every Photon HTTP call |

---

## All PostgreSQL Storage Types Used

| Type | Where used | Why |
|---|---|---|
| `UUID` | All new PKs | No ID enumeration attacks. `gen_random_uuid()` built-in via pgcrypto |
| `SERIAL` / `SMALLSERIAL` / `BIGSERIAL` | Legacy tables, geocoding_queue | Auto-increment for high-volume append-only tables |
| `GEOGRAPHY(POINT, 4326)` | companies, company_locations, salesman_clients | PostGIS type. Distance in metres on Earth's surface. Indexed by GIST |
| `JSONB` | source_data, raw_data, column_mapping, data, metadata, signal_data | Schema-flexible blobs. Binary-stored, queryable: `data->>'entity_id'`. GIN-indexable |
| `TEXT[]` | keywords (product_categories), outcome_tags (meetings) | Native array. GIN-indexed for `@>` containment queries |
| `ENUM` | user_role, post_type, meeting_status, geocode_status, location_type, company_source | Enforced at DB level. Stored as int internally (4 bytes) |
| `DECIMAL(14,2)` | order amounts, prices | Exact precision for money — never FLOAT for currency |
| `TIMESTAMPTZ` | all timestamps | Timezone-aware. Stored as UTC |
| `BOOLEAN` | is_active, is_deleted, is_primary, is_verified | 1-byte. Partial indexes on these are efficient |
| Composite PK | company_industries, post_tags, post_likes, meeting_attendees | Enforces uniqueness and acts as the index — no separate unique index needed |
| Self-referencing FK | product_categories (parent_id), post_comments (parent_comment_id) | Tree and thread structure inside one table. Traversed with `WITH RECURSIVE` |
| `GIST` index | all `geom` columns | Spatial index — O(log n) `ST_DWithin` radius queries |
| `GIN` index | `TEXT[]` keywords, `JSONB`, `tsvector`, `trgm` | Inverted index — fast containment and full-text search |

---

## Index Summary

| Index | Table | Type | Enables |
|---|---|---|---|
| `idx_companies_geom` | companies | GIST | Radius search on map |
| `idx_companies_name_trgm` | companies | GIN (trgm) | `ILIKE '%steel%'` fuzzy search |
| `idx_companies_name_fts` | companies | GIN (tsvector) | Full-text search |
| `idx_companies_score` | companies | B-tree DESC | Feed score ranking |
| `idx_cl_geom` | company_locations | GIST | Multi-office radius search |
| `idx_sc_geom` | salesman_clients | GIST | Salesman's client pins on map |
| `idx_gq_status_retry` | geocoding_queue | Partial B-tree | Worker picks up only pending jobs |
| `idx_pc_keywords` | product_categories | GIN (array) | `keywords @> ARRAY['steel']` |
| `idx_posts_company` | posts | Composite B-tree | Company's post history feed |
| `idx_post_tags_tag` | post_tags | B-tree | Tag-based discovery |
| `idx_refresh_tokens_expires` | refresh_tokens | B-tree | Nightly cleanup of expired tokens |
