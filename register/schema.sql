-- The Network Decentralization Authority's register.
-- id is the member number: sequential, assigned on first application.
-- contact is private (an FID or an e-mail address) and is never shown on member pages.
CREATE TABLE IF NOT EXISTS members (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  contact    TEXT NOT NULL UNIQUE,
  kind       TEXT NOT NULL CHECK (kind IN ('fid', 'email')),
  name       TEXT NOT NULL,
  signature  TEXT NOT NULL,
  bulletins  INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
