-- Die Wandlung gehört zu genau einem Quell-Instrument (seit 0058 befüllt); die Spalte wird Pflicht, damit der eindeutige Index (0059) greift.
ALTER TABLE "wandlung" ALTER COLUMN "quell_instrument_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "verkauf" ADD COLUMN "verkaeuferdarlehen_instrument_id" uuid;--> statement-breakpoint
ALTER TABLE "verkauf" ADD CONSTRAINT "verkauf_verkaeuferdarlehen_instrument_id_instrument_id_fk" FOREIGN KEY ("verkaeuferdarlehen_instrument_id") REFERENCES "public"."instrument"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Bestand: Bisher stand beim Verkauf das Hauptinstrument; alle bisherigen Verkäufe betrafen die ganze Beteiligung. Ab jetzt heißt `instrument_id` leer
-- „ganze Beteiligung“ und gesetzt „nur dieses Instrument“.
UPDATE "verkauf" SET "instrument_id" = NULL;--> statement-breakpoint
-- Das Darlehen eines Verkäuferdarlehens: das Darlehen-Instrument der Beteiligung des Schuldners (bisher deren einziges Instrument).
UPDATE "verkauf" v SET "verkaeuferdarlehen_instrument_id" = i."id" FROM "instrument" i WHERE i."beteiligung_id" = v."verkaeuferdarlehen_beteiligung_id" AND i."art" = 'darlehen';
