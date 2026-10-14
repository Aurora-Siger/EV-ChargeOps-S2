CREATE TYPE "public"."charge_method" AS ENUM('PIX', 'BOLETO');--> statement-breakpoint
CREATE TYPE "public"."charge_status" AS ENUM('PENDING', 'RECEIVED', 'CANCELLED', 'REFUNDED');--> statement-breakpoint
CREATE TABLE "payment_charge" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"method" charge_method NOT NULL,
	"status" charge_status DEFAULT 'PENDING' NOT NULL,
	"amount_cents" integer NOT NULL,
	"due_date" date NOT NULL,
	"pix_payload" text,
	"pix_expires_at" timestamp,
	"boleto_digitable_line" text,
	"boleto_barcode" text,
	"boleto_nosso_numero" text,
	"paid_at" timestamp,
	"cancelled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_charge_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
ALTER TABLE "payment_charge" ADD CONSTRAINT "payment_charge_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_charge" ADD CONSTRAINT "payment_charge_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_charge_invoice_idx" ON "payment_charge" USING btree ("invoice_id");