ALTER TYPE "public"."dokument_text_status" ADD VALUE 'ocr_ausstehend';--> statement-breakpoint
ALTER TYPE "public"."dokument_text_status" ADD VALUE 'ocr_laeuft';--> statement-breakpoint
ALTER TABLE "dokument" ADD COLUMN "text_begonnen_am" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dokument" ADD COLUMN "text_versuche" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "dokument_seite" ADD COLUMN "quelle" text DEFAULT 'text' NOT NULL;--> statement-breakpoint
ALTER TABLE "dokument_seite" ADD COLUMN "konfidenz" real;--> statement-breakpoint
ALTER TABLE "wert_quelle" ADD COLUMN "zitat_quelle" text DEFAULT 'text' NOT NULL;--> statement-breakpoint
ALTER TABLE "dokument_seite" ADD CONSTRAINT "dokument_seite_quelle" CHECK ("dokument_seite"."quelle" IN ('text', 'ocr'));--> statement-breakpoint
ALTER TABLE "dokument_seite" ADD CONSTRAINT "dokument_seite_konfidenz" CHECK ("dokument_seite"."konfidenz" IS NULL OR ("dokument_seite"."konfidenz" >= 0 AND "dokument_seite"."konfidenz" <= 100));--> statement-breakpoint
ALTER TABLE "wert_quelle" ADD CONSTRAINT "wert_quelle_zitat_quelle" CHECK ("wert_quelle"."zitat_quelle" IN ('text', 'ocr'));