-- Migration v5: drop the unused paraformer-v2 ASR price row.
--
-- 0001 seeded 'paraformer-v2' for ASR, but the demo never bills it: the offline
-- mode uses qwen3-asr-flash (sync) and the realtime mode uses paraformer-realtime-v2
-- (WebSocket). Remove the dead row so price_book matches what the code actually calls.
DELETE FROM price_book WHERE provider = 'bailian' AND model = 'paraformer-v2' AND modality = 'asr';
