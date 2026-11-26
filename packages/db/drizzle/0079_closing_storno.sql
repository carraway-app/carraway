CREATE TABLE "fonds_closing_stand" (
	"closing_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"zusage" numeric(18, 2) NOT NULL,
	"anteil" numeric(10, 6) NOT NULL,
	CONSTRAINT "fonds_closing_stand_closing_id_organisation_id_pk" PRIMARY KEY("closing_id","organisation_id")
);
--> statement-breakpoint
CREATE TABLE "fonds_closing_storno" (
	"closing_id" uuid PRIMARY KEY NOT NULL,
	"grund" text NOT NULL,
	"ersetzt_durch" uuid,
	"storniert_von" text NOT NULL,
	"storniert_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fonds_closing_stand" ADD CONSTRAINT "fonds_closing_stand_closing_id_fonds_closing_id_fk" FOREIGN KEY ("closing_id") REFERENCES "public"."fonds_closing"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fonds_closing_stand" ADD CONSTRAINT "fonds_closing_stand_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fonds_closing_storno" ADD CONSTRAINT "fonds_closing_storno_closing_id_fonds_closing_id_fk" FOREIGN KEY ("closing_id") REFERENCES "public"."fonds_closing"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fonds_closing_storno" ADD CONSTRAINT "fonds_closing_storno_ersetzt_durch_fonds_closing_id_fk" FOREIGN KEY ("ersetzt_durch") REFERENCES "public"."fonds_closing"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Bestand: Stand nach einem Closing = Momentaufnahme des nächsten Closings desselben Fonds, beim letzten der heutige Stand.
INSERT INTO "fonds_closing_stand" ("closing_id", "organisation_id", "zusage", "anteil")
SELECT c."id", b."organisation_id", b."zusage", b."anteil"
FROM (
  SELECT "id", lead("id") OVER (PARTITION BY "fonds_id" ORDER BY "wirksam_am", "erfasst_am", "id") AS "naechstes"
  FROM "fonds_closing"
) c
JOIN "fonds_closing_basis" b ON b."closing_id" = c."naechstes";
--> statement-breakpoint
INSERT INTO "fonds_closing_stand" ("closing_id", "organisation_id", "zusage", "anteil")
SELECT c."id", z."organisation_id", z."zusage", z."anteil"
FROM (
  SELECT "id", "fonds_id", lead("id") OVER (PARTITION BY "fonds_id" ORDER BY "wirksam_am", "erfasst_am", "id") AS "naechstes"
  FROM "fonds_closing"
) c
JOIN "fonds_zeichnung" z ON z."fonds_id" = c."fonds_id"
WHERE c."naechstes" IS NULL;
