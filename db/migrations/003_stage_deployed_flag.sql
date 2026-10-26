-- Marks the stage at which a worker counts as deployed (employer invoicing can start).
ALTER TABLE pipeline_stages ADD COLUMN marks_deployed boolean NOT NULL DEFAULT false;
