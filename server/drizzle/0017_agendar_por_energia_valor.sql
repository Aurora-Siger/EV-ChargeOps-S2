CREATE TYPE "public"."reservation_goal" AS ENUM('SOC', 'KWH', 'BRL');--> statement-breakpoint
ALTER TABLE "condo_settings" ADD COLUMN "idle_max_cents_per_session" integer;--> statement-breakpoint
ALTER TABLE "reservation" ADD COLUMN "goal" "reservation_goal" DEFAULT 'SOC' NOT NULL;--> statement-breakpoint
ALTER TABLE "reservation" ADD COLUMN "budget_cents" integer;