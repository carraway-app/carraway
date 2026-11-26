-- Neue Enum-Werte des Portfolio-Modells in einer eigenen Migration: PostgreSQL erlaubt einen neuen Wert erst nach dem Commit (scripts/migrate.ts führt jede Migration in einer eigenen Transaktion aus). Verwendet wird er ab 0058.
ALTER TYPE "public"."instrument" ADD VALUE 'venture_debt';--> statement-breakpoint
ALTER TYPE "public"."instrument" ADD VALUE 'gesellschafterdarlehen';--> statement-breakpoint
ALTER TYPE "public"."vorgang_art" ADD VALUE 'zinszahlung';--> statement-breakpoint
ALTER TYPE "public"."vorgang_art" ADD VALUE 'dividende';