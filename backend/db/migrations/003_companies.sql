-- Migration 003: Companies, company industries, company products

CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $$ BEGIN
    CREATE TYPE geocode_status AS ENUM ('pending','processing','geocoded','failed','skipped');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE company_source AS ENUM ('udyam_msme','self_registered','erp_import','manual');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(250) UNIQUE,
    name VARCHAR(300) NOT NULL,
    legal_name VARCHAR(300),
    gstin VARCHAR(15),
    udyam_number VARCHAR(20),
    address TEXT,
    city VARCHAR(100),
    district VARCHAR(100),
    state VARCHAR(100),
    pincode VARCHAR(6),
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    geom GEOGRAPHY(POINT, 4326),
    geocode_status geocode_status NOT NULL DEFAULT 'pending',
    geocoded_at TIMESTAMPTZ,
    geocode_confidence FLOAT,
    geocode_source VARCHAR(50),
    primary_industry_id SMALLINT REFERENCES industries(id),
    employee_band VARCHAR(20),
    investment_band VARCHAR(50),
    source company_source NOT NULL DEFAULT 'udyam_msme',
    source_data JSONB,
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    feed_active BOOLEAN NOT NULL DEFAULT FALSE,
    feed_visibility_score FLOAT NOT NULL DEFAULT 1.0,
    last_post_at TIMESTAMPTZ,
    follower_count INT NOT NULL DEFAULT 0,
    post_count INT NOT NULL DEFAULT 0,
    description TEXT,
    website VARCHAR(500),
    phone VARCHAR(20),
    email VARCHAR(255),
    logo_url VARCHAR(500),
    cover_url VARCHAR(500),
    legacy_client_id INT REFERENCES clients(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_companies_geom ON companies USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_companies_city ON companies(city);
CREATE INDEX IF NOT EXISTS idx_companies_state ON companies(state);
CREATE INDEX IF NOT EXISTS idx_companies_pincode ON companies(pincode);
CREATE INDEX IF NOT EXISTS idx_companies_geocode ON companies(geocode_status);
CREATE INDEX IF NOT EXISTS idx_companies_score ON companies(feed_visibility_score DESC);
CREATE INDEX IF NOT EXISTS idx_companies_active ON companies(is_active, feed_active);
CREATE INDEX IF NOT EXISTS idx_companies_verified ON companies(is_verified) WHERE is_verified = TRUE;
CREATE INDEX IF NOT EXISTS idx_companies_name_fts ON companies USING GIN(to_tsvector('english', coalesce(name,'') || ' ' || coalesce(city,'')));
CREATE INDEX IF NOT EXISTS idx_companies_name_trgm ON companies USING GIN(name gin_trgm_ops);

-- Add FK from users.company_id → companies once companies table exists
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'fk_users_company'
    ) THEN
        ALTER TABLE users
            ADD CONSTRAINT fk_users_company
            FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL;
    END IF;
END $$;

-- Many-to-many: company ↔ industries
CREATE TABLE IF NOT EXISTS company_industries (
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    industry_id SMALLINT NOT NULL REFERENCES industries(id) ON DELETE CASCADE,
    PRIMARY KEY (company_id, industry_id)
);

-- What each company SELLS
CREATE TABLE IF NOT EXISTS company_products_sell (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    category_id INT NOT NULL REFERENCES product_categories(id),
    product_label VARCHAR(200),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, category_id)
);

CREATE INDEX IF NOT EXISTS idx_cps_company ON company_products_sell(company_id);
CREATE INDEX IF NOT EXISTS idx_cps_category ON company_products_sell(category_id);

-- What each company BUYS
CREATE TABLE IF NOT EXISTS company_products_buy (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    category_id INT NOT NULL REFERENCES product_categories(id),
    product_label VARCHAR(200),
    estimated_monthly_qty VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, category_id)
);

CREATE INDEX IF NOT EXISTS idx_cpb_company ON company_products_buy(company_id);
CREATE INDEX IF NOT EXISTS idx_cpb_category ON company_products_buy(category_id);
