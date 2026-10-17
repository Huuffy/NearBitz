-- Migration 008: Notifications, visit logs, company signals
-- Run after all previous migrations

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_type') THEN
    CREATE TYPE notification_type AS ENUM (
      'meeting_requested', 'meeting_accepted', 'meeting_declined', 'meeting_completed',
      'new_follower', 'new_post', 'post_liked', 'post_commented'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS notifications (
    id         UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID              NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type       notification_type NOT NULL,
    title      VARCHAR(255)      NOT NULL,
    body       TEXT,
    data       JSONB,
    is_read    BOOLEAN           NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ       NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at DESC);

CREATE TABLE IF NOT EXISTS visit_logs (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    company_id UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    visit_type VARCHAR(50) NOT NULL,  -- 'profile_view' | 'map_pin_tap' | 'meeting_completed'
    metadata   JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_visit_logs_company ON visit_logs(company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS company_signals (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id  UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    signal_type VARCHAR(50) NOT NULL,  -- 'recent_purchase' | 'tender' | 'expansion' | 'hiring'
    signal_data JSONB,
    signal_date DATE,
    source      VARCHAR(100),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signals_company ON company_signals(company_id, signal_date DESC);
