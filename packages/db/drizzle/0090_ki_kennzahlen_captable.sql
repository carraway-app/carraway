ALTER TYPE "public"."auslesung_art" ADD VALUE 'kennzahlenbericht';--> statement-breakpoint
ALTER TYPE "public"."auslesung_art" ADD VALUE 'captable';--> statement-breakpoint
ALTER TABLE "wert_quelle" DROP CONSTRAINT "wert_quelle_objekt_typ";--> statement-breakpoint
ALTER TABLE "wert_quelle" ADD CONSTRAINT "wert_quelle_objekt_typ" CHECK ("wert_quelle"."objekt_typ" IN ('finanzierungsrunde', 'rundenposition', 'anteilsklasse', 'darlehen_kondition', 'bewertung', 'beteiligung', 'registereintrag', 'kennzahl_wert'));