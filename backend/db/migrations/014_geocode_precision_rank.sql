-- Real ranking + honest geocoding state.
--
-- geocode_precision: what the stored coordinate actually represents.
--   'house' / 'street'  → address-level, shown on the map
--   'locality'          → neighbourhood-level match, not shown (kept for later review)
--   'approximate'       → city/state centroid + jitter from scripts/geocode-pincode-fast.js, never shown
--   NULL                → not geocoded yet
-- paid_up_capital: MCA paid-up capital (INR) copied out of source_data for ranking pins.

ALTER TABLE companies ADD COLUMN IF NOT EXISTS geocode_precision VARCHAR(20);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS paid_up_capital NUMERIC(20,2);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS pin_tier SMALLINT;

UPDATE companies
SET paid_up_capital = NULLIF(regexp_replace(source_data->>'paid_up_capital', '[^0-9.]', '', 'g'), '')::numeric
WHERE paid_up_capital IS NULL AND source_data ? 'paid_up_capital';

UPDATE companies SET geocode_precision = 'approximate'
WHERE geocode_source = 'city_lookup' AND geocode_precision IS NULL;

-- Tier 1 = top 300 by capital (visible from country zoom), 2 = next 2,700, 3 = next 7,000, 4 = rest.
WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY paid_up_capital DESC NULLS LAST, name) AS rn FROM companies
)
UPDATE companies c
SET pin_tier = CASE WHEN r.rn <= 300 THEN 1 WHEN r.rn <= 3000 THEN 2 WHEN r.rn <= 10000 THEN 3 ELSE 4 END
FROM ranked r WHERE r.id = c.id;

CREATE INDEX IF NOT EXISTS idx_companies_precision ON companies (geocode_precision);
