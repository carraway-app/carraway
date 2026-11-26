CREATE TABLE "fonds_closing" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fonds_id" uuid NOT NULL,
	"wirksam_am" date NOT NULL,
	"bemerkung" text,
	"erfasst_von" text NOT NULL,
	"erfasst_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fonds_closing_basis" (
	"closing_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"zusage" numeric(18, 2) NOT NULL,
	"anteil" numeric(10, 6) NOT NULL,
	CONSTRAINT "fonds_closing_basis_closing_id_organisation_id_pk" PRIMARY KEY("closing_id","organisation_id")
);
--> statement-breakpoint
CREATE TABLE "fonds_closing_zusage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"closing_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"zusage" numeric(18, 2) NOT NULL,
	"ausgleich_betrag" numeric(18, 2),
	"ausgleich_datum" date,
	CONSTRAINT "fonds_closing_zusage_positiv" CHECK ("fonds_closing_zusage"."zusage" > 0),
	CONSTRAINT "fonds_closing_zusage_ausgleich" CHECK (("fonds_closing_zusage"."ausgleich_betrag" IS NULL) = ("fonds_closing_zusage"."ausgleich_datum" IS NULL) AND ("fonds_closing_zusage"."ausgleich_betrag" IS NULL OR "fonds_closing_zusage"."ausgleich_betrag" > 0))
);
--> statement-breakpoint
ALTER TABLE "fonds_closing" ADD CONSTRAINT "fonds_closing_fonds_id_fonds_id_fk" FOREIGN KEY ("fonds_id") REFERENCES "public"."fonds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fonds_closing_basis" ADD CONSTRAINT "fonds_closing_basis_closing_id_fonds_closing_id_fk" FOREIGN KEY ("closing_id") REFERENCES "public"."fonds_closing"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fonds_closing_basis" ADD CONSTRAINT "fonds_closing_basis_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fonds_closing_zusage" ADD CONSTRAINT "fonds_closing_zusage_closing_id_fonds_closing_id_fk" FOREIGN KEY ("closing_id") REFERENCES "public"."fonds_closing"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fonds_closing_zusage" ADD CONSTRAINT "fonds_closing_zusage_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fonds_closing_fonds_idx" ON "fonds_closing" USING btree ("fonds_id","wirksam_am");--> statement-breakpoint
CREATE UNIQUE INDEX "fonds_closing_zusage_closing_organisation_uq" ON "fonds_closing_zusage" USING btree ("closing_id","organisation_id");