BEGIN;
SELECT pg_advisory_xact_lock(2026111901);
-- Retain the original single-choice table for a non-destructive migration.
CREATE TABLE IF NOT EXISTS votes (
  voter_hash TEXT PRIMARY KEY,
  nickname TEXT NOT NULL,
  restaurant_id TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS vote_events (
  id BIGSERIAL PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  voter_hash TEXT NOT NULL,
  nickname TEXT NOT NULL,
  restaurant_id TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS vote_events_actor ON vote_events(voter_hash,created_at);
CREATE TABLE IF NOT EXISTS vote_choices (
  voter_hash TEXT NOT NULL,
  nickname TEXT NOT NULL,
  restaurant_id TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (voter_hash,restaurant_id)
);
CREATE TABLE IF NOT EXISTS poll_migrations (
  name TEXT PRIMARY KEY
);
-- Import once: otherwise a withdrawn legacy vote would reappear on restart.
INSERT INTO vote_choices(voter_hash,nickname,restaurant_id,created_at,updated_at)
SELECT voter_hash,nickname,restaurant_id,created_at,updated_at FROM votes
WHERE NOT EXISTS (SELECT 1 FROM poll_migrations WHERE name='multi-choice-v1')
ON CONFLICT (voter_hash,restaurant_id) DO NOTHING;
INSERT INTO poll_migrations(name) VALUES('multi-choice-v1') ON CONFLICT DO NOTHING;
COMMIT;
