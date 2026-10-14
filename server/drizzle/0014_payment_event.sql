CREATE TABLE "payment_event" (
	"id" text PRIMARY KEY NOT NULL,
	"charge_id" text NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_event_provider_event_uq" UNIQUE("provider","event_id")
);
--> statement-breakpoint
ALTER TABLE "payment_event" ADD CONSTRAINT "payment_event_charge_id_payment_charge_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."payment_charge"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_event_charge_idx" ON "payment_event" USING btree ("charge_id");