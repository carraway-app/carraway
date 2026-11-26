CREATE INDEX "beleg_bezug_id_idx" ON "beleg" USING btree ("bezug_id");--> statement-breakpoint
CREATE INDEX "forderung_vorgang_idx" ON "forderung" USING btree ("vorgang_id");--> statement-breakpoint
CREATE INDEX "kaufpreisanpassung_vorgang_idx" ON "kaufpreisanpassung" USING btree ("vorgang_id");--> statement-breakpoint
CREATE INDEX "verkauf_rueckfluss_idx" ON "verkauf" USING btree ("rueckfluss_vorgang_id");--> statement-breakpoint
CREATE INDEX "zinslauf_position_vorgang_idx" ON "zinslauf_position" USING btree ("vorgang_id");