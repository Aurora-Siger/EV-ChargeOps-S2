-- Segunda metade dos workspaces: com os dados já no workspace (0011), aperta as restrições.
-- O vínculo morador ↔ unidade agora mora em workspace_member.
DROP TABLE "resident" CASCADE;--> statement-breakpoint
ALTER TABLE "invoice" DROP CONSTRAINT "invoice_user_period_uq";--> statement-breakpoint
ALTER TABLE "unit" DROP CONSTRAINT "unit_label_unique";--> statement-breakpoint
-- Configurações: uma linha por condomínio, chave = workspace; o nome passa a ser o do workspace.
ALTER TABLE "condo_settings" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "condo_settings" DROP COLUMN "name";--> statement-breakpoint
ALTER TABLE "condo_settings" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "condo_settings" ADD PRIMARY KEY ("workspace_id");--> statement-breakpoint
ALTER TABLE "invoice" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tariff" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "unit" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
-- Papel global: ADMIN/OPERATOR já viraram admin do condomínio em workspace_member (0011);
-- aqui todo mundo fica USER. O SUPER_ADMIN sai do e-mail do .env (seedSuperAdmin).
ALTER TABLE "user" ALTER COLUMN "role" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "role" SET DATA TYPE "public"."platform_role" USING 'USER'::"public"."platform_role";--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "role" SET DEFAULT 'USER';--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_ws_user_period_uq" UNIQUE("workspace_id","user_id","period");--> statement-breakpoint
ALTER TABLE "unit" ADD CONSTRAINT "unit_workspace_label_uq" UNIQUE("workspace_id","label");--> statement-breakpoint
DROP TYPE "public"."role";
