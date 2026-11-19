-- Default revision: the payout minimum drops from 5,000 to 500 verified views.
-- Competitions store the minimum they launched with; competitions still on the
-- previous default move to the new one (each change is audit-logged). The
-- global eligibility config is revised by scripts/config-upgrade.ts.
WITH changed AS (
  UPDATE "competitions"
  SET "min_eligible_views" = 500, "updated_at" = now()
  WHERE "min_eligible_views" = 5000
  RETURNING "id"
)
INSERT INTO "audit_logs" ("actor", "actor_role", "action", "target_type", "target_id", "before", "after", "note")
SELECT 'system:migration', 'admin', 'competition.rules.update', 'competition', "id"::text,
       '{"minEligibleViews":5000}'::jsonb, '{"minEligibleViews":500}'::jsonb,
       'Default revision: payout minimum lowered to 500 verified views'
FROM changed;
