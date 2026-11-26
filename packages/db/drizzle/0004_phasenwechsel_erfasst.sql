DROP INDEX "deal_phasenwechsel_deal_idx";--> statement-breakpoint
ALTER TABLE "deal_phasenwechsel" ADD COLUMN "erfasst_am" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "deal_phasenwechsel_deal_idx" ON "deal_phasenwechsel" USING btree ("deal_id","am","erfasst_am");