-- Migration v3: Top-up ledger — make "how much did I top up" queryable.
-- Previously only spend (audit_log) was recorded; top-ups only lived in the DO
-- balance + processed_events (event id only, no amount). This table records the
-- credited amount and dollar value for every top-up.
CREATE TABLE IF NOT EXISTS topups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL,
  external_event_id TEXT NOT NULL,
  source TEXT NOT NULL,             -- 'creem'
  credits INTEGER NOT NULL,         -- credits added
  amount_usd REAL,                  -- dollars paid (nullable if unknown)
  currency TEXT,
  timestamp INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source, external_event_id)
);

CREATE INDEX IF NOT EXISTS idx_topups_account ON topups(account_id, timestamp DESC);
