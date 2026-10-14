CREATE TYPE "public"."invoice_status" AS ENUM('PENDING', 'PAID');--> statement-breakpoint
CREATE TYPE "public"."reservation_status" AS ENUM('SCHEDULED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."station_kind" AS ENUM('CONDOMINIO', 'PARCEIRO', 'PUBLICO');--> statement-breakpoint
CREATE TABLE "condo_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"fixed_monthly_cost_cents" integer NOT NULL,
	"idle_cents_per_minute" integer NOT NULL,
	"idle_grace_minutes" integer NOT NULL,
	"due_day" integer NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"unit_label" text,
	"period" text NOT NULL,
	"sessions_count" integer NOT NULL,
	"energy_kwh" numeric(10, 3) NOT NULL,
	"energy_cost_cents" integer NOT NULL,
	"charged_cents" integer NOT NULL,
	"surplus_cents" integer NOT NULL,
	"fixed_share_cents" integer NOT NULL,
	"credit_cents" integer NOT NULL,
	"total_cents" integer NOT NULL,
	"status" "invoice_status" DEFAULT 'PENDING' NOT NULL,
	"due_date" date NOT NULL,
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_user_period_uq" UNIQUE("user_id","period")
);
--> statement-breakpoint
CREATE TABLE "reservation" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"charger_id" text NOT NULL,
	"vehicle_id" text,
	"starts_at" timestamp NOT NULL,
	"ends_at" timestamp NOT NULL,
	"start_soc" integer NOT NULL,
	"target_soc" integer NOT NULL,
	"energy_kwh" numeric(8, 3) NOT NULL,
	"estimated_cost_cents" integer NOT NULL,
	"status" "reservation_status" DEFAULT 'SCHEDULED' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resident" (
	"user_id" text PRIMARY KEY NOT NULL,
	"unit_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rfid_card" (
	"id" text PRIMARY KEY NOT NULL,
	"card_number" text NOT NULL,
	"user_id" text NOT NULL,
	"label" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "rfid_card_card_number_unique" UNIQUE("card_number")
);
--> statement-breakpoint
CREATE TABLE "unit" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"station_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unit_label_unique" UNIQUE("label")
);
--> statement-breakpoint
CREATE TABLE "vehicle" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"model" text NOT NULL,
	"capacity_kwh" numeric(6, 2) NOT NULL,
	"range_km" integer,
	"max_charge_kw" numeric(6, 2) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "charge_session" DROP CONSTRAINT "charge_session_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "charge_session" ADD COLUMN "serial" text;--> statement-breakpoint
ALTER TABLE "charge_session" ADD COLUMN "card_number" text;--> statement-breakpoint
ALTER TABLE "charge_session" ADD COLUMN "green_kwh" numeric(10, 3);--> statement-breakpoint
ALTER TABLE "charge_session" ADD COLUMN "grid_kwh" numeric(10, 3);--> statement-breakpoint
ALTER TABLE "charge_session" ADD COLUMN "duration_min" integer;--> statement-breakpoint
ALTER TABLE "charge_session" ADD COLUMN "mileage_km" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "charge_session" ADD COLUMN "end_cause" text;--> statement-breakpoint
ALTER TABLE "charge_session" ADD COLUMN "idle_min" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "charge_session" ADD COLUMN "tariff_base_cents_kwh" integer;--> statement-breakpoint
ALTER TABLE "charge_session" ADD COLUMN "demand" numeric(5, 4);--> statement-breakpoint
ALTER TABLE "charge_session" ADD COLUMN "mult" numeric(5, 4);--> statement-breakpoint
ALTER TABLE "charge_session" ADD COLUMN "energy_cost_cents" integer;--> statement-breakpoint
ALTER TABLE "charge_session" ADD COLUMN "assigned_manually" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "station" ADD COLUMN "kind" "station_kind" DEFAULT 'PARCEIRO' NOT NULL;--> statement-breakpoint
ALTER TABLE "station" ADD COLUMN "opening_hours" text;--> statement-breakpoint
ALTER TABLE "station" ADD COLUMN "public_price_cents_kwh" integer;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation" ADD CONSTRAINT "reservation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation" ADD CONSTRAINT "reservation_charger_id_charger_id_fk" FOREIGN KEY ("charger_id") REFERENCES "public"."charger"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation" ADD CONSTRAINT "reservation_vehicle_id_vehicle_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicle"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resident" ADD CONSTRAINT "resident_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resident" ADD CONSTRAINT "resident_unit_id_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."unit"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfid_card" ADD CONSTRAINT "rfid_card_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit" ADD CONSTRAINT "unit_station_id_station_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."station"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle" ADD CONSTRAINT "vehicle_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reservation_charger_idx" ON "reservation" USING btree ("charger_id","starts_at");--> statement-breakpoint
CREATE INDEX "vehicle_user_idx" ON "vehicle" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "charge_session" ADD CONSTRAINT "charge_session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_user_idx2" ON "charge_session" USING btree ("user_id","started_at");--> statement-breakpoint
ALTER TABLE "charge_session" ADD CONSTRAINT "charge_session_serial_unique" UNIQUE("serial");--> statement-breakpoint
-- Backfill das estações criadas pelo seed.ts antes desta migration (bancos já em uso):
-- o prédio vira CONDOMINIO e os pontos públicos ganham tipo e preço de referência.
UPDATE "station" SET "kind" = 'CONDOMINIO', "opening_hours" = '24h para moradores' WHERE "name" = 'Edifício Aurora';--> statement-breakpoint
UPDATE "station" SET "opening_hours" = 'seg a sáb, 7h–23h', "public_price_cents_kwh" = 74 WHERE "name" IN ('FIAP Paulista', 'FIAP Aclimação');--> statement-breakpoint
UPDATE "station" SET "kind" = 'PUBLICO', "opening_hours" = 'ter a dom, 10h–18h', "public_price_cents_kwh" = 120 WHERE "name" = 'MASP';
