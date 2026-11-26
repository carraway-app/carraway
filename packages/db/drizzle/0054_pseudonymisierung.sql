CREATE TABLE "pseudonymisierung" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"betraege_skaliert" boolean DEFAULT false NOT NULL,
	"daten_verschoben" boolean DEFAULT false NOT NULL,
	CONSTRAINT "pseudonymisierung_einzig" CHECK ("pseudonymisierung"."id" = 1)
);
