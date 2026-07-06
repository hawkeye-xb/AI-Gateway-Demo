-- Migration v4: ASR price rows for the two real models the demo actually calls.
--
-- Background: 0001 seeded a single 'paraformer-v2' asr row, but the demo never
-- successfully called it (the old code POSTed base64 to a non-existent sync path;
-- DashScope's paraformer-v2 recorded transcription is async + needs a public URL).
--
-- The ASR tab now has two working modes, each a distinct real model:
--   * Offline  -> qwen3-asr-flash        (synchronous, base64 audio in, text out)
--   * Realtime -> paraformer-realtime-v2 (WebSocket streaming, mic -> live text)
--
-- Both bill per audio_second. raw_cost_per_unit is a hand-set demo price; the
-- 100x markup (matching every other row, see 0002) makes credit movement visible:
--   5 credits/sec = 0.000005 USD/sec * 100 markup / 0.0001 USD-per-credit.
INSERT OR IGNORE INTO price_book
  (provider, model, modality, unit, raw_cost_per_unit, markup_multiplier, min_charge_per_call, effective_from)
VALUES
  ('bailian', 'qwen3-asr-flash',        'asr', 'audio_second', 0.000005, 100.0, 1, 0),
  ('bailian', 'paraformer-realtime-v2', 'asr', 'audio_second', 0.000005, 100.0, 1, 0);
