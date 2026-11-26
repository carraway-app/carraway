ALTER TABLE "bericht" ADD COLUMN "vorfassung_id" uuid;--> statement-breakpoint
ALTER TABLE "bericht" ADD COLUMN "berichtigungsgrund" text;--> statement-breakpoint
ALTER TABLE "bericht" ADD CONSTRAINT "bericht_vorfassung_id_bericht_id_fk" FOREIGN KEY ("vorfassung_id") REFERENCES "public"."bericht"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bericht" ADD CONSTRAINT "bericht_vorfassung_id_unique" UNIQUE("vorfassung_id");--> statement-breakpoint
ALTER TABLE "bericht" ADD CONSTRAINT "bericht_berichtigung" CHECK (("bericht"."vorfassung_id" IS NULL AND "bericht"."berichtigungsgrund" IS NULL) OR ("bericht"."vorfassung_id" IS NOT NULL AND "bericht"."berichtigungsgrund" IS NOT NULL AND length(trim("bericht"."berichtigungsgrund")) > 0));