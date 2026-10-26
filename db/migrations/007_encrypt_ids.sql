-- ID and passport numbers are stored encrypted (AES-256-GCM), with a keyed hash for exact-match lookups.
-- The old plaintext columns are emptied by the backfill step in scripts/migrate.ts and then never written again.
ALTER TABLE candidates ADD COLUMN id_number_enc text, ADD COLUMN id_number_idx text;
DROP INDEX candidates_id_number_key;
CREATE UNIQUE INDEX candidates_id_idx_key ON candidates (tenant_id, id_number_idx) WHERE id_number_idx IS NOT NULL;
ALTER TABLE documents ADD COLUMN doc_number_enc text;
