CREATE TYPE "public"."cycle_entry_kind" AS ENUM('DESPESA', 'AJUSTE');--> statement-breakpoint
CREATE TABLE "cycle_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"period" text NOT NULL,
	"kind" "cycle_entry_kind" NOT NULL,
	"description" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"user_id" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cycle_entry_kind_user_ck" CHECK (("cycle_entry"."kind" = 'AJUSTE') = ("cycle_entry"."user_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "adjustment_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cycle_entry" ADD CONSTRAINT "cycle_entry_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_entry" ADD CONSTRAINT "cycle_entry_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_entry" ADD CONSTRAINT "cycle_entry_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cycle_entry_ws_period_idx" ON "cycle_entry" USING btree ("workspace_id","period");