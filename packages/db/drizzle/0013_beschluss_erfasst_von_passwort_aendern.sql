ALTER TABLE "benutzer" ADD COLUMN "passwort_aendern" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "beschluss" ADD COLUMN "erfasst_von" uuid;--> statement-breakpoint
ALTER TABLE "beschluss" ADD CONSTRAINT "beschluss_erfasst_von_benutzer_id_fk" FOREIGN KEY ("erfasst_von") REFERENCES "public"."benutzer"("id") ON DELETE no action ON UPDATE no action;