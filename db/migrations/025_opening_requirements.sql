-- An opening (job order) says what a recruit must meet; a recruit's page checks them against it.
ALTER TABLE job_orders
  ADD COLUMN required_doc_types     text[] NOT NULL DEFAULT '{}',
  ADD COLUMN min_age                int,
  ADD COLUMN max_age                int,
  ADD COLUMN gender                 text NOT NULL DEFAULT '',
  ADD COLUMN min_experience_years   int,
  ADD COLUMN other_requirements     text[] NOT NULL DEFAULT '{}';

ALTER TABLE candidates ADD COLUMN experience_years int CHECK (experience_years IS NULL OR experience_years BETWEEN 0 AND 60);

-- Requirements that cannot be worked out from the record (a skill, a licence) are ticked by hand, per recruit.
ALTER TABLE placements ADD COLUMN requirement_ticks text[] NOT NULL DEFAULT '{}';

-- Checking employers is optional now: nobody is held back for it unless an agency turns the rule on again.
UPDATE tenants SET settings = settings || jsonb_build_object('rules', COALESCE(settings->'rules', '{}'::jsonb) || '{"require_vetting": false}'::jsonb);
