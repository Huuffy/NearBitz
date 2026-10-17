-- Migration 007: Meetings
-- Run after 002_auth.sql and 003_companies.sql

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'meeting_type') THEN
    CREATE TYPE meeting_type AS ENUM ('ad_hoc', 'scheduled', 'follow_up');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'meeting_status') THEN
    CREATE TYPE meeting_status AS ENUM (
      'requested', 'accepted', 'declined',
      'completed', 'cancelled', 'no_show'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS meetings (
    id                      UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    title                   VARCHAR(255)    NOT NULL,
    meeting_type            meeting_type    NOT NULL DEFAULT 'ad_hoc',
    status                  meeting_status  NOT NULL DEFAULT 'requested',
    requested_by_user_id    UUID            REFERENCES users(id) ON DELETE SET NULL,
    host_company_id         UUID            REFERENCES companies(id) ON DELETE SET NULL,
    proposed_at             TIMESTAMPTZ     NOT NULL,
    confirmed_at            TIMESTAMPTZ,
    duration_minutes        INT             NOT NULL DEFAULT 30,
    location_address        TEXT,
    location_lat            FLOAT,
    location_lon            FLOAT,
    notes                   TEXT,
    outcome                 TEXT,
    outcome_tags            VARCHAR(50)[],
    created_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meetings_company ON meetings(host_company_id, status);
CREATE INDEX IF NOT EXISTS idx_meetings_user ON meetings(requested_by_user_id, status);
CREATE INDEX IF NOT EXISTS idx_meetings_proposed ON meetings(proposed_at);

CREATE TABLE IF NOT EXISTS meeting_attendees (
    meeting_id  UUID        NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role        VARCHAR(20) NOT NULL DEFAULT 'attendee',
    status      VARCHAR(20) NOT NULL DEFAULT 'pending',
    PRIMARY KEY (meeting_id, user_id)
);
