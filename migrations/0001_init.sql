-- Migration v1: Core tables
-- Price book: provider cost + markup
CREATE TABLE IF NOT EXISTS price_book (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  modality TEXT NOT NULL CHECK(modality IN ('llm','vision','asr','tts')),
  unit TEXT NOT NULL CHECK(unit IN ('input_token','output_token','audio_second','image')),
  raw_cost_per_unit REAL NOT NULL,     -- USD per unit
  markup_multiplier REAL NOT NULL DEFAULT 3.0,
  min_charge_per_call INTEGER NOT NULL DEFAULT 1,  -- in credits
  effective_from INTEGER NOT NULL,     -- unix timestamp
  UNIQUE(provider, model, modality, unit, effective_from)
);

-- Audit log: every billing event
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  modality TEXT NOT NULL,
  model TEXT NOT NULL,
  provider TEXT NOT NULL,
  usage_kind TEXT NOT NULL,
  usage_amount REAL NOT NULL,
  real_cost_usd REAL NOT NULL,
  credits_charged INTEGER NOT NULL,
  timestamp INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_account ON audit_log(account_id, timestamp DESC);

-- Processed events: idempotency guard for webhooks
CREATE TABLE IF NOT EXISTS processed_events (
  source TEXT NOT NULL,
  external_event_id TEXT NOT NULL,
  processed_at INTEGER NOT NULL,
  PRIMARY KEY (source, external_event_id)
);

-- Init: insert DeepSeek price entries
INSERT OR IGNORE INTO price_book (provider, model, modality, unit, raw_cost_per_unit, markup_multiplier, min_charge_per_call, effective_from)
VALUES
  ('deepseek', 'deepseek-chat',   'llm',   'input_token',  0.00000027, 3.0, 1, 0),
  ('deepseek', 'deepseek-chat',   'llm',   'output_token', 0.00000110, 3.0, 1, 0),
  ('bailian',  'qwen-vl-max',    'vision', 'input_token',  0.00000050, 3.0, 1, 0),
  ('bailian',  'qwen-vl-max',    'vision', 'output_token', 0.00000200, 3.0, 1, 0),
  ('bailian',  'qwen-vl-max',    'vision', 'image',        0.00150,    3.0, 1, 0),
  ('bailian',  'paraformer-v2',  'asr',    'audio_second', 0.000005,   3.0, 1, 0);
