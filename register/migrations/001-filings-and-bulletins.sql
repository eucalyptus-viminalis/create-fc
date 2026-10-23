-- 001, for a register made before this change (pnpm db:migrate / db:migrate:remote). Run it once.
-- 1. Filings never overwrite each other: contact stops being unique, so filing again with someone
--    else's FID or e-mail adds a new member instead of changing theirs.
-- 2. E-mail bulletins wait for the address's owner to confirm (the subscribers table).
CREATE TABLE members_new (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  contact    TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('fid', 'email')),
  name       TEXT NOT NULL,
  signature  TEXT NOT NULL,
  bulletins  INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO members_new (id, contact, kind, name, signature, bulletins, created_at, updated_at)
  SELECT id, contact, kind, name, signature, bulletins, created_at, updated_at FROM members;
DROP TABLE members;
ALTER TABLE members_new RENAME TO members;
CREATE INDEX IF NOT EXISTS members_contact ON members (contact);

CREATE TABLE IF NOT EXISTS subscribers (
  email        TEXT PRIMARY KEY,
  status       TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'unsubscribed')),
  token        TEXT NOT NULL UNIQUE,
  sent_at      TEXT,
  confirmed_at TEXT,
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
