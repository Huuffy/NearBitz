-- Indexes for GET /api/map/search: trigram word-similarity on city and product category names.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_companies_city_trgm
    ON companies USING GIN (city gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_pc_name_trgm
    ON product_categories USING GIN (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_pc_hsn_prefix
    ON product_categories (hsn_code text_pattern_ops)
    WHERE hsn_code IS NOT NULL;
