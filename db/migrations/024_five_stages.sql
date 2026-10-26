-- A candidate's journey is now five stages instead of nine:
--   New -> With employer -> Selected -> Getting ready -> Abroad
-- Agencies that still have the original nine are moved over (every candidate keeps their place);
-- agencies that changed their stages themselves are left exactly as they are.
DO $$
DECLARE
  t uuid; i int; old_id uuid; new_id uuid;
  names text[] := ARRAY['Register','Screen','Shortlist','Interview and select','Contract','Documents and medical','Visa and travel','Deployed','Follow-up'];
  merge_to int[] := ARRAY[1,1,2,2,3,4,4,5,5];   -- where each old stage ends up
  keep int[] := ARRAY[1,3,5,6,8];               -- the old stage whose row becomes each new stage
BEGIN
  FOR t IN
    SELECT tenant_id FROM pipeline_stages GROUP BY tenant_id
    HAVING count(*) = 9 AND bool_and(position BETWEEN 1 AND 9 AND name = names[position])
  LOOP
    FOR i IN 1..9 LOOP
      SELECT id INTO old_id FROM pipeline_stages WHERE tenant_id = t AND position = i;
      SELECT id INTO new_id FROM pipeline_stages WHERE tenant_id = t AND position = keep[merge_to[i]];
      IF old_id <> new_id THEN
        UPDATE placements SET stage_id = new_id WHERE stage_id = old_id;
        UPDATE stage_history SET from_stage_id = new_id WHERE from_stage_id = old_id;
        UPDATE stage_history SET to_stage_id = new_id WHERE to_stage_id = old_id;
        DELETE FROM pipeline_stages WHERE id = old_id;
      END IF;
    END LOOP;
    DELETE FROM stage_history WHERE tenant_id = t AND from_stage_id = to_stage_id;  -- "moved from New to New" is just noise
    UPDATE pipeline_stages SET position = 2 WHERE tenant_id = t AND position = 3;
    UPDATE pipeline_stages SET position = 3 WHERE tenant_id = t AND position = 5;
    UPDATE pipeline_stages SET position = 4 WHERE tenant_id = t AND position = 6;
    UPDATE pipeline_stages SET position = 5 WHERE tenant_id = t AND position = 8;

    UPDATE pipeline_stages SET required_doc_types = '{}', requires_payment = false, requires_job_order = false, requires_vetted_employer = false,
      marks_deployed = false, requires_contract = false, requires_visa = false, requires_orientation = false, requires_arrival = false
      WHERE tenant_id = t;
    UPDATE pipeline_stages SET name = 'New', description = 'Registered, and agreed to share their details' WHERE tenant_id = t AND position = 1;
    UPDATE pipeline_stages SET name = 'With employer', description = 'Matched to a job, shown to the employer and interviewed', requires_job_order = true
      WHERE tenant_id = t AND position = 2;
    UPDATE pipeline_stages SET name = 'Selected', description = 'The employer chose them and the contract is signed',
      requires_job_order = true, requires_vetted_employer = true, requires_contract = true WHERE tenant_id = t AND position = 3;
    UPDATE pipeline_stages SET name = 'Getting ready', description = 'Documents, medical, fees, visa and orientation',
      required_doc_types = ARRAY['Passport','Police clearance','Medical report'], requires_payment = true,
      requires_job_order = true, requires_vetted_employer = true, requires_visa = true, requires_orientation = true WHERE tenant_id = t AND position = 4;
    UPDATE pipeline_stages SET name = 'Abroad', description = 'Travelled and started work. Check-in reminders are set for you',
      requires_job_order = true, requires_vetted_employer = true, marks_deployed = true WHERE tenant_id = t AND position = 5;
  END LOOP;
END $$;

-- An employer can see a candidate once they are put forward to them (the second stage).
DROP POLICY portal_scope ON candidates;
CREATE POLICY portal_scope ON candidates AS RESTRICTIVE FOR ALL
  USING ((app_candidate() IS NULL AND app_employer() IS NULL) OR id = app_candidate() OR (app_employer() IS NOT NULL AND id IN (SELECT p.candidate_id FROM placements p JOIN pipeline_stages s ON s.id = p.stage_id WHERE s.position >= 2)))
  WITH CHECK ((app_candidate() IS NULL AND app_employer() IS NULL) OR id = app_candidate() OR (app_employer() IS NOT NULL AND id IN (SELECT p.candidate_id FROM placements p JOIN pipeline_stages s ON s.id = p.stage_id WHERE s.position >= 2)));
