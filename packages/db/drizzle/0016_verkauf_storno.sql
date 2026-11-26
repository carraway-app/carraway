ALTER TABLE "forderung" ADD COLUMN "storniert_am" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "verkauf" ADD COLUMN "bewertung_id" uuid;--> statement-breakpoint
ALTER TABLE "verkauf" ADD COLUMN "storniert_am" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "verkauf" ADD COLUMN "storniert_von" text;--> statement-breakpoint
ALTER TABLE "verkauf" ADD CONSTRAINT "verkauf_bewertung_id_bewertung_id_fk" FOREIGN KEY ("bewertung_id") REFERENCES "public"."bewertung"("id") ON DELETE no action ON UPDATE no action;