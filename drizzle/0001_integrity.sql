-- Integrity guarantees enforced by the database itself, independent of
-- application code paths.

-- 1. Audit log is append-only.
CREATE OR REPLACE FUNCTION audit_logs_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only (% blocked)', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_update
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_block_mutation();
--> statement-breakpoint

-- 2. At most one in-flight transaction attempt per payout. A new attempt can
--    only be created after the previous one is provably terminal
--    (confirmed, expired blockhash, or landed with an error).
CREATE UNIQUE INDEX payout_attempts_single_inflight
  ON payout_attempts (payout_id)
  WHERE status IN ('built', 'sent');
--> statement-breakpoint

-- 3. A confirmed payout must reference a signature, and a signature can
--    settle only one payout.
ALTER TABLE payouts ADD CONSTRAINT payouts_confirmed_has_signature
  CHECK (status <> 'confirmed' OR signature IS NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX payouts_signature_uq ON payouts (signature) WHERE signature IS NOT NULL;
--> statement-breakpoint

-- 4. Value sanity.
ALTER TABLE payouts ADD CONSTRAINT payouts_amount_positive CHECK (amount_lamports > 0);
--> statement-breakpoint
ALTER TABLE fee_events ADD CONSTRAINT fee_events_amount_positive CHECK (amount_lamports > 0);
--> statement-breakpoint
ALTER TABLE checkpoints ADD CONSTRAINT checkpoints_amounts_nonnegative
  CHECK (fees_in_window_lamports >= 0 AND reward_lamports >= 0 AND retained_lamports >= 0
         AND reward_lamports + retained_lamports <= fees_in_window_lamports);
--> statement-breakpoint
ALTER TABLE checkpoints ADD CONSTRAINT checkpoints_reward_bps_range
  CHECK (reward_bps IS NULL OR (reward_bps >= 0 AND reward_bps <= 10000));
--> statement-breakpoint
ALTER TABLE videos ADD CONSTRAINT videos_metrics_nonnegative
  CHECK (views >= 0 AND likes >= 0 AND comments >= 0 AND shares >= 0);
--> statement-breakpoint
ALTER TABLE competitions ADD CONSTRAINT competitions_interval_positive
  CHECK (payout_interval_hours > 0 AND min_eligible_views >= 0);
--> statement-breakpoint

-- 5. Fee events assigned to a checkpoint must be confirmed.
ALTER TABLE fee_events ADD CONSTRAINT fee_events_assigned_confirmed
  CHECK (checkpoint_id IS NULL OR status = 'confirmed');
