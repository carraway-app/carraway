-- Der Herausgeber der mitgelieferten Meldevorlagen trägt den Produktnamen Carraway. Die Definitionen sind durch einen Trigger unveränderlich;
-- für diese eine Korrektur der Herausgeber-Spalte wird er kurz abgeschaltet (die Migration läuft als Eigentümer der Tabelle).
ALTER TABLE "melde_definition" DISABLE TRIGGER "melde_definition_schutz";--> statement-breakpoint
UPDATE "melde_definition" SET "herausgeber" = 'Carraway (Vorlage)' WHERE "herausgeber" = 'Fundament (Vorlage)';--> statement-breakpoint
ALTER TABLE "melde_definition" ENABLE TRIGGER "melde_definition_schutz";
