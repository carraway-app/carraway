-- Neue Instrumentarten SAFE und Optionsschein in einer eigenen Migration: PostgreSQL erlaubt einen neuen Enum-Wert erst nach dem Commit (jede Migration läuft in einer eigenen Transaktion). Verwendet wird er ab 0084.
ALTER TYPE "public"."instrument_art" ADD VALUE 'safe';--> statement-breakpoint
ALTER TYPE "public"."instrument_art" ADD VALUE 'optionsschein';