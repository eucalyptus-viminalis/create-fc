-- The Network Decentralization Authority's register (a new database: pnpm db:init / db:init:remote).
-- A register made before migrations/001 needs that file run once instead, and one made before
-- migrations/002 needs 002.

-- One row per filing. id is the member number: sequential, never reused.
-- contact is private (an FID or an e-mail address) and is never shown on member pages. It isn't
-- unique: filing again, by anyone, adds a member and never changes an existing one.
CREATE TABLE IF NOT EXISTS members (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  contact    TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('fid', 'email')),
  name       TEXT NOT NULL,
  signature  TEXT NOT NULL,
  bulletins  INTEGER NOT NULL DEFAULT 0,   -- whether this filing asked for bulletins
  node       TEXT,                         -- Part IV, the $5 server reimbursement: the node's address (an IP or host name)
  payout     TEXT,                         --   and the EVM address to pay. Both empty when there's no claim.
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS members_contact ON members (contact);

-- E-mail bulletins, one row per address. Asking on the form only sends a confirmation e-mail;
-- bulletins go only to 'confirmed' addresses. token is the secret in the confirm and unsubscribe links.
CREATE TABLE IF NOT EXISTS subscribers (
  email        TEXT PRIMARY KEY,
  status       TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'unsubscribed')),
  token        TEXT NOT NULL UNIQUE,
  sent_at      TEXT,          -- the last confirmation e-mail: at most one a day per address
  confirmed_at TEXT,
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
