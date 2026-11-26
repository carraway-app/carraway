-- Quellen der Kontenzuordnung für Zinszahlung und Dividende (Portfolio-Modell, Phase 3), eigene Migration wegen ADD VALUE (siehe 0056). Standardregeln legt die Anwendung an, nicht diese Migration.
ALTER TYPE "public"."buchungsquelle" ADD VALUE 'zinszahlung';--> statement-breakpoint
ALTER TYPE "public"."buchungsquelle" ADD VALUE 'dividende';