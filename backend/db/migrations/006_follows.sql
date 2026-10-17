-- Migration 006: Follows
-- Run after 003_companies.sql and 002_auth.sql

CREATE TABLE IF NOT EXISTS follows (
    id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    follower_user_id      UUID        REFERENCES users(id) ON DELETE CASCADE,
    follower_company_id   UUID        REFERENCES companies(id) ON DELETE CASCADE,
    following_company_id  UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Exactly one of follower_user_id / follower_company_id must be set
    CONSTRAINT chk_exactly_one_follower CHECK (
        (follower_user_id IS NOT NULL AND follower_company_id IS NULL) OR
        (follower_user_id IS NULL AND follower_company_id IS NOT NULL)
    ),
    UNIQUE(follower_user_id, following_company_id),
    UNIQUE(follower_company_id, following_company_id)
);

CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_company_id);
CREATE INDEX IF NOT EXISTS idx_follows_user ON follows(follower_user_id);
