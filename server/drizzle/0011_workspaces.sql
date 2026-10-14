CREATE TYPE "public"."admin_title" AS ENUM('SINDICO', 'SUBSINDICO');--> statement-breakpoint
CREATE TYPE "public"."join_request_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."member_kind" AS ENUM('MORADOR', 'CONVIDADO');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('ADMIN', 'USER');--> statement-breakpoint
CREATE TYPE "public"."platform_role" AS ENUM('SUPER_ADMIN', 'USER');--> statement-breakpoint
CREATE TABLE "workspace" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_join_request" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"message" text,
	"status" "join_request_status" DEFAULT 'PENDING' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_member" (
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "member_role" DEFAULT 'USER' NOT NULL,
	"admin_title" "admin_title",
	"kind" "member_kind" DEFAULT 'MORADOR' NOT NULL,
	"unit_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_member_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id"),
	CONSTRAINT "member_admin_title_uq" UNIQUE("workspace_id","admin_title"),
	CONSTRAINT "member_admin_title_ck" CHECK (("workspace_member"."role" = 'ADMIN') = ("workspace_member"."admin_title" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "condo_settings" ADD COLUMN "workspace_id" text;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "workspace_id" text;--> statement-breakpoint
ALTER TABLE "station" ADD COLUMN "workspace_id" text;--> statement-breakpoint
ALTER TABLE "tariff" ADD COLUMN "workspace_id" text;--> statement-breakpoint
ALTER TABLE "unit" ADD COLUMN "workspace_id" text;--> statement-breakpoint
ALTER TABLE "workspace_join_request" ADD CONSTRAINT "workspace_join_request_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_join_request" ADD CONSTRAINT "workspace_join_request_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_join_request" ADD CONSTRAINT "workspace_join_request_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_member" ADD CONSTRAINT "workspace_member_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_member" ADD CONSTRAINT "workspace_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_member" ADD CONSTRAINT "workspace_member_unit_id_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."unit"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "join_request_ws_idx" ON "workspace_join_request" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "join_request_pending_uq" ON "workspace_join_request" USING btree ("workspace_id","user_id") WHERE status = 'PENDING';--> statement-breakpoint
CREATE INDEX "member_user_idx" ON "workspace_member" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "condo_settings" ADD CONSTRAINT "condo_settings_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "station" ADD CONSTRAINT "station_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tariff" ADD CONSTRAINT "tariff_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit" ADD CONSTRAINT "unit_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Dados de antes dos workspaces (um condomínio por instalação) viram o primeiro workspace.
-- Banco vazio não ganha workspace aqui: o seed cria o dele.
INSERT INTO "workspace" ("id", "name", "address")
SELECT gen_random_uuid()::text,
	COALESCE((SELECT "name" FROM "condo_settings" ORDER BY "id" LIMIT 1), 'Edifício Aurora'),
	(SELECT "address" FROM "station" WHERE "kind" = 'CONDOMINIO' ORDER BY "created_at" LIMIT 1)
WHERE EXISTS (SELECT 1 FROM "user") OR EXISTS (SELECT 1 FROM "station") OR EXISTS (SELECT 1 FROM "unit")
	OR EXISTS (SELECT 1 FROM "condo_settings") OR EXISTS (SELECT 1 FROM "tariff");--> statement-breakpoint
UPDATE "station" SET "workspace_id" = (SELECT "id" FROM "workspace" LIMIT 1) WHERE "kind" = 'CONDOMINIO';--> statement-breakpoint
UPDATE "unit" SET "workspace_id" = (SELECT "id" FROM "workspace" LIMIT 1);--> statement-breakpoint
UPDATE "condo_settings" SET "workspace_id" = (SELECT "id" FROM "workspace" LIMIT 1);--> statement-breakpoint
UPDATE "tariff" SET "workspace_id" = (SELECT "id" FROM "workspace" LIMIT 1);--> statement-breakpoint
UPDATE "invoice" SET "workspace_id" = (SELECT "id" FROM "workspace" LIMIT 1);--> statement-breakpoint
-- Todo mundo vira morador do condomínio, com a unidade que já tinha. ADMIN e OPERATOR viram
-- admin: o mais antigo é o síndico, o segundo o subsíndico (ADMIN antes de OPERATOR); a partir
-- do terceiro, usuário comum. O e-mail do SUPER_ADMIN_EMAIL é promovido em seedSuperAdmin.
INSERT INTO "workspace_member" ("workspace_id", "user_id", "role", "admin_title", "kind", "unit_id")
SELECT w."id", u."id",
	(CASE WHEN u."rk" <= 2 THEN 'ADMIN' ELSE 'USER' END)::"member_role",
	(CASE u."rk" WHEN 1 THEN 'SINDICO' WHEN 2 THEN 'SUBSINDICO' END)::"admin_title",
	'MORADOR', r."unit_id"
FROM (
	SELECT "id",
		CASE WHEN "role" IN ('ADMIN', 'OPERATOR')
			THEN row_number() OVER (PARTITION BY "role" IN ('ADMIN', 'OPERATOR') ORDER BY "role" = 'OPERATOR', "created_at")
		END AS "rk"
	FROM "user"
) u
CROSS JOIN (SELECT "id" FROM "workspace" LIMIT 1) w
LEFT JOIN "resident" r ON r."user_id" = u."id";
