-- ============================
-- Extensions
-- ============================

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ============================
-- Tables
-- ============================

CREATE TABLE clients (
    id   BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE creator_accounts (
    id              BIGSERIAL PRIMARY KEY,
    platform        TEXT NOT NULL,
    platform_handle TEXT NOT NULL,
    platform_uid    TEXT,
    UNIQUE (platform, platform_handle)
);

CREATE TABLE client_account_assignments (
    id           BIGSERIAL PRIMARY KEY,
    client_id    BIGINT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
    account_id   BIGINT NOT NULL REFERENCES creator_accounts(id) ON DELETE RESTRICT,
    valid_during TSTZRANGE NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (NOT isempty(valid_during))
);

CREATE TABLE platform_posts (
    id               BIGSERIAL PRIMARY KEY,
    account_id       BIGINT NOT NULL REFERENCES creator_accounts(id) ON DELETE RESTRICT,
    platform         TEXT NOT NULL,
    platform_post_id TEXT NOT NULL,
    canonical_url    TEXT NOT NULL,
    caption          TEXT,
    published_at     TIMESTAMPTZ NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (platform, platform_post_id)
);

CREATE TABLE scrape_runs (
    id                  BIGSERIAL PRIMARY KEY,
    provider            TEXT NOT NULL,
    started_at          TIMESTAMPTZ NOT NULL,
    finished_at         TIMESTAMPTZ,
    status              TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'partial')),
    expected_post_count BIGINT,
    actual_post_count   BIGINT,
    error_payload       JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (expected_post_count IS NULL OR expected_post_count >= 0),
    CHECK (actual_post_count IS NULL OR actual_post_count >= 0),
    CHECK (finished_at IS NULL OR finished_at >= started_at)
);

CREATE TABLE scrape_run_accounts (
    id                  BIGSERIAL PRIMARY KEY,
    run_id              BIGINT NOT NULL REFERENCES scrape_runs(id) ON DELETE CASCADE,
    account_id          BIGINT NOT NULL REFERENCES creator_accounts(id) ON DELETE RESTRICT,
    expected_post_count BIGINT,
    actual_post_count   BIGINT,
    error_payload       JSONB,
    UNIQUE (run_id, account_id),
    CHECK (expected_post_count IS NULL OR expected_post_count >= 0),
    CHECK (actual_post_count IS NULL OR actual_post_count >= 0)
);

CREATE TABLE post_metric_snapshots (
    id          BIGSERIAL PRIMARY KEY,
    post_id     BIGINT NOT NULL REFERENCES platform_posts(id) ON DELETE RESTRICT,
    run_id      BIGINT NOT NULL REFERENCES scrape_runs(id) ON DELETE RESTRICT,
    observed_at TIMESTAMPTZ NOT NULL,
    views       BIGINT CHECK (views IS NULL OR views >= 0),
    likes       BIGINT CHECK (likes IS NULL OR likes >= 0),
    comments    BIGINT CHECK (comments IS NULL OR comments >= 0),
    raw_payload JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (run_id, post_id)
);

CREATE TABLE run_post_observations (
    id         BIGSERIAL PRIMARY KEY,
    run_id     BIGINT NOT NULL REFERENCES scrape_runs(id) ON DELETE RESTRICT,
    post_id    BIGINT NOT NULL REFERENCES platform_posts(id) ON DELETE RESTRICT,
    account_id BIGINT NOT NULL REFERENCES creator_accounts(id) ON DELETE RESTRICT,
    seen       BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (run_id, post_id)
);

