CREATE TYPE "public"."admin_role" AS ENUM('admin', 'reviewer');--> statement-breakpoint
CREATE TYPE "public"."attempt_status" AS ENUM('built', 'sent', 'confirmed', 'expired', 'failed');--> statement-breakpoint
CREATE TYPE "public"."checkpoint_status" AS ENUM('processing', 'awarded', 'no_eligible_winner', 'no_fees', 'below_minimum', 'skipped_paused', 'skipped_price_data', 'voided');--> statement-breakpoint
CREATE TYPE "public"."competition_status" AS ENUM('active', 'paused', 'ended');--> statement-breakpoint
CREATE TYPE "public"."dispute_status" AS ENUM('open', 'resolved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."fee_status" AS ENUM('pending', 'confirmed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."flag_severity" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."flag_status" AS ENUM('open', 'dismissed', 'confirmed');--> statement-breakpoint
CREATE TYPE "public"."fraud_signal" AS ENUM('view_spike', 'abnormal_like_ratio', 'abnormal_comment_ratio', 'low_engagement_high_views', 'purchased_likes_pattern', 'purchased_views_pattern', 'uniform_growth_pattern', 'round_number_increments', 'metrics_regression', 'reused_content', 'duplicate_submission', 'submission_velocity', 'shared_social_account', 'shared_network', 'self_dealing');--> statement-breakpoint
CREATE TYPE "public"."launch_status" AS ENUM('prepared', 'confirmed', 'failed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."payout_status" AS ENUM('pending', 'submitted', 'confirmed', 'requires_attention', 'voided');--> statement-breakpoint
CREATE TYPE "public"."platform" AS ENUM('tiktok', 'youtube', 'instagram', 'x');--> statement-breakpoint
CREATE TYPE "public"."video_status" AS ENUM('verified', 'under_review', 'rejected');--> statement-breakpoint
CREATE TABLE "admins" (
	"wallet" text PRIMARY KEY NOT NULL,
	"role" "admin_role" DEFAULT 'reviewer' NOT NULL,
	"added_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor" text NOT NULL,
	"actor_role" text,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"before" jsonb,
	"after" jsonb,
	"note" text,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_nonces" (
	"nonce" text PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"purpose" text DEFAULT 'sign_in' NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"status" "checkpoint_status" DEFAULT 'processing' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"fees_in_window_lamports" bigint DEFAULT 0 NOT NULL,
	"reward_bps" integer,
	"reward_lamports" bigint DEFAULT 0 NOT NULL,
	"retained_lamports" bigint DEFAULT 0 NOT NULL,
	"reference_market_cap_usd" double precision,
	"twap_price_usd" double precision,
	"reference_supply" double precision,
	"price_sample_count" integer,
	"price_window_start" timestamp with time zone,
	"price_window_end" timestamp with time zone,
	"winner_video_id" uuid,
	"winner_wallet" text,
	"winner_score" double precision,
	"winner_views" bigint,
	"leaderboard_snapshot" jsonb,
	"config_snapshot" jsonb,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "competitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_id" uuid NOT NULL,
	"status" "competition_status" DEFAULT 'active' NOT NULL,
	"payout_interval_hours" smallint NOT NULL,
	"min_eligible_views" integer NOT NULL,
	"reward_curve" jsonb NOT NULL,
	"rules_config_version" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"next_checkpoint_at" timestamp with time zone NOT NULL,
	"paused_at" timestamp with time zone,
	"paused_reason" text,
	"paused_by" text,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competitions_tokenId_unique" UNIQUE("token_id")
);
--> statement-breakpoint
CREATE TABLE "config_entries" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"version" integer NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "config_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"version" integer NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet" text NOT NULL,
	"category" text NOT NULL,
	"video_id" uuid,
	"payout_id" uuid,
	"competition_id" uuid,
	"message" text NOT NULL,
	"status" "dispute_status" DEFAULT 'open' NOT NULL,
	"resolution" text,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fee_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_id" uuid NOT NULL,
	"amount_lamports" bigint NOT NULL,
	"source" text NOT NULL,
	"tx_signature" text,
	"status" "fee_status" DEFAULT 'pending' NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"checkpoint_id" uuid,
	"is_simulated" boolean DEFAULT false NOT NULL,
	CONSTRAINT "fee_events_txSignature_unique" UNIQUE("tx_signature")
);
--> statement-breakpoint
CREATE TABLE "fraud_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"video_id" uuid NOT NULL,
	"creator_wallet" text NOT NULL,
	"signal" "fraud_signal" NOT NULL,
	"severity" "flag_severity" NOT NULL,
	"summary" text NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "flag_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"resolution_note" text
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"job" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"detail" jsonb
);
--> statement-breakpoint
CREATE TABLE "launch_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deployer_wallet" text NOT NULL,
	"payload" jsonb NOT NULL,
	"mint" text NOT NULL,
	"provider" text NOT NULL,
	"intent_message" text,
	"transaction" text,
	"status" "launch_status" DEFAULT 'prepared' NOT NULL,
	"token_id" uuid,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "launch_requests_mint_unique" UNIQUE("mint")
);
--> statement-breakpoint
CREATE TABLE "market_candles" (
	"token_id" uuid NOT NULL,
	"bucket_start" timestamp with time zone NOT NULL,
	"open" double precision NOT NULL,
	"high" double precision NOT NULL,
	"low" double precision NOT NULL,
	"close" double precision NOT NULL,
	"volume_usd" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "market_candles_token_id_bucket_start_pk" PRIMARY KEY("token_id","bucket_start")
);
--> statement-breakpoint
CREATE TABLE "metric_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"video_id" uuid NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"views" bigint NOT NULL,
	"likes" bigint NOT NULL,
	"comments" bigint NOT NULL,
	"shares" bigint DEFAULT 0 NOT NULL,
	"source" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_states" (
	"state" text PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"platform" "platform" NOT NULL,
	"code_verifier" text NOT NULL,
	"return_to" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payout_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payout_id" uuid NOT NULL,
	"attempt_no" integer NOT NULL,
	"signature" text NOT NULL,
	"blockhash" text NOT NULL,
	"last_valid_block_height" bigint NOT NULL,
	"raw_transaction" text NOT NULL,
	"status" "attempt_status" DEFAULT 'built' NOT NULL,
	"error" text,
	"triggered_by" text DEFAULT 'worker' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "payout_attempts_signature_unique" UNIQUE("signature")
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"checkpoint_id" uuid NOT NULL,
	"competition_id" uuid NOT NULL,
	"video_id" uuid NOT NULL,
	"recipient_wallet" text NOT NULL,
	"amount_lamports" bigint NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" "payout_status" DEFAULT 'pending' NOT NULL,
	"signature" text,
	"confirmed_slot" bigint,
	"confirmed_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"auto_attempt_budget" integer DEFAULT 3 NOT NULL,
	"last_error" text,
	"resolution" text,
	"is_simulated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payouts_checkpointId_unique" UNIQUE("checkpoint_id"),
	CONSTRAINT "payouts_idempotencyKey_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "price_samples" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"token_id" uuid NOT NULL,
	"price_usd" double precision NOT NULL,
	"supply" double precision NOT NULL,
	"source" text NOT NULL,
	"sampled_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"wallet" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip_hash" text,
	"user_agent" text,
	CONSTRAINT "sessions_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "social_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet" text NOT NULL,
	"platform" "platform" NOT NULL,
	"platform_account_id" text NOT NULL,
	"handle" text NOT NULL,
	"access_token_enc" text,
	"refresh_token_enc" text,
	"token_expires_at" timestamp with time zone,
	"scopes" text,
	"verification_method" text NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mint" text NOT NULL,
	"name" text NOT NULL,
	"symbol" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"image_url" text,
	"metadata_uri" text,
	"links" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"deployer_wallet" text NOT NULL,
	"launch_provider" text NOT NULL,
	"is_simulated" boolean DEFAULT false NOT NULL,
	"pool_address" text,
	"launch_signature" text,
	"decimals" smallint DEFAULT 6 NOT NULL,
	"total_supply" double precision NOT NULL,
	"launched_at" timestamp with time zone NOT NULL,
	"price_usd" double precision DEFAULT 0 NOT NULL,
	"market_cap_usd" double precision DEFAULT 0 NOT NULL,
	"volume_24h_usd" double precision DEFAULT 0 NOT NULL,
	"price_change_24h_pct" double precision DEFAULT 0 NOT NULL,
	"market_data_source" text,
	"market_data_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tokens_mint_unique" UNIQUE("mint")
);
--> statement-breakpoint
CREATE TABLE "uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet" text NOT NULL,
	"storage_key" text NOT NULL,
	"url" text NOT NULL,
	"content_type" text NOT NULL,
	"bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"wallet" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"is_banned" boolean DEFAULT false NOT NULL,
	"ban_reason" text
);
--> statement-breakpoint
CREATE TABLE "videos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"creator_wallet" text NOT NULL,
	"platform" "platform" NOT NULL,
	"submitted_url" text NOT NULL,
	"canonical_url" text NOT NULL,
	"platform_video_id" text NOT NULL,
	"author_account_id" text,
	"author_handle" text,
	"social_account_id" uuid,
	"title" text,
	"thumbnail_url" text,
	"content_fingerprint" text,
	"published_at" timestamp with time zone NOT NULL,
	"published_at_source" text NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"views" bigint DEFAULT 0 NOT NULL,
	"likes" bigint DEFAULT 0 NOT NULL,
	"comments" bigint DEFAULT 0 NOT NULL,
	"shares" bigint DEFAULT 0 NOT NULL,
	"metrics_updated_at" timestamp with time zone,
	"metrics_source" text,
	"viral_score" double precision DEFAULT 0 NOT NULL,
	"score_breakdown" jsonb,
	"score_config_version" integer,
	"status" "video_status" DEFAULT 'under_review' NOT NULL,
	"status_reason" text,
	"risk_score" smallint DEFAULT 0 NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"submit_ip_hash" text,
	"is_simulated" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worker_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "checkpoints" ADD CONSTRAINT "checkpoints_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkpoints" ADD CONSTRAINT "checkpoints_winner_video_id_videos_id_fk" FOREIGN KEY ("winner_video_id") REFERENCES "public"."videos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitions" ADD CONSTRAINT "competitions_token_id_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."tokens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_wallet_users_wallet_fk" FOREIGN KEY ("wallet") REFERENCES "public"."users"("wallet") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_payout_id_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."payouts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_events" ADD CONSTRAINT "fee_events_token_id_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."tokens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_events" ADD CONSTRAINT "fee_events_checkpoint_id_checkpoints_id_fk" FOREIGN KEY ("checkpoint_id") REFERENCES "public"."checkpoints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fraud_flags" ADD CONSTRAINT "fraud_flags_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_candles" ADD CONSTRAINT "market_candles_token_id_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."tokens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_snapshots" ADD CONSTRAINT "metric_snapshots_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_attempts" ADD CONSTRAINT "payout_attempts_payout_id_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."payouts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_checkpoint_id_checkpoints_id_fk" FOREIGN KEY ("checkpoint_id") REFERENCES "public"."checkpoints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_samples" ADD CONSTRAINT "price_samples_token_id_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."tokens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_wallet_users_wallet_fk" FOREIGN KEY ("wallet") REFERENCES "public"."users"("wallet") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_wallet_users_wallet_fk" FOREIGN KEY ("wallet") REFERENCES "public"."users"("wallet") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tokens" ADD CONSTRAINT "tokens_deployer_wallet_users_wallet_fk" FOREIGN KEY ("deployer_wallet") REFERENCES "public"."users"("wallet") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_creator_wallet_users_wallet_fk" FOREIGN KEY ("creator_wallet") REFERENCES "public"."users"("wallet") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_social_account_id_social_accounts_id_fk" FOREIGN KEY ("social_account_id") REFERENCES "public"."social_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_target_idx" ON "audit_logs" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "auth_nonces_expires_idx" ON "auth_nonces" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "checkpoints_competition_scheduled_uq" ON "checkpoints" USING btree ("competition_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "competitions_next_checkpoint_idx" ON "competitions" USING btree ("status","next_checkpoint_at");--> statement-breakpoint
