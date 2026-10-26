-- Candidates sign in to the portal with their phone, so each phone number must belong to one candidate per agency.
ALTER TABLE candidates ADD COLUMN phone_norm text, ADD COLUMN source text NOT NULL DEFAULT 'staff' CHECK (source IN ('staff', 'portal', 'import'));
CREATE UNIQUE INDEX candidates_phone_norm_key ON candidates (tenant_id, phone_norm) WHERE phone_norm IS NOT NULL;