CREATE TABLE provider_posts_raw (
    id          BIGSERIAL PRIMARY KEY,
    run_id      BIGINT NOT NULL REFERENCES scrape_runs(id) ON DELETE CASCADE,
    provider    TEXT NOT NULL,
    raw_record  JSONB NOT NULL,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================
-- Constraints
-- ============================

ALTER TABLE client_account_assignments
    ADD CONSTRAINT client_account_assignments_no_overlap
    EXCLUDE USING gist (
        account_id WITH =,
        valid_during WITH &&
    );

-- ============================
-- Indexes
-- ============================

CREATE INDEX idx_platform_posts_account_published
    ON platform_posts (account_id, published_at);

CREATE INDEX idx_platform_posts_platform_post
    ON platform_posts (platform, platform_post_id);

CREATE INDEX idx_post_metric_snapshots_post_observed
    ON post_metric_snapshots (post_id, observed_at DESC);

CREATE INDEX idx_post_metric_snapshots_run
    ON post_metric_snapshots (run_id);

CREATE INDEX idx_run_post_observations_run_account
    ON run_post_observations (run_id, account_id);

CREATE INDEX idx_client_account_assignments_account_valid
    ON client_account_assignments USING gist (account_id, valid_during);

CREATE INDEX idx_scrape_runs_provider_started
    ON scrape_runs (provider, started_at);

CREATE INDEX idx_scrape_run_accounts_run_account
    ON scrape_run_accounts (run_id, account_id);

-- ============================
-- Triggers / Functions
-- ============================

CREATE OR REPLACE FUNCTION enforce_append_only_post_metric_snapshots()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'post_metric_snapshots is append-only; % is not allowed', TG_OP
        USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER trg_append_only_post_metric_snapshots
    BEFORE UPDATE OR DELETE ON post_metric_snapshots
    FOR EACH ROW
    EXECUTE FUNCTION enforce_append_only_post_metric_snapshots();

CREATE OR REPLACE FUNCTION enforce_immutable_platform_posts()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.account_id IS DISTINCT FROM OLD.account_id THEN
        RAISE EXCEPTION 'platform_posts.account_id is immutable'
            USING ERRCODE = '55000';
    END IF;

    IF NEW.platform_post_id IS DISTINCT FROM OLD.platform_post_id THEN
        RAISE EXCEPTION 'platform_posts.platform_post_id is immutable'
            USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_immutable_platform_posts
    BEFORE UPDATE ON platform_posts
    FOR EACH ROW
    EXECUTE FUNCTION enforce_immutable_platform_posts();

-- ============================
-- Query 1: high water mark total views per client with correct historical attribution
-- ============================

WITH post_high_water AS (
    SELECT
        ms.post_id,
        MAX(ms.views) AS max_views
    FROM post_metric_snapshots ms
    GROUP BY ms.post_id
),
post_client_at_publish AS (
    SELECT
        p.id AS post_id,
        ca.client_id
    FROM platform_posts p
    JOIN client_account_assignments ca
      ON ca.account_id = p.account_id
     AND p.published_at <@ ca.valid_during
)
SELECT
    c.id AS client_id,
    c.name AS client_name,
    COALESCE(SUM(phw.max_views), 0) AS total_high_water_views
FROM clients c
LEFT JOIN post_client_at_publish pcap ON pcap.client_id = c.id
LEFT JOIN post_high_water phw ON phw.post_id = pcap.post_id
GROUP BY c.id, c.name
ORDER BY c.id;

-- ============================
-- Query 2: all posts where the latest scrape shows lower metrics than any previous scrape
-- ============================

WITH ranked AS (
    SELECT
        ms.*,
        ROW_NUMBER() OVER (
            PARTITION BY ms.post_id
            ORDER BY ms.observed_at DESC, ms.id DESC
        ) AS rn
    FROM post_metric_snapshots ms
),
latest AS (
    SELECT
        post_id,
        views,
        likes,
        comments
    FROM ranked
    WHERE rn = 1
),
historical_max AS (
    SELECT
        post_id,
        MAX(views) AS max_views,
        MAX(likes) AS max_likes,
        MAX(comments) AS max_comments
    FROM post_metric_snapshots
    GROUP BY post_id
)
SELECT
    p.id AS post_id,
    p.platform,
    p.platform_post_id,
    p.canonical_url,
    l.views AS latest_views,
    hm.max_views AS historical_max_views,
    l.likes AS latest_likes,
    hm.max_likes AS historical_max_likes,
    l.comments AS latest_comments,
    hm.max_comments AS historical_max_comments
FROM latest l
JOIN historical_max hm ON hm.post_id = l.post_id
JOIN platform_posts p ON p.id = l.post_id
WHERE (l.views IS NOT NULL AND hm.max_views IS NOT NULL AND l.views < hm.max_views)
   OR (l.likes IS NOT NULL AND hm.max_likes IS NOT NULL AND l.likes < hm.max_likes)
   OR (l.comments IS NOT NULL AND hm.max_comments IS NOT NULL AND l.comments < hm.max_comments)
ORDER BY p.id;

-- ============================
-- Query 3: all posts present in the previous scrape run but missing from today's
-- ============================

WITH prev_seen AS (
    SELECT rpo.post_id
    FROM run_post_observations rpo
    WHERE rpo.run_id = :previous_run_id
      AND rpo.seen = true
),
today_seen AS (
    SELECT rpo.post_id
    FROM run_post_observations rpo
    WHERE rpo.run_id = :today_run_id
      AND rpo.seen = true
)
SELECT
    p.id AS post_id,
    p.platform,
    p.platform_post_id,
    p.canonical_url,
    p.published_at
FROM platform_posts p
JOIN prev_seen ps ON ps.post_id = p.id
LEFT JOIN today_seen ts ON ts.post_id = p.id
WHERE ts.post_id IS NULL
ORDER BY p.id;

-- ============================
-- Query 4: scrape run health summary showing expected vs actual post counts per account
-- ============================

WITH actual_per_account AS (
    SELECT
        rpo.account_id,
        COUNT(*) FILTER (WHERE rpo.seen) AS observed_posts
    FROM run_post_observations rpo
    WHERE rpo.run_id = :run_id
    GROUP BY rpo.account_id
)
SELECT
    sra.run_id,
    sra.account_id,
    ca.platform,
    ca.platform_handle,
    sra.expected_post_count,
    COALESCE(apa.observed_posts, 0) AS actual_observed_posts,
    sra.actual_post_count AS stored_actual_post_count,
    (COALESCE(apa.observed_posts, 0) = sra.expected_post_count) AS expected_matches_observed
FROM scrape_run_accounts sra
JOIN creator_accounts ca ON ca.id = sra.account_id
LEFT JOIN actual_per_account apa ON apa.account_id = sra.account_id
WHERE sra.run_id = :run_id
ORDER BY ca.platform, ca.platform_handle;