-- Migration 009: Multiple office locations per company
-- Splits the single lat/lon on companies into a one-to-many locations table.
-- The companies table keeps its geom for backward compat (primary/HQ location).

DO $$ BEGIN
    CREATE TYPE location_type AS ENUM (
        'headquarters', 'registered_office', 'branch',
        'manufacturing_plant', 'warehouse', 'sales_office'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE company_locations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    location_type   location_type NOT NULL DEFAULT 'branch',
    label           VARCHAR(150),                          -- e.g. "Mumbai Sales Office"
    address         TEXT,
    city            VARCHAR(100),
    district        VARCHAR(100),
    state           VARCHAR(100),
    pincode         VARCHAR(10),
    country         VARCHAR(100) DEFAULT 'India',
    latitude        DOUBLE PRECISION,
    longitude       DOUBLE PRECISION,
    geom            GEOGRAPHY(POINT, 4326),               -- GIST indexed
    geocode_status  geocode_status DEFAULT 'pending',
    is_primary      BOOLEAN DEFAULT false,                -- if true, synced to companies.geom
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_cl_company   ON company_locations(company_id);
CREATE INDEX idx_cl_geom      ON company_locations USING GIST(geom);
CREATE INDEX idx_cl_geocode   ON company_locations(geocode_status) WHERE geocode_status = 'pending';
CREATE INDEX idx_cl_primary   ON company_locations(company_id) WHERE is_primary = true;

-- Trigger: keep companies.geom in sync when primary location is updated
CREATE OR REPLACE FUNCTION sync_primary_location() RETURNS trigger AS $$
BEGIN
    IF NEW.is_primary = true AND NEW.geom IS NOT NULL THEN
        UPDATE companies
        SET geom      = NEW.geom,
            latitude  = NEW.latitude,
            longitude = NEW.longitude,
            city      = COALESCE(NEW.city, companies.city),
            state     = COALESCE(NEW.state, companies.state),
            pincode   = COALESCE(NEW.pincode, companies.pincode),
            updated_at = NOW()
        WHERE id = NEW.company_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_primary_location
    AFTER INSERT OR UPDATE ON company_locations
    FOR EACH ROW EXECUTE FUNCTION sync_primary_location();

-- Back-fill: create a primary location row for every company that already has coordinates
INSERT INTO company_locations (
    company_id, location_type, address, city, district, state, pincode,
    latitude, longitude, geom, geocode_status, is_primary
)
SELECT
    id,
    'headquarters',
    address,
    city,
    district,
    state,
    pincode,
    latitude,
    longitude,
    geom,
    CASE WHEN geom IS NOT NULL THEN 'geocoded'::geocode_status ELSE 'pending'::geocode_status END,
    true
FROM companies
WHERE latitude IS NOT NULL OR address IS NOT NULL
ON CONFLICT DO NOTHING;

-- Extend geocoding_queue to support company_location entity type
ALTER TABLE geocoding_queue
    DROP CONSTRAINT geocoding_queue_entity_type_check;

ALTER TABLE geocoding_queue
    ADD CONSTRAINT geocoding_queue_entity_type_check
    CHECK (entity_type IN ('company', 'salesman_client', 'company_location'));
