-- Migration 004: Salesman private clients (from ERP upload) + geocoding queue

-- Private client pins — owned by a single salesman, never shared
CREATE TABLE IF NOT EXISTS salesman_clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    customer_name VARCHAR(300) NOT NULL,
    address TEXT,
    city VARCHAR(100),
    state VARCHAR(100),
    pincode VARCHAR(6),
    phone VARCHAR(30),
    email VARCHAR(255),
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    geom GEOGRAPHY(POINT, 4326),
    geocode_status geocode_status NOT NULL DEFAULT 'pending',
    last_order_date DATE,
    last_order_amount DECIMAL(14,2),
    last_product_raw VARCHAR(300),
    last_category_id INT REFERENCES product_categories(id),
    total_orders INT NOT NULL DEFAULT 0,
    total_amount DECIMAL(16,2) NOT NULL DEFAULT 0,
    source_file VARCHAR(500),
    raw_data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (owner_user_id, customer_name, address)
);

CREATE INDEX IF NOT EXISTS idx_sc_owner ON salesman_clients(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_sc_geom ON salesman_clients USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_sc_geocode ON salesman_clients(geocode_status);
CREATE INDEX IF NOT EXISTS idx_sc_last_order ON salesman_clients(last_order_date DESC);

-- Individual ERP order lines per client
CREATE TABLE IF NOT EXISTS salesman_client_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES salesman_clients(id) ON DELETE CASCADE,
    quotation_no VARCHAR(100),
    order_date DATE,
    status VARCHAR(50),
    item_name_raw VARCHAR(500) NOT NULL,
    category_id INT REFERENCES product_categories(id),
    canonical_name VARCHAR(200),
    quantity DECIMAL(14,3),
    amount DECIMAL(14,2),
    source_file VARCHAR(500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sco_client ON salesman_client_orders(client_id);
CREATE INDEX IF NOT EXISTS idx_sco_date ON salesman_client_orders(order_date DESC);
CREATE INDEX IF NOT EXISTS idx_sco_category ON salesman_client_orders(category_id);

-- ERP upload batch tracking
CREATE TABLE IF NOT EXISTS erp_uploads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_name VARCHAR(255),
    file_size_bytes INT,
    status VARCHAR(20) NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','geocoding','done','failed')),
    rows_total INT DEFAULT 0,
    rows_imported INT DEFAULT 0,
    rows_failed INT DEFAULT 0,
    column_mapping JSONB,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_erp_uploads_user ON erp_uploads(user_id);

-- Persistent geocoding job queue — survives restarts, supports resume
CREATE TABLE IF NOT EXISTS geocoding_queue (
    id BIGSERIAL PRIMARY KEY,
    entity_type VARCHAR(20) NOT NULL CHECK (entity_type IN ('company','salesman_client')),
    entity_id UUID NOT NULL,
    address_raw TEXT NOT NULL,
    city VARCHAR(100),
    state VARCHAR(100),
    pincode VARCHAR(6),
    status geocode_status NOT NULL DEFAULT 'pending',
    attempt_count SMALLINT NOT NULL DEFAULT 0,
    next_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    result_lat DOUBLE PRECISION,
    result_lon DOUBLE PRECISION,
    result_confidence FLOAT,
    result_display TEXT,
    error_message TEXT,
    queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    UNIQUE (entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_gq_status_retry ON geocoding_queue(status, next_retry_at)
    WHERE status IN ('pending','processing');
CREATE INDEX IF NOT EXISTS idx_gq_entity ON geocoding_queue(entity_type, entity_id);
