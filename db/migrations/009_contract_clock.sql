-- "Latest copy" must be unambiguous even when two copies are saved in one transaction.
ALTER TABLE contracts ALTER COLUMN created_at SET DEFAULT clock_timestamp();
