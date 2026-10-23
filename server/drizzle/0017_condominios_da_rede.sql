-- Os pontos da demo com condomínio próprio (FIAP Aclimação; Aurora Siger, se cadastrado como
-- parceiro) viram estação de condomínio. O workspace de cada um nasce no boot
-- (seedCondoWorkspaces), com configurações e tarifa padrão, e aí o superadmin consegue abrir.
UPDATE "station" SET "kind" = 'CONDOMINIO', "public_price_cents_kwh" = NULL, "opening_hours" = '24h para moradores'
WHERE "name" IN ('FIAP Aclimação', 'Aurora Siger') AND "kind" <> 'CONDOMINIO' AND "workspace_id" IS NULL;
