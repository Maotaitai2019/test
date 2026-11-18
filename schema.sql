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
