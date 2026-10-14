CREATE TYPE "public"."role" AS ENUM('USER', 'OPERATOR', 'ADMIN');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "charge_session" (
	"id" text PRIMARY KEY NOT NULL,
	"charger_id" text NOT NULL,
	"user_id" text,
	"started_at" timestamp NOT NULL,
	"ended_at" timestamp,
	"energy_kwh" numeric(10, 3),
	"price_cents" integer,
	"decision_id" text,
	CONSTRAINT "charge_session_decision_id_unique" UNIQUE("decision_id")
);
--> statement-breakpoint
CREATE TABLE "charger" (
	"id" text PRIMARY KEY NOT NULL,
	"station_id" text NOT NULL,
	"external_id" text,
	"max_power_kw" numeric(8, 2) NOT NULL,
	"connector" text,
	CONSTRAINT "charger_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
CREATE TABLE "pricing_decision" (
	"id" text PRIMARY KEY NOT NULL,
	"charger_id" text NOT NULL,
	"tariff_id" text,
	"price_cents_kwh" integer NOT NULL,
	"base_price_cents_kwh" integer NOT NULL,
	"strategy" text NOT NULL,
	"features" jsonb NOT NULL,
	"explanation" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "station" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"latitude" double precision,
	"longitude" double precision,
	"external_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "station_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
CREATE TABLE "tariff" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"base_price_cents_kwh" integer NOT NULL,
	"min_price_cents_kwh" integer NOT NULL,
	"max_price_cents_kwh" integer NOT NULL,
	"max_step_percent" integer DEFAULT 15 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" "role" DEFAULT 'USER' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_session" ADD CONSTRAINT "charge_session_charger_id_charger_id_fk" FOREIGN KEY ("charger_id") REFERENCES "public"."charger"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_session" ADD CONSTRAINT "charge_session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_session" ADD CONSTRAINT "charge_session_decision_id_pricing_decision_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."pricing_decision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charger" ADD CONSTRAINT "charger_station_id_station_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."station"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_decision" ADD CONSTRAINT "pricing_decision_charger_id_charger_id_fk" FOREIGN KEY ("charger_id") REFERENCES "public"."charger"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_decision" ADD CONSTRAINT "pricing_decision_tariff_id_tariff_id_fk" FOREIGN KEY ("tariff_id") REFERENCES "public"."tariff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_charger_idx" ON "charge_session" USING btree ("charger_id","started_at");--> statement-breakpoint
CREATE INDEX "charger_station_idx" ON "charger" USING btree ("station_id");--> statement-breakpoint
CREATE INDEX "decision_charger_idx" ON "pricing_decision" USING btree ("charger_id","created_at");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");