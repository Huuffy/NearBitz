-- Migration 011: Salesman product sell profile + HSN code on taxonomy
-- Why: salesman needs to declare what they sell so map query can find companies
-- that BUY what the salesman sells. Category matching uses hierarchical traversal.

-- Add HSN code column to product_categories (safe to run twice — idempotent)
ALTER TABLE product_categories
    ADD COLUMN IF NOT EXISTS hsn_code VARCHAR(10),
    ADD COLUMN IF NOT EXISTS is_leaf   BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_pc_hsn ON product_categories(hsn_code) WHERE hsn_code IS NOT NULL;

-- Mark leaf nodes (no children) — used for UI to guide users toward specific categories
UPDATE product_categories SET is_leaf = true
WHERE id NOT IN (SELECT DISTINCT parent_id FROM product_categories WHERE parent_id IS NOT NULL);

-- Salesman's sell product profile (what they personally sell / their company sells)
-- Separate from company_products_sell because a salesman may be independent or
-- cover only a subset of their company's product range.
CREATE TABLE IF NOT EXISTS salesman_products_sell (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id   INTEGER NOT NULL REFERENCES product_categories(id),
    product_label VARCHAR(300),        -- optional free-text label ("Hastelloy C-276 flanges")
    created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, category_id)
);

CREATE INDEX IF NOT EXISTS idx_sps_user     ON salesman_products_sell(user_id);
CREATE INDEX IF NOT EXISTS idx_sps_category ON salesman_products_sell(category_id);

