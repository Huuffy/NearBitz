-- Migration 001: Reference tables (industries + product taxonomy)

CREATE TABLE IF NOT EXISTS industries (
    id SMALLSERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL UNIQUE,
    nic_code_range VARCHAR(20),
    icon_class VARCHAR(50),
    sort_order SMALLINT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS product_categories (
    id SERIAL PRIMARY KEY,
    parent_id INT REFERENCES product_categories(id) ON DELETE RESTRICT,
    name VARCHAR(150) NOT NULL,
    slug VARCHAR(150) NOT NULL,
    nic_code VARCHAR(10),
    level SMALLINT NOT NULL CHECK (level BETWEEN 0 AND 2),
    keywords TEXT[] DEFAULT '{}',
    sort_order SMALLINT DEFAULT 0,
    UNIQUE (parent_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_pc_parent ON product_categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_pc_keywords ON product_categories USING GIN(keywords);

