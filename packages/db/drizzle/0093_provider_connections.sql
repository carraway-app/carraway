CREATE TABLE "provider_connection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"credential" text NOT NULL,
	"mapping" jsonb NOT NULL,
	"mode" text DEFAULT 'import' NOT NULL,
	"next_sync" timestamp with time zone,
	CONSTRAINT "provider_connection_provider_unique" UNIQUE("provider")
);
--> statement-breakpoint
CREATE TABLE "provider_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"resource" text NOT NULL,
	"external_id" text NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"actor" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'reading' NOT NULL,
	"mapping" jsonb NOT NULL,
	"cursor" jsonb,
	"pages" integer DEFAULT 0 NOT NULL,
	"received" integer DEFAULT 0 NOT NULL,
	"matched" integer DEFAULT 0 NOT NULL,
	"applied" integer DEFAULT 0 NOT NULL,
	"error" text,
	"retries" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_source" (
	"connection_id" uuid NOT NULL,
	"resource" text NOT NULL,
	"external_id" text NOT NULL,
	"local_id" uuid NOT NULL,
	"digest" text NOT NULL,
	"mirrored" boolean DEFAULT false NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	CONSTRAINT "provider_source_connection_id_resource_external_id_pk" PRIMARY KEY("connection_id","resource","external_id")
);
--> statement-breakpoint
ALTER TABLE "provider_item" ADD CONSTRAINT "provider_item_run_id_provider_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."provider_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_run" ADD CONSTRAINT "provider_run_connection_id_provider_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."provider_connection"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_source" ADD CONSTRAINT "provider_source_connection_id_provider_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."provider_connection"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_item_identity" ON "provider_item" USING btree ("run_id","resource","external_id");--> statement-breakpoint
CREATE INDEX "provider_item_order" ON "provider_item" USING btree ("run_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_run_active" ON "provider_run" USING btree ("connection_id") WHERE "provider_run"."status" in ('reading','preview','applying');--> statement-breakpoint
CREATE UNIQUE INDEX "provider_source_owner" ON "provider_source" USING btree ("resource","local_id") WHERE "provider_source"."mirrored";
--> statement-breakpoint
CREATE FUNCTION protect_provider_mirror() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('carraway.provider_write', true) IS DISTINCT FROM 'on'
     AND EXISTS (SELECT 1 FROM provider_source WHERE resource = TG_ARGV[0] AND local_id = OLD.id AND mirrored) THEN
    RAISE EXCEPTION 'Record is managed by its provider' USING ERRCODE = 'CM001';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER provider_mirror_org BEFORE UPDATE OR DELETE ON organisation FOR EACH ROW EXECUTE FUNCTION protect_provider_mirror('organization');
--> statement-breakpoint
CREATE TRIGGER provider_mirror_person BEFORE UPDATE OR DELETE ON person FOR EACH ROW EXECUTE FUNCTION protect_provider_mirror('person');
--> statement-breakpoint
CREATE TRIGGER provider_mirror_deal BEFORE UPDATE OR DELETE ON deal FOR EACH ROW EXECUTE FUNCTION protect_provider_mirror('deal');
--> statement-breakpoint
CREATE TRIGGER provider_mirror_note BEFORE UPDATE OR DELETE ON aktivitaet FOR EACH ROW EXECUTE FUNCTION protect_provider_mirror('note');
