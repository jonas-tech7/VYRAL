CREATE TYPE "public"."buyback_kind" AS ENUM('buyback', 'treasury');--> statement-breakpoint
CREATE TABLE "buyback_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "buyback_kind" NOT NULL,
	"lamports" bigint NOT NULL,
	"mint" text,
	"tokens_burned" text,
	"decimals" integer,
	"swap_signature" text,
	"burn_signature" text,
	"transfer_signature" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "buyback_events_swapSignature_unique" UNIQUE("swap_signature"),
	CONSTRAINT "buyback_events_transferSignature_unique" UNIQUE("transfer_signature")
);
--> statement-breakpoint
CREATE INDEX "buyback_events_created_idx" ON "buyback_events" USING btree ("kind","created_at");