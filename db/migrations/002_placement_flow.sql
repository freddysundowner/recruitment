-- A placement now starts at registration, before any job order exists.
-- It gets a job order (and a payment model) when the candidate is shortlisted.
ALTER TABLE placements ALTER COLUMN job_order_id DROP NOT NULL;
ALTER TABLE placements ALTER COLUMN payment_model DROP NOT NULL;

-- One live placement per candidate: active or deployed. Closed ones are history.
DROP INDEX placements_one_active;
CREATE UNIQUE INDEX placements_one_live ON placements (candidate_id) WHERE outcome <> 'closed';

-- Stage gates, stored as data so each agency can configure its own.
ALTER TABLE pipeline_stages
  ADD COLUMN requires_job_order boolean NOT NULL DEFAULT false,
  ADD COLUMN requires_vetted_employer boolean NOT NULL DEFAULT false;
