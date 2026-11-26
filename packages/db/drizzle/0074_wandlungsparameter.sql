ALTER TABLE "instrument" ADD COLUMN "wandlungsabschlag" numeric(8, 6);--> statement-breakpoint
ALTER TABLE "instrument" ADD COLUMN "bewertungsobergrenze" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "instrument" ADD COLUMN "zinsen_wandeln" boolean;--> statement-breakpoint
ALTER TABLE "instrument" ADD CONSTRAINT "instrument_wandlungsabschlag_bereich" CHECK ("instrument"."wandlungsabschlag" IS NULL OR ("instrument"."wandlungsabschlag" >= 0 AND "instrument"."wandlungsabschlag" < 1));--> statement-breakpoint
ALTER TABLE "instrument" ADD CONSTRAINT "instrument_bewertungsobergrenze_positiv" CHECK ("instrument"."bewertungsobergrenze" IS NULL OR "instrument"."bewertungsobergrenze" > 0);