-- Migration 005: Posts / social feed
-- Run after 003_companies.sql

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'post_type') THEN
    CREATE TYPE post_type AS ENUM (
      'product_launch', 'innovation', 'case_study',
      'news', 'update', 'event', 'offer'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS posts (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id     UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    author_user_id UUID        REFERENCES users(id) ON DELETE SET NULL,
    post_type      post_type   NOT NULL DEFAULT 'update',
    title          VARCHAR(500),
    content        TEXT        NOT NULL,
    is_published   BOOLEAN     NOT NULL DEFAULT true,
    like_count     INT         NOT NULL DEFAULT 0,
    comment_count  INT         NOT NULL DEFAULT 0,
    view_count     INT         NOT NULL DEFAULT 0,
    published_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_posts_company ON posts(company_id, is_published, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_published ON posts(is_published, published_at DESC);

CREATE TABLE IF NOT EXISTS post_tags (
    post_id UUID        NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    tag     VARCHAR(100) NOT NULL,
    PRIMARY KEY (post_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_post_tags_tag ON post_tags(tag);

CREATE TABLE IF NOT EXISTS post_media (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id          UUID        NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    media_type       VARCHAR(20) NOT NULL,  -- 'image' | 'video' | 'pdf' | 'link'
    url              TEXT        NOT NULL,
    thumbnail_url    TEXT,
    file_name        VARCHAR(255),
    file_size_bytes  INT,
    link_title       VARCHAR(255),
    link_description TEXT,
    display_order    INT         NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_post_media_post ON post_media(post_id, display_order);

CREATE TABLE IF NOT EXISTS post_likes (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id    UUID        NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(post_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_post_likes_post ON post_likes(post_id);

CREATE TABLE IF NOT EXISTS post_comments (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id           UUID        NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    parent_comment_id UUID        REFERENCES post_comments(id) ON DELETE SET NULL,
    user_id           UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content           TEXT        NOT NULL,
    like_count        INT         NOT NULL DEFAULT 0,
    is_deleted        BOOLEAN     NOT NULL DEFAULT false,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_post_comments_post ON post_comments(post_id, created_at ASC);
