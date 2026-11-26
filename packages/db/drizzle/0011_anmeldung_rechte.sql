CREATE TYPE "public"."fonds_rolle" AS ENUM('betrachter', 'bearbeiter', 'freigeber', 'verwalter');--> statement-breakpoint
CREATE TABLE "anmeldeversuch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schluessel" text NOT NULL,
	"am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_schluessel" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"benutzer_id" uuid NOT NULL,
	"scopes" jsonb NOT NULL,
	"ablauf" timestamp with time zone NOT NULL,
	"hash" text NOT NULL,
	"vorschau" text NOT NULL,
	"erstellt_von" text NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"zuletzt_genutzt" timestamp with time zone,
	"widerrufen_am" timestamp with time zone,
	CONSTRAINT "api_schluessel_hash_unique" UNIQUE("hash")
);
--> statement-breakpoint
CREATE TABLE "benutzer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"two_factor_enabled" boolean DEFAULT false NOT NULL,
	"aktiv" boolean DEFAULT true NOT NULL,
	"technisch" boolean DEFAULT false NOT NULL,
	"global_verwalter" boolean DEFAULT false NOT NULL,
	CONSTRAINT "benutzer_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "fondsrolle" (
	"benutzer_id" uuid NOT NULL,
	"fonds_id" uuid NOT NULL,
	"rolle" "fonds_rolle" NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fondsrolle_benutzer_id_fonds_id_pk" PRIMARY KEY("benutzer_id","fonds_id")
);
--> statement-breakpoint
CREATE TABLE "konto" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "periodensperre" (
	"fonds_id" uuid PRIMARY KEY NOT NULL,
	"gesperrt_bis" date NOT NULL,
	"gesetzt_von" text NOT NULL,
	"gesetzt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"grund" text
);
--> statement-breakpoint
CREATE TABLE "sitzung" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	CONSTRAINT "sitzung_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "verifizierung" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "zwei_faktor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" uuid NOT NULL,
	"verified" boolean DEFAULT true,
	"failed_verification_count" integer DEFAULT 0,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "aenderung" ADD COLUMN "akteur_name" text;--> statement-breakpoint
ALTER TABLE "api_schluessel" ADD CONSTRAINT "api_schluessel_benutzer_id_benutzer_id_fk" FOREIGN KEY ("benutzer_id") REFERENCES "public"."benutzer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fondsrolle" ADD CONSTRAINT "fondsrolle_benutzer_id_benutzer_id_fk" FOREIGN KEY ("benutzer_id") REFERENCES "public"."benutzer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fondsrolle" ADD CONSTRAINT "fondsrolle_fonds_id_fonds_id_fk" FOREIGN KEY ("fonds_id") REFERENCES "public"."fonds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "konto" ADD CONSTRAINT "konto_user_id_benutzer_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."benutzer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "periodensperre" ADD CONSTRAINT "periodensperre_fonds_id_fonds_id_fk" FOREIGN KEY ("fonds_id") REFERENCES "public"."fonds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sitzung" ADD CONSTRAINT "sitzung_user_id_benutzer_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."benutzer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zwei_faktor" ADD CONSTRAINT "zwei_faktor_user_id_benutzer_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."benutzer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "anmeldeversuch_schluessel_idx" ON "anmeldeversuch" USING btree ("schluessel","am");--> statement-breakpoint
CREATE INDEX "api_schluessel_benutzer_idx" ON "api_schluessel" USING btree ("benutzer_id");--> statement-breakpoint
CREATE INDEX "fondsrolle_fonds_idx" ON "fondsrolle" USING btree ("fonds_id");--> statement-breakpoint
CREATE INDEX "konto_benutzer_idx" ON "konto" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "konto_anbieter_uq" ON "konto" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "sitzung_benutzer_idx" ON "sitzung" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verifizierung_kennung_idx" ON "verifizierung" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "zwei_faktor_benutzer_idx" ON "zwei_faktor" USING btree ("user_id");