CREATE TABLE "external_funding_round" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"announced_on" date NOT NULL,
	"round_type" text NOT NULL,
	"amount" numeric(22, 2),
	"currency" text,
	"investors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_url" text NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_suggestion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"reference" text NOT NULL,
	"field" text NOT NULL,
	"value" text NOT NULL,
	"previous_value" text,
	"source_url" text NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	"current" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" text
);
--> statement-breakpoint
CREATE TABLE "provider_usage" (
	"provider" text NOT NULL,
	"month" date NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "provider_usage_provider_month_pk" PRIMARY KEY("provider","month")
);
--> statement-breakpoint
ALTER TABLE "provider_connection" ADD COLUMN "monthly_limit" integer;--> statement-breakpoint
ALTER TABLE "provider_connection" ADD COLUMN "recent_requests" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_connection" ADD COLUMN "retry_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "provider_connection" ADD COLUMN "checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "provider_connection" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "external_funding_round" ADD CONSTRAINT "external_funding_round_organization_id_organisation_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_suggestion" ADD CONSTRAINT "provider_suggestion_organization_id_organisation_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "external_round_identity" ON "external_funding_round" USING btree ("organization_id","provider","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_suggestion_current" ON "provider_suggestion" USING btree ("organization_id","provider","field") WHERE "provider_suggestion"."current";