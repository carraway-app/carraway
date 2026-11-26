CREATE TYPE "public"."mail_status" AS ENUM('wartend', 'gesendet', 'fehlgeschlagen');--> statement-breakpoint
CREATE TYPE "public"."postfach_anbieter" AS ENUM('microsoft', 'google', 'imap', 'demo');--> statement-breakpoint
CREATE TYPE "public"."postfach_bereich" AS ENUM('mail', 'kalender');--> statement-breakpoint
CREATE TABLE "aktivitaet_sync" (
	"aktivitaet_id" uuid PRIMARY KEY NOT NULL,
	"benutzer_id" uuid NOT NULL,
	"anbieter" "postfach_anbieter" NOT NULL,
	"extern_hash" text NOT NULL,
	"anbieter_id" text,
	"beginn" timestamp with time zone NOT NULL,
	"ende" timestamp with time zone,
	"person_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"richtung" text,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "aktivitaet_sync_richtung" CHECK ("aktivitaet_sync"."richtung" IS NULL OR "aktivitaet_sync"."richtung" IN ('eingehend', 'ausgehend'))
);
--> statement-breakpoint
CREATE TABLE "benutzer_einstellung" (
	"benutzer_id" uuid PRIMARY KEY NOT NULL,
	"sprache" text DEFAULT 'de' NOT NULL,
	"mail_bericht_freigegeben" boolean DEFAULT false NOT NULL,
	"aktualisiert_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kalender_token" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"benutzer_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"widerrufen_am" timestamp with time zone,
	"letzter_zugriff_am" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mail_auftrag" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empfaenger" text NOT NULL,
	"sprache" text DEFAULT 'de' NOT NULL,
	"vorlage" text NOT NULL,
	"betreff" text NOT NULL,
	"bezug_art" text,
	"bezug_id" text,
	"inhalt_verschluesselt" text,
	"status" "mail_status" DEFAULT 'wartend' NOT NULL,
	"versuche" integer DEFAULT 0 NOT NULL,
	"naechster_versuch_am" timestamp with time zone DEFAULT now() NOT NULL,
	"gesperrt_bis" timestamp with time zone,
	"letzter_fehler" text,
	"erstellt_von" text NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"gesendet_am" timestamp with time zone,
	CONSTRAINT "mail_auftrag_sprache" CHECK ("mail_auftrag"."sprache" IN ('de', 'en'))
);
--> statement-breakpoint
CREATE TABLE "oauth_zustand" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"benutzer_id" uuid NOT NULL,
	"state_hash" text NOT NULL,
	"nonce_hash" text NOT NULL,
	"verifier_verschluesselt" text NOT NULL,
	"anbieter" "postfach_anbieter" NOT NULL,
	"bereich" "postfach_bereich" NOT NULL,
	"ablauf" timestamp with time zone NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "postfach_verbindung" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"benutzer_id" uuid NOT NULL,
	"bereich" "postfach_bereich" NOT NULL,
	"anbieter" "postfach_anbieter" NOT NULL,
	"zugang_verschluesselt" text NOT NULL,
	"status" text DEFAULT 'verbunden' NOT NULL,
	"letzter_abgleich_am" timestamp with time zone,
	"letzter_fehler" text,
	"abgleich_stand" text,
	"naechster_abgleich_am" timestamp with time zone DEFAULT now() NOT NULL,
	"gesperrt_bis" timestamp with time zone,
	"inhalt_speichern" boolean DEFAULT false NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "postfach_verbindung_status" CHECK ("postfach_verbindung"."status" IN ('verbunden', 'fehler', 'erneut_anmelden'))
);
--> statement-breakpoint
CREATE TABLE "sync_ausschluss" (
	"benutzer_id" uuid NOT NULL,
	"extern_hash" text NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_ausschluss_benutzer_id_extern_hash_pk" PRIMARY KEY("benutzer_id","extern_hash")
);
--> statement-breakpoint
ALTER TABLE "aktivitaet_sync" ADD CONSTRAINT "aktivitaet_sync_aktivitaet_id_aktivitaet_id_fk" FOREIGN KEY ("aktivitaet_id") REFERENCES "public"."aktivitaet"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aktivitaet_sync" ADD CONSTRAINT "aktivitaet_sync_benutzer_id_benutzer_id_fk" FOREIGN KEY ("benutzer_id") REFERENCES "public"."benutzer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benutzer_einstellung" ADD CONSTRAINT "benutzer_einstellung_benutzer_id_benutzer_id_fk" FOREIGN KEY ("benutzer_id") REFERENCES "public"."benutzer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kalender_token" ADD CONSTRAINT "kalender_token_benutzer_id_benutzer_id_fk" FOREIGN KEY ("benutzer_id") REFERENCES "public"."benutzer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_zustand" ADD CONSTRAINT "oauth_zustand_benutzer_id_benutzer_id_fk" FOREIGN KEY ("benutzer_id") REFERENCES "public"."benutzer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postfach_verbindung" ADD CONSTRAINT "postfach_verbindung_benutzer_id_benutzer_id_fk" FOREIGN KEY ("benutzer_id") REFERENCES "public"."benutzer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_ausschluss" ADD CONSTRAINT "sync_ausschluss_benutzer_id_benutzer_id_fk" FOREIGN KEY ("benutzer_id") REFERENCES "public"."benutzer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "aktivitaet_sync_extern_uq" ON "aktivitaet_sync" USING btree ("extern_hash");--> statement-breakpoint
CREATE INDEX "aktivitaet_sync_benutzer_idx" ON "aktivitaet_sync" USING btree ("benutzer_id");--> statement-breakpoint
CREATE INDEX "aktivitaet_sync_beginn_idx" ON "aktivitaet_sync" USING btree ("beginn");--> statement-breakpoint
CREATE UNIQUE INDEX "kalender_token_hash_uq" ON "kalender_token" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "kalender_token_aktiv_uq" ON "kalender_token" USING btree ("benutzer_id") WHERE "kalender_token"."widerrufen_am" IS NULL;--> statement-breakpoint
CREATE INDEX "mail_auftrag_faellig_idx" ON "mail_auftrag" USING btree ("status","naechster_versuch_am");--> statement-breakpoint
CREATE INDEX "mail_auftrag_gesendet_idx" ON "mail_auftrag" USING btree ("gesendet_am");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_zustand_state_uq" ON "oauth_zustand" USING btree ("state_hash");--> statement-breakpoint
CREATE INDEX "oauth_zustand_ablauf_idx" ON "oauth_zustand" USING btree ("ablauf");--> statement-breakpoint
CREATE UNIQUE INDEX "postfach_verbindung_benutzer_bereich_uq" ON "postfach_verbindung" USING btree ("benutzer_id","bereich");--> statement-breakpoint
CREATE INDEX "postfach_verbindung_faellig_idx" ON "postfach_verbindung" USING btree ("naechster_abgleich_am");