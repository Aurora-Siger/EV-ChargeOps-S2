ALTER TYPE "public"."reservation_status" ADD VALUE 'PENDING_PLUGIN' BEFORE 'SCHEDULED';--> statement-breakpoint
ALTER TYPE "public"."reservation_status" ADD VALUE 'EXPIRED';--> statement-breakpoint
ALTER TABLE "reservation" ALTER COLUMN "starts_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reservation" ALTER COLUMN "ends_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reservation" ALTER COLUMN "start_soc" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reservation" ALTER COLUMN "energy_kwh" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reservation" ALTER COLUMN "estimated_cost_cents" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reservation" ADD COLUMN "deadline_at" timestamp;--> statement-breakpoint
UPDATE "reservation" SET "deadline_at" = "ends_at" WHERE "deadline_at" IS NULL;--> statement-breakpoint
ALTER TABLE "reservation" ALTER COLUMN "deadline_at" SET NOT NULL;