-- Base schema — run once before migrations
-- Creates the two tables that migrations reference via FK

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS clients (
    id        SERIAL PRIMARY KEY,
    name      VARCHAR(255) NOT NULL,
    address   TEXT,
    latitude  FLOAT,
    longitude FLOAT,
    geom      GEOGRAPHY(POINT, 4326),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(name, address)
);

CREATE INDEX IF NOT EXISTS idx_clients_geom ON clients USING GIST(geom);

CREATE TABLE IF NOT EXISTS geocode_cache (
    id           SERIAL PRIMARY KEY,
    address_key  VARCHAR(500) UNIQUE NOT NULL,
    latitude     FLOAT NOT NULL,
    longitude    FLOAT NOT NULL,
    display_name TEXT,
    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_geocode_cache_key ON geocode_cache(address_key);