CREATE UNIQUE INDEX "config_history_key_version_uq" ON "config_history" USING btree ("key","version");--> statement-breakpoint
CREATE INDEX "disputes_status_idx" ON "disputes" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "disputes_wallet_idx" ON "disputes" USING btree ("wallet");--> statement-breakpoint
CREATE INDEX "fee_events_token_idx" ON "fee_events" USING btree ("token_id","status","checkpoint_id");--> statement-breakpoint
CREATE INDEX "fee_events_checkpoint_idx" ON "fee_events" USING btree ("checkpoint_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fraud_flags_open_uq" ON "fraud_flags" USING btree ("video_id","signal") WHERE status = 'open';--> statement-breakpoint
CREATE INDEX "fraud_flags_status_idx" ON "fraud_flags" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "fraud_flags_video_idx" ON "fraud_flags" USING btree ("video_id");--> statement-breakpoint
CREATE INDEX "job_runs_job_idx" ON "job_runs" USING btree ("job","started_at");--> statement-breakpoint
CREATE INDEX "metric_snapshots_video_time_idx" ON "metric_snapshots" USING btree ("video_id","captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payout_attempts_no_uq" ON "payout_attempts" USING btree ("payout_id","attempt_no");--> statement-breakpoint
CREATE INDEX "payouts_status_idx" ON "payouts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payouts_recipient_idx" ON "payouts" USING btree ("recipient_wallet");--> statement-breakpoint
CREATE INDEX "payouts_competition_idx" ON "payouts" USING btree ("competition_id","created_at");--> statement-breakpoint
CREATE INDEX "price_samples_token_time_idx" ON "price_samples" USING btree ("token_id","sampled_at");--> statement-breakpoint
CREATE INDEX "sessions_wallet_idx" ON "sessions" USING btree ("wallet");--> statement-breakpoint
CREATE UNIQUE INDEX "social_accounts_live_uq" ON "social_accounts" USING btree ("platform","platform_account_id") WHERE revoked_at is null;--> statement-breakpoint
CREATE INDEX "social_accounts_wallet_idx" ON "social_accounts" USING btree ("wallet");--> statement-breakpoint
CREATE INDEX "tokens_symbol_idx" ON "tokens" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "tokens_launched_idx" ON "tokens" USING btree ("launched_at");--> statement-breakpoint
CREATE INDEX "tokens_deployer_idx" ON "tokens" USING btree ("deployer_wallet");--> statement-breakpoint
CREATE UNIQUE INDEX "videos_platform_video_uq" ON "videos" USING btree ("platform","platform_video_id");--> statement-breakpoint
CREATE INDEX "videos_competition_score_idx" ON "videos" USING btree ("competition_id","viral_score");--> statement-breakpoint
CREATE INDEX "videos_creator_idx" ON "videos" USING btree ("creator_wallet");--> statement-breakpoint
CREATE INDEX "videos_fingerprint_idx" ON "videos" USING btree ("content_fingerprint");--> statement-breakpoint
CREATE INDEX "videos_status_idx" ON "videos" USING btree ("status");