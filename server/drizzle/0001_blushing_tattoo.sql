CREATE TYPE "public"."sems_snapshot_kind" AS ENUM('detail', 'last_charge', 'capabilities', 'device_info', 'station_info', 'alarm_count');--> statement-breakpoint
CREATE TABLE "sems_charge_log" (
	"serial" text PRIMARY KEY NOT NULL,
	"payload" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sems_snapshot" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" "sems_snapshot_kind" NOT NULL,
	"collected_at" timestamp DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "sems_snapshot_kind_idx" ON "sems_snapshot" USING btree ("kind","collected_at");